/**
 * server.ts — Originals (Dice/Limbo/Wheel) orchestrator + WebSocket transport.
 * Single-shot: debit stake, play, credit stake×multiplier. Idempotent by txId.
 */

import { WebSocketServer, WebSocket } from "ws";
import { OriginalsEngine, type OriginalsEngineError, type PlayParams } from "./engine.js";
import type { OriginalsClientMessage, OriginalsServerMessage } from "./protocol.js";
import { payoutFor, minor, type Minor } from "../../engine/index.js";
import type { WalletGateway } from "../../wallet/wallet.js";
import type { OperatorConfig } from "../../config/operator.js";
import type { TxLog } from "../../persistence/store.js";

let seq = 0;
const id = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

interface Session { sessionId: string; playerId: string; currency: string; send: (m: OriginalsServerMessage) => void; }

export interface OriginalsOrchestratorDeps {
  engine: OriginalsEngine;
  wallet: WalletGateway;
  operator: OperatorConfig;
  txLog: TxLog;
  ensureDemoSession?: (sid: string) => void;
}

export class OriginalsOrchestrator {
  private sessions = new Map<string, Session>();
  constructor(private d: OriginalsOrchestratorDeps) {}

  async openSession(token: string, send: (m: OriginalsServerMessage) => void): Promise<Session> {
    const sessionId = token;
    this.d.ensureDemoSession?.(sessionId);
    const s: Session = { sessionId, playerId: sessionId, currency: this.d.operator.allowedCurrencies[0]!, send };
    this.sessions.set(sessionId, s);
    const balance = await this.d.wallet.getBalance(sessionId);
    send({ type: "welcome", sessionId, currency: s.currency, balance, edge: this.d.engine.edgeValue, config: this.d.engine.config() });
    return s;
  }

  closeSession(sid: string): void { this.sessions.delete(sid); }

  async play(sessionId: string, stake: Minor, params: PlayParams, clientEntropy?: string): Promise<void> {
    const s = this.sessions.get(sessionId); if (!s) return;
    const limits = this.d.operator.limits[s.currency];
    if (!limits || stake < limits.min || stake > limits.max) return s.send({ type: "error", code: "bad_stake", message: "stake outside limits" });

    const playId = id("play"), betId = id("bet"), debitTxId = id("db");
    try {
      const res = await this.d.wallet.debit({ txId: debitTxId, sessionId, amount: stake, currency: s.currency, roundId: playId, betId });
      await this.d.txLog.append({ txId: debitTxId, at: Date.now(), kind: "debit", sessionId, playerId: s.playerId, roundId: playId, betId, amount: stake, currency: s.currency, applied: res.applied });
    } catch (e) { return s.send({ type: "error", code: "debit_failed", message: (e as Error).message }); }

    let out;
    try { out = this.d.engine.play(params, clientEntropy); }
    catch (e) {
      const rbTx = id("rb");
      const rb = await this.d.wallet.rollback({ txId: rbTx, originalTxId: debitTxId, sessionId });
      await this.d.txLog.append({ txId: rbTx, at: Date.now(), kind: "rollback", sessionId, playerId: s.playerId, roundId: playId, betId, amount: stake, currency: s.currency, applied: rb.applied });
      return s.send({ type: "error", code: (e as OriginalsEngineError).code ?? "play_failed", message: (e as Error).message });
    }

    let payout = payoutFor(stake, out.multiplier);
    if (this.d.operator.maxWin > 0 && payout > this.d.operator.maxWin) payout = this.d.operator.maxWin;
    if (payout > 0) {
      const crTx = id("cr");
      try {
        const res = await this.d.wallet.credit({ txId: crTx, sessionId, amount: payout, currency: s.currency, roundId: playId, betId: playId });
        await this.d.txLog.append({ txId: crTx, at: Date.now(), kind: "credit", sessionId, playerId: s.playerId, roundId: playId, betId: playId, amount: payout, currency: s.currency, applied: res.applied });
      } catch { /* production: enqueue reconciliation retry (credit is idempotent) */ }
    }

    const balance = await this.d.wallet.getBalance(sessionId);
    s.send({ type: "result", playId, game: out.game, commitment: out.commitment, clientSeed: out.clientSeed, nonce: out.nonce,
      multiplier: out.multiplier, detail: out.detail, payout, balance, reveal: out.reveal });
  }
}

function toParams(m: Extract<OriginalsClientMessage, { type: "play" }>): PlayParams {
  if (m.game === "dice") return { game: "dice", target: m.target, dir: m.dir };
  if (m.game === "limbo") return { game: "limbo", target: m.target };
  return { game: "wheel", segments: m.segments, risk: m.risk };
}

export function attachOriginalsWs(wss: WebSocketServer, orchestrator: OriginalsOrchestrator): void {
  wss.on("connection", (ws: WebSocket) => {
    let sessionId: string | null = null;
    const send = (m: OriginalsServerMessage) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); };
    ws.on("message", async (data) => {
      let msg: OriginalsClientMessage;
      try { msg = JSON.parse(String(data)); } catch { return send({ type: "error", code: "bad_json", message: "invalid json" }); }
      try {
        switch (msg.type) {
          case "hello": { const s = await orchestrator.openSession(msg.sessionToken, send); sessionId = s.sessionId; break; }
          case "play": { if (!sessionId) return send({ type: "error", code: "no_session", message: "say hello first" }); await orchestrator.play(sessionId, minor(msg.stake), toParams(msg), msg.clientEntropy); break; }
          case "ping": send({ type: "pong" }); break;
          default: send({ type: "error", code: "unknown_type", message: "unknown message" });
        }
      } catch (e) { send({ type: "error", code: "server_error", message: (e as Error).message }); }
    });
    ws.on("close", () => { if (sessionId) orchestrator.closeSession(sessionId); });
  });
}

export function originalsHttpRoutes(fairness?: () => unknown) {
  return (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): boolean => {
    if (req.url === "/fairness/originals") {
      const body = {
        scheme: "commit-reveal over a pre-committed server-seed chain; one HMAC draw per play (dice roll / limbo multiplier / wheel segment)",
        verify: "SHA-256(serverSeed) === commitment; dice roll = floatFor(seeds,'dice')*100; limbo = crashFromFloat(floatFor(seeds,'limbo')); wheel segment = intFor(seeds,'wheel',segments); reveal chains to serverSeedChainTerminal.",
        ...(fairness ? (fairness() as object) : {}),
      };
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(body, null, 2)); return true;
    }
    return false;
  };
}
