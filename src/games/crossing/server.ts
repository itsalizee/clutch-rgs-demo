/**
 * server.ts — Crossing orchestrator (money + books) + WebSocket transport.
 *
 * Mirrors the crash RGS's separation: the engine decides outcomes, this layer
 * moves money against the Wallet Gateway and logs every transaction. Debit on
 * open; credit on cash-out; a rugged run keeps the (already-debited) stake. All
 * wallet calls are idempotent by txId.
 */

import { createServer, type Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { CrossEngine, type CrossEngineError } from "./engine.js";
import type { CrossClientMessage, CrossServerMessage } from "./protocol.js";
import { payoutFor, minor, type Minor, DIFFICULTIES } from "../../engine/index.js";
import type { Difficulty } from "../../engine/stepcross.js";
import type { WalletGateway } from "../../wallet/wallet.js";
import type { OperatorConfig } from "../../config/operator.js";
import type { TxLog } from "../../persistence/store.js";

let seq = 0;
const id = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

interface Session { sessionId: string; playerId: string; currency: string; send: (m: CrossServerMessage) => void; }

export interface CrossOrchestratorDeps {
  engine: CrossEngine;
  wallet: WalletGateway;
  operator: OperatorConfig;
  txLog: TxLog;
  ensureDemoSession?: (sid: string) => void;
}

export class CrossOrchestrator {
  private sessions = new Map<string, Session>();
  constructor(private d: CrossOrchestratorDeps) {}

  async openSession(token: string, send: (m: CrossServerMessage) => void): Promise<Session> {
    const sessionId = token;
    this.d.ensureDemoSession?.(sessionId);
    const s: Session = { sessionId, playerId: sessionId, currency: this.d.operator.allowedCurrencies[0]!, send };
    this.sessions.set(sessionId, s);
    const balance = await this.d.wallet.getBalance(sessionId);
    send({ type: "welcome", sessionId, currency: s.currency, balance, edge: this.d.operator.edge, difficulties: DIFFICULTIES });
    return s;
  }

  closeSession(sid: string): void { this.sessions.delete(sid); }

  async openRun(sessionId: string, stake: Minor, difficulty: Difficulty, clientEntropy?: string): Promise<void> {
    const s = this.sessions.get(sessionId); if (!s) return;
    if (!(difficulty in DIFFICULTIES)) return s.send({ type: "error", code: "bad_difficulty", message: "unknown difficulty" });
    const limits = this.d.operator.limits[s.currency];
    if (!limits || stake < limits.min || stake > limits.max) return s.send({ type: "error", code: "bad_stake", message: "stake outside limits" });

    const runId = id("run"), betId = id("bet"), debitTxId = id("db");
    try {
      const res = await this.d.wallet.debit({ txId: debitTxId, sessionId, amount: stake, currency: s.currency, roundId: runId, betId });
      await this.d.txLog.append({ txId: debitTxId, at: Date.now(), kind: "debit", sessionId, playerId: s.playerId, roundId: runId, betId, amount: stake, currency: s.currency, applied: res.applied });
    } catch (e) { return s.send({ type: "error", code: "debit_failed", message: (e as Error).message }); }

    try {
      const open = this.d.engine.openRun({ runId, sessionId, betId, stake, difficulty, clientEntropy });
      const balance = await this.d.wallet.getBalance(sessionId);
      s.send({ type: "run_open", run: { runId: open.runId, commitment: open.commitment, clientSeed: open.clientSeed, nonce: open.nonce, difficulty: open.difficulty, lanes: open.lanes, ladder: open.ladder }, balance });
    } catch (e) {
      const rbTx = id("rb");
      const rb = await this.d.wallet.rollback({ txId: rbTx, originalTxId: debitTxId, sessionId });
      await this.d.txLog.append({ txId: rbTx, at: Date.now(), kind: "rollback", sessionId, playerId: s.playerId, roundId: runId, betId, amount: stake, currency: s.currency, applied: rb.applied });
      s.send({ type: "error", code: (e as CrossEngineError).code ?? "open_failed", message: (e as Error).message });
    }
  }

  async hop(sessionId: string, runId: string): Promise<void> {
    const s = this.sessions.get(sessionId); if (!s) return;
    try {
      const r = this.d.engine.hop(sessionId, runId);
      if (r.status === "alive") return s.send({ type: "hop", runId, lane: r.lane, multiplier: r.multiplier });
      // rugged: stake was already debited at open — nothing to credit.
      const balance = await this.d.wallet.getBalance(sessionId);
      s.send({ type: "run_over", runId, status: "rugged", lane: r.lane, multiplier: 0, payout: minor(0), balance, reveal: r.reveal! });
    } catch (e) { s.send({ type: "error", code: (e as CrossEngineError).code ?? "hop_failed", message: (e as Error).message }); }
  }

  async cashOut(sessionId: string, runId: string): Promise<void> {
    const s = this.sessions.get(sessionId); if (!s) return;
    let r;
    try { r = this.d.engine.cashOut(sessionId, runId); }
    catch (e) { return s.send({ type: "error", code: (e as CrossEngineError).code ?? "cash_failed", message: (e as Error).message }); }

    const stake = this.d.engine.getStake(runId);
    let payout = payoutFor(stake, r.multiplier);
    if (this.d.operator.maxWin > 0 && payout > this.d.operator.maxWin) payout = this.d.operator.maxWin;

    const crTx = id("cr");
    try {
      const res = await this.d.wallet.credit({ txId: crTx, sessionId, amount: payout, currency: s.currency, roundId: runId, betId: runId });
      await this.d.txLog.append({ txId: crTx, at: Date.now(), kind: "credit", sessionId, playerId: s.playerId, roundId: runId, betId: runId, amount: payout, currency: s.currency, applied: res.applied });
    } catch { /* production: enqueue reconciliation retry (credit is idempotent) */ }

    const balance = await this.d.wallet.getBalance(sessionId);
    s.send({ type: "run_over", runId, status: "cashed", lane: r.lane, multiplier: r.multiplier, payout, balance, reveal: r.reveal });
  }
}

export interface CrossWsOptions { port: number; orchestrator: CrossOrchestrator; fairness?: () => unknown; }

/** Attach the crossing (open_run/hop/cash_out) protocol handler to a WebSocketServer. */
export function attachCrossWs(wss: WebSocketServer, orchestrator: CrossOrchestrator): void {
  wss.on("connection", (ws: WebSocket) => {
    let sessionId: string | null = null;
    const send = (m: CrossServerMessage) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); };
    ws.on("message", async (data) => {
      let msg: CrossClientMessage;
      try { msg = JSON.parse(String(data)); } catch { return send({ type: "error", code: "bad_json", message: "invalid json" }); }
      try {
        switch (msg.type) {
          case "hello": { const s = await orchestrator.openSession(msg.sessionToken, send); sessionId = s.sessionId; break; }
          case "open_run": { if (!sessionId) return send({ type: "error", code: "no_session", message: "say hello first" }); await orchestrator.openRun(sessionId, minor(msg.stake), msg.difficulty, msg.clientEntropy); break; }
          case "hop": { if (!sessionId) return send({ type: "error", code: "no_session", message: "say hello first" }); await orchestrator.hop(sessionId, msg.runId); break; }
          case "cash_out": { if (!sessionId) return send({ type: "error", code: "no_session", message: "say hello first" }); await orchestrator.cashOut(sessionId, msg.runId); break; }
          case "ping": send({ type: "pong" }); break;
          default: send({ type: "error", code: "unknown_type", message: "unknown message" });
        }
      } catch (e) { send({ type: "error", code: "server_error", message: (e as Error).message }); }
    });
    ws.on("close", () => { if (sessionId) orchestrator.closeSession(sessionId); });
  });
}

/** Shared HTTP route for crossing fairness disclosure (returns true if handled). */
export function crossHttpRoutes(fairness?: () => unknown) {
  return (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): boolean => {
    if (req.url === "/fairness/cross" || req.url === "/fairness?game=cross") {
      const body = {
        scheme: "commit-reveal over a pre-committed server-seed chain; hazard lane = first lane whose HMAC roll misses the survival probability",
        verify: "SHA-256(serverSeed) === run commitment; failLane reproducible via floatFor(seeds, `stepcross:i`) >= survival; reveal chains to serverSeedChainTerminal.",
        ...(fairness ? (fairness() as object) : {}),
      };
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(body, null, 2)); return true;
    }
    return false;
  };
}

export function startCrossWsServer(opts: CrossWsOptions): { http: Server; wss: WebSocketServer; close: () => Promise<void> } {
  const http = createServer((req, res) => {
    if (req.url === "/health") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, game: "crossing" })); return; }
    if (req.url === "/fairness") {
      const body = {
        scheme: "commit-reveal over a pre-committed server-seed chain; hazard lane = first lane whose HMAC roll misses the survival probability",
        verify: "SHA-256(serverSeed) === run commitment; failLane reproducible via floatFor(seeds, `stepcross:i`) >= survival; reveal chains to serverSeedChainTerminal.",
        ...(opts.fairness ? (opts.fairness() as object) : {}),
      };
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(body, null, 2)); return;
    }
    res.writeHead(404); res.end();
  });

  const wss = new WebSocketServer({ server: http, path: "/ws" });
  attachCrossWs(wss, opts.orchestrator);

  http.listen(opts.port);
  return { http, wss, close: () => new Promise<void>((resolve) => { wss.close(() => http.close(() => resolve())); }) };
}
