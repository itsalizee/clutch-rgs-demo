/**
 * server.ts — Vault orchestrator (money + books) + WebSocket transport.
 *
 * Mirrors the crossing/crash RGS: the engine decides outcomes, this layer moves
 * money against the Wallet Gateway and logs every transaction. Debit on open;
 * credit on cash-out; a boom keeps the (already-debited) stake. All wallet calls
 * are idempotent by txId.
 */

import { WebSocketServer, WebSocket } from "ws";
import { VaultEngine, type VaultEngineError } from "./engine.js";
import type { VaultClientMessage, VaultServerMessage } from "./protocol.js";
import { payoutFor, minor, type Minor, MINES_TILES, MINES_MIN, MINES_MAX, DEFAULT_MINES } from "../../engine/index.js";
import type { WalletGateway } from "../../wallet/wallet.js";
import type { OperatorConfig } from "../../config/operator.js";
import type { TxLog } from "../../persistence/store.js";

let seq = 0;
const id = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

interface Session { sessionId: string; playerId: string; currency: string; send: (m: VaultServerMessage) => void; }

export interface VaultOrchestratorDeps {
  engine: VaultEngine;
  wallet: WalletGateway;
  operator: OperatorConfig;
  txLog: TxLog;
  ensureDemoSession?: (sid: string) => void;
}

export class VaultOrchestrator {
  private sessions = new Map<string, Session>();
  constructor(private d: VaultOrchestratorDeps) {}

  async openSession(token: string, send: (m: VaultServerMessage) => void): Promise<Session> {
    const sessionId = token;
    this.d.ensureDemoSession?.(sessionId);
    const s: Session = { sessionId, playerId: sessionId, currency: this.d.operator.allowedCurrencies[0]!, send };
    this.sessions.set(sessionId, s);
    const balance = await this.d.wallet.getBalance(sessionId);
    send({ type: "welcome", sessionId, currency: s.currency, balance, edge: this.d.operator.edge, tiles: MINES_TILES, minesRange: { min: MINES_MIN, max: MINES_MAX }, defaultMines: DEFAULT_MINES });
    return s;
  }

  closeSession(sid: string): void { this.sessions.delete(sid); }

  async openRun(sessionId: string, stake: Minor, mines: number, clientEntropy?: string): Promise<void> {
    const s = this.sessions.get(sessionId); if (!s) return;
    const limits = this.d.operator.limits[s.currency];
    if (!limits || stake < limits.min || stake > limits.max) return s.send({ type: "error", code: "bad_stake", message: "stake outside limits" });

    const runId = id("run"), betId = id("bet"), debitTxId = id("db");
    try {
      const res = await this.d.wallet.debit({ txId: debitTxId, sessionId, amount: stake, currency: s.currency, roundId: runId, betId });
      await this.d.txLog.append({ txId: debitTxId, at: Date.now(), kind: "debit", sessionId, playerId: s.playerId, roundId: runId, betId, amount: stake, currency: s.currency, applied: res.applied });
    } catch (e) { return s.send({ type: "error", code: "debit_failed", message: (e as Error).message }); }

    try {
      const open = this.d.engine.openRun({ runId, sessionId, betId, stake, mines, clientEntropy });
      const balance = await this.d.wallet.getBalance(sessionId);
      s.send({ type: "run_open", run: { runId: open.runId, commitment: open.commitment, clientSeed: open.clientSeed, nonce: open.nonce, tiles: open.tiles, mines: open.mines, ladder: open.ladder }, balance });
    } catch (e) {
      const rbTx = id("rb");
      const rb = await this.d.wallet.rollback({ txId: rbTx, originalTxId: debitTxId, sessionId });
      await this.d.txLog.append({ txId: rbTx, at: Date.now(), kind: "rollback", sessionId, playerId: s.playerId, roundId: runId, betId, amount: stake, currency: s.currency, applied: rb.applied });
      s.send({ type: "error", code: (e as VaultEngineError).code ?? "open_failed", message: (e as Error).message });
    }
  }

  async reveal(sessionId: string, runId: string, tile: number): Promise<void> {
    const s = this.sessions.get(sessionId); if (!s) return;
    let r;
    try { r = this.d.engine.reveal(sessionId, runId, tile); }
    catch (e) { return s.send({ type: "error", code: (e as VaultEngineError).code ?? "reveal_failed", message: (e as Error).message }); }

    if (r.status === "safe" && !r.cleared) {
      return s.send({ type: "reveal", runId, tile: r.tile, safe: r.safe, multiplier: r.multiplier });
    }
    if (r.status === "boom") {
      // stake was already debited at open — nothing to credit.
      const balance = await this.d.wallet.getBalance(sessionId);
      return s.send({ type: "run_over", runId, status: "boom", tile: r.tile, safe: r.safe, multiplier: 0, payout: minor(0), balance, reveal: r.reveal! });
    }
    // cleared the board on this reveal → pay out the top multiplier
    await this.settle(s, runId, r.tile, r.safe, r.multiplier, r.reveal!);
  }

  async cashOut(sessionId: string, runId: string): Promise<void> {
    const s = this.sessions.get(sessionId); if (!s) return;
    let r;
    try { r = this.d.engine.cashOut(sessionId, runId); }
    catch (e) { return s.send({ type: "error", code: (e as VaultEngineError).code ?? "cash_failed", message: (e as Error).message }); }
    await this.settle(s, runId, -1, r.safe, r.multiplier, r.reveal);
  }

  private async settle(s: Session, runId: string, tile: number, safe: number, multiplier: number, reveal: import("./engine.js").Reveal): Promise<void> {
    const stake = this.d.engine.getStake(runId);
    let payout = payoutFor(stake, multiplier);
    if (this.d.operator.maxWin > 0 && payout > this.d.operator.maxWin) payout = this.d.operator.maxWin;

    const crTx = id("cr");
    try {
      const res = await this.d.wallet.credit({ txId: crTx, sessionId: s.sessionId, amount: payout, currency: s.currency, roundId: runId, betId: runId });
      await this.d.txLog.append({ txId: crTx, at: Date.now(), kind: "credit", sessionId: s.sessionId, playerId: s.playerId, roundId: runId, betId: runId, amount: payout, currency: s.currency, applied: res.applied });
    } catch { /* production: enqueue reconciliation retry (credit is idempotent) */ }

    const balance = await this.d.wallet.getBalance(s.sessionId);
    s.send({ type: "run_over", runId, status: "cashed", tile, safe, multiplier, payout, balance, reveal });
  }
}

export interface VaultWsOptions { port: number; orchestrator: VaultOrchestrator; fairness?: () => unknown; }

/** Attach the Vault (open_run/reveal/cash_out) protocol handler to a WebSocketServer. */
export function attachVaultWs(wss: WebSocketServer, orchestrator: VaultOrchestrator): void {
  wss.on("connection", (ws: WebSocket) => {
    let sessionId: string | null = null;
    const send = (m: VaultServerMessage) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); };
    ws.on("message", async (data) => {
      let msg: VaultClientMessage;
      try { msg = JSON.parse(String(data)); } catch { return send({ type: "error", code: "bad_json", message: "invalid json" }); }
      try {
        switch (msg.type) {
          case "hello": { const s = await orchestrator.openSession(msg.sessionToken, send); sessionId = s.sessionId; break; }
          case "open_run": { if (!sessionId) return send({ type: "error", code: "no_session", message: "say hello first" }); await orchestrator.openRun(sessionId, minor(msg.stake), msg.mines, msg.clientEntropy); break; }
          case "reveal": { if (!sessionId) return send({ type: "error", code: "no_session", message: "say hello first" }); await orchestrator.reveal(sessionId, msg.runId, msg.tile); break; }
          case "cash_out": { if (!sessionId) return send({ type: "error", code: "no_session", message: "say hello first" }); await orchestrator.cashOut(sessionId, msg.runId); break; }
          case "ping": send({ type: "pong" }); break;
          default: send({ type: "error", code: "unknown_type", message: "unknown message" });
        }
      } catch (e) { send({ type: "error", code: "server_error", message: (e as Error).message }); }
    });
    ws.on("close", () => { if (sessionId) orchestrator.closeSession(sessionId); });
  });
}

/** Shared HTTP route for Vault fairness disclosure (returns true if handled). */
export function vaultHttpRoutes(fairness?: () => unknown) {
  return (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): boolean => {
    if (req.url === "/fairness/vault") {
      const body = {
        scheme: "commit-reveal over a pre-committed server-seed chain; mines placed by a provably-fair Fisher–Yates shuffle",
        verify: "SHA-256(serverSeed) === run commitment; mine tiles reproducible via a HMAC-seeded shuffle (tag `mines:i`); reveal chains to serverSeedChainTerminal.",
        ...(fairness ? (fairness() as object) : {}),
      };
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(body, null, 2)); return true;
    }
    return false;
  };
}
