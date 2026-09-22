/**
 * server.ts — Roulette orchestrator + WebSocket transport. Single-shot, multi-bet:
 * debit the total stake, spin, credit the exact summed return (integer minor
 * units). Idempotent by txId; the outcome is the server's, never the client's.
 */

import { WebSocketServer, WebSocket } from "ws";
import { RouletteEngine, RouletteError } from "./engine.js";
import type { RouletteClientMessage, RouletteServerMessage, WireBet } from "./protocol.js";
import { minor, type Minor } from "../../engine/index.js";
import type { BetInput } from "../../engine/roulette.js";
import type { WalletGateway } from "../../wallet/wallet.js";
import type { OperatorConfig } from "../../config/operator.js";
import type { TxLog } from "../../persistence/store.js";

let seq = 0;
const id = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

interface Session { sessionId: string; playerId: string; currency: string; send: (m: RouletteServerMessage) => void; }

export interface RouletteOrchestratorDeps {
  engine: RouletteEngine;
  wallet: WalletGateway;
  operator: OperatorConfig;
  txLog: TxLog;
  ensureDemoSession?: (sid: string) => void;
}

export class RouletteOrchestrator {
  private sessions = new Map<string, Session>();
  constructor(private d: RouletteOrchestratorDeps) {}

  async openSession(token: string, send: (m: RouletteServerMessage) => void): Promise<Session> {
    const sessionId = token;
    this.d.ensureDemoSession?.(sessionId);
    const s: Session = { sessionId, playerId: sessionId, currency: this.d.operator.allowedCurrencies[0]!, send };
    this.sessions.set(sessionId, s);
    const balance = await this.d.wallet.getBalance(sessionId);
    send({ type: "welcome", sessionId, currency: s.currency, balance, edge: this.d.engine.edgeValue, config: this.d.engine.config() });
    return s;
  }

  closeSession(sid: string): void { this.sessions.delete(sid); }

  async spin(sessionId: string, wireBets: WireBet[], clientEntropy?: string): Promise<void> {
    const s = this.sessions.get(sessionId); if (!s) return;
    const bets: BetInput[] = (wireBets ?? []).map((b) => ({ key: String(b.key), amount: Number(b.amount) }));

    // Validate coverage + amounts against the catalog BEFORE touching money.
    let totalStake: number;
    try { totalStake = this.d.engine.validate(bets); }
    catch (e) { return s.send({ type: "error", code: (e as RouletteError).code ?? "bad_bets", message: (e as Error).message }); }

    const limits = this.d.operator.limits[s.currency];
    if (!limits || totalStake < limits.min || totalStake > limits.max) return s.send({ type: "error", code: "bad_stake", message: "total stake outside limits" });

    const playId = id("play"), betId = id("bet"), debitTxId = id("db");
    const stake = minor(totalStake);
    try {
      const res = await this.d.wallet.debit({ txId: debitTxId, sessionId, amount: stake, currency: s.currency, roundId: playId, betId });
      await this.d.txLog.append({ txId: debitTxId, at: Date.now(), kind: "debit", sessionId, playerId: s.playerId, roundId: playId, betId, amount: stake, currency: s.currency, applied: res.applied });
    } catch (e) { return s.send({ type: "error", code: "debit_failed", message: (e as Error).message }); }

    let out;
    try { out = this.d.engine.spin(bets, clientEntropy); }
    catch (e) {
      const rbTx = id("rb");
      const rb = await this.d.wallet.rollback({ txId: rbTx, originalTxId: debitTxId, sessionId });
      await this.d.txLog.append({ txId: rbTx, at: Date.now(), kind: "rollback", sessionId, playerId: s.playerId, roundId: playId, betId, amount: stake, currency: s.currency, applied: rb.applied });
      return s.send({ type: "error", code: (e as RouletteError).code ?? "spin_failed", message: (e as Error).message });
    }

    let payout = minor(out.totalReturn);
    if (this.d.operator.maxWin > 0 && payout > this.d.operator.maxWin) payout = minor(this.d.operator.maxWin);
    if (payout > 0) {
      const crTx = id("cr");
      try {
        const res = await this.d.wallet.credit({ txId: crTx, sessionId, amount: payout, currency: s.currency, roundId: playId, betId: playId });
        await this.d.txLog.append({ txId: crTx, at: Date.now(), kind: "credit", sessionId, playerId: s.playerId, roundId: playId, betId: playId, amount: payout, currency: s.currency, applied: res.applied });
      } catch { /* production: enqueue reconciliation retry (credit is idempotent) */ }
    }

    const balance = await this.d.wallet.getBalance(sessionId);
    s.send({
      type: "result", playId, number: out.number, color: out.color, commitment: out.commitment,
      clientSeed: out.clientSeed, nonce: out.nonce, results: out.results,
      totalStake: stake, totalReturn: minor(out.totalReturn), payout, balance, reveal: out.reveal,
    });
  }
}

export function attachRouletteWs(wss: WebSocketServer, orchestrator: RouletteOrchestrator): void {
  wss.on("connection", (ws: WebSocket) => {
    let sessionId: string | null = null;
    const send = (m: RouletteServerMessage) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); };
    ws.on("message", async (data) => {
      let msg: RouletteClientMessage;
      try { msg = JSON.parse(String(data)); } catch { return send({ type: "error", code: "bad_json", message: "invalid json" }); }
      try {
        switch (msg.type) {
          case "hello": { const s = await orchestrator.openSession(msg.sessionToken, send); sessionId = s.sessionId; break; }
          case "spin": { if (!sessionId) return send({ type: "error", code: "no_session", message: "say hello first" }); await orchestrator.spin(sessionId, msg.bets, msg.clientEntropy); break; }
          case "ping": send({ type: "pong" }); break;
          default: send({ type: "error", code: "unknown_type", message: "unknown message" });
        }
      } catch (e) { send({ type: "error", code: "server_error", message: (e as Error).message }); }
    });
    ws.on("close", () => { if (sessionId) orchestrator.closeSession(sessionId); });
  });
}

export function rouletteHttpRoutes(fairness?: () => unknown) {
  return (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): boolean => {
    if (req.url === "/fairness/roulette") {
      const body = {
        scheme: "European single-zero roulette; one HMAC draw per spin over a pre-committed server-seed chain + player entropy",
        verify: "SHA-256(serverSeed) === commitment; winning number = intFor(seeds,'roulette',37); reveal chains to serverSeedChainTerminal. Payouts are the standard European table (edge = 1/37).",
        ...(fairness ? (fairness() as object) : {}),
      };
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(body, null, 2)); return true;
    }
    return false;
  };
}
