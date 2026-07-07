/**
 * server.ts — Prism (Plinko) orchestrator (money + books) + WebSocket transport.
 * Single-shot: debit the stake, drop, credit stake×multiplier. Idempotent by txId.
 */

import { WebSocketServer, WebSocket } from "ws";
import { PlinkoEngine, type PlinkoEngineError } from "./engine.js";
import type { PlinkoClientMessage, PlinkoServerMessage } from "./protocol.js";
import { payoutFor, minor, type Minor } from "../../engine/index.js";
import type { Risk } from "../../engine/plinko.js";
import type { WalletGateway } from "../../wallet/wallet.js";
import type { OperatorConfig } from "../../config/operator.js";
import type { TxLog } from "../../persistence/store.js";

let seq = 0;
const id = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

interface Session { sessionId: string; playerId: string; currency: string; send: (m: PlinkoServerMessage) => void; }

export interface PlinkoOrchestratorDeps {
  engine: PlinkoEngine;
  wallet: WalletGateway;
  operator: OperatorConfig;
  txLog: TxLog;
  ensureDemoSession?: (sid: string) => void;
}

export class PlinkoOrchestrator {
  private sessions = new Map<string, Session>();
  constructor(private d: PlinkoOrchestratorDeps) {}

  async openSession(token: string, send: (m: PlinkoServerMessage) => void): Promise<Session> {
    const sessionId = token;
    this.d.ensureDemoSession?.(sessionId);
    const s: Session = { sessionId, playerId: sessionId, currency: this.d.operator.allowedCurrencies[0]!, send };
    this.sessions.set(sessionId, s);
    const balance = await this.d.wallet.getBalance(sessionId);
    send({ type: "welcome", sessionId, currency: s.currency, balance, edge: this.d.engine.edgeValue, config: this.d.engine.config() });
    return s;
  }

  closeSession(sid: string): void { this.sessions.delete(sid); }

  async drop(sessionId: string, stake: Minor, rows: number, risk: Risk, clientEntropy?: string): Promise<void> {
    const s = this.sessions.get(sessionId); if (!s) return;
    const limits = this.d.operator.limits[s.currency];
    if (!limits || stake < limits.min || stake > limits.max) return s.send({ type: "error", code: "bad_stake", message: "stake outside limits" });

    const dropId = id("drop"), betId = id("bet"), debitTxId = id("db");
    try {
      const res = await this.d.wallet.debit({ txId: debitTxId, sessionId, amount: stake, currency: s.currency, roundId: dropId, betId });
      await this.d.txLog.append({ txId: debitTxId, at: Date.now(), kind: "debit", sessionId, playerId: s.playerId, roundId: dropId, betId, amount: stake, currency: s.currency, applied: res.applied });
    } catch (e) { return s.send({ type: "error", code: "debit_failed", message: (e as Error).message }); }

    let out;
    try { out = this.d.engine.drop({ sessionId, betId, stake, rows, risk, clientEntropy }); }
    catch (e) {
      const rbTx = id("rb");
      const rb = await this.d.wallet.rollback({ txId: rbTx, originalTxId: debitTxId, sessionId });
      await this.d.txLog.append({ txId: rbTx, at: Date.now(), kind: "rollback", sessionId, playerId: s.playerId, roundId: dropId, betId, amount: stake, currency: s.currency, applied: rb.applied });
      return s.send({ type: "error", code: (e as PlinkoEngineError).code ?? "drop_failed", message: (e as Error).message });
    }

    let payout = payoutFor(stake, out.multiplier);
    if (this.d.operator.maxWin > 0 && payout > this.d.operator.maxWin) payout = this.d.operator.maxWin;
    if (payout > 0) {
      const crTx = id("cr");
      try {
        const res = await this.d.wallet.credit({ txId: crTx, sessionId, amount: payout, currency: s.currency, roundId: dropId, betId: dropId });
        await this.d.txLog.append({ txId: crTx, at: Date.now(), kind: "credit", sessionId, playerId: s.playerId, roundId: dropId, betId: dropId, amount: payout, currency: s.currency, applied: res.applied });
      } catch { /* production: enqueue reconciliation retry (credit is idempotent) */ }
    }

    const balance = await this.d.wallet.getBalance(sessionId);
    s.send({ type: "drop_result", dropId, commitment: out.commitment, clientSeed: out.clientSeed, nonce: out.nonce,
      rows: out.rows, risk: out.risk, path: out.path, bin: out.bin, multiplier: out.multiplier, payout, balance, reveal: out.reveal });
  }
}

export interface PlinkoWsOptions { port: number; orchestrator: PlinkoOrchestrator; fairness?: () => unknown; }

/** Attach the Plinko (drop) protocol handler to a WebSocketServer. */
export function attachPlinkoWs(wss: WebSocketServer, orchestrator: PlinkoOrchestrator): void {
  wss.on("connection", (ws: WebSocket) => {
    let sessionId: string | null = null;
    const send = (m: PlinkoServerMessage) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); };
    ws.on("message", async (data) => {
      let msg: PlinkoClientMessage;
      try { msg = JSON.parse(String(data)); } catch { return send({ type: "error", code: "bad_json", message: "invalid json" }); }
      try {
        switch (msg.type) {
          case "hello": { const s = await orchestrator.openSession(msg.sessionToken, send); sessionId = s.sessionId; break; }
          case "drop": { if (!sessionId) return send({ type: "error", code: "no_session", message: "say hello first" }); await orchestrator.drop(sessionId, minor(msg.stake), msg.rows, msg.risk, msg.clientEntropy); break; }
          case "ping": send({ type: "pong" }); break;
          default: send({ type: "error", code: "unknown_type", message: "unknown message" });
        }
      } catch (e) { send({ type: "error", code: "server_error", message: (e as Error).message }); }
    });
    ws.on("close", () => { if (sessionId) orchestrator.closeSession(sessionId); });
  });
}

/** Shared HTTP route for Plinko fairness disclosure (returns true if handled). */
export function plinkoHttpRoutes(fairness?: () => unknown) {
  return (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): boolean => {
    if (req.url === "/fairness/plinko") {
      const body = {
        scheme: "commit-reveal over a pre-committed server-seed chain; each row is a provably-fair coin flip",
        verify: "SHA-256(serverSeed) === commitment; the ball's path = per-row bit floatFor(seeds, `plinko:i`) >= 0.5; bin = number of rights; multiplier = table[bin]; reveal chains to serverSeedChainTerminal.",
        ...(fairness ? (fairness() as object) : {}),
      };
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(body, null, 2)); return true;
    }
    return false;
  };
}
