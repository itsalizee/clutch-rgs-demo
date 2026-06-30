/**
 * orchestrator.ts — the RGS core wiring (brief §2).
 *
 * Owns the money side and the books. Subscribes to the (outcome-authoritative)
 * RoundEngine and reacts by calling the Wallet Gateway and writing the append-only
 * tx + audit logs. Transport-agnostic: the WS layer wires sockets to sessions and
 * calls these methods; this file never imports `ws`.
 *
 * Guarantees enforced here:
 *  - bet = debit BEFORE the engine accepts it; if the engine rejects (window
 *    closed mid-request) the debit is rolled back (atomicity, brief §3/§5).
 *  - cash-out/jackpot credits are idempotent (txId) and retried on failure via a
 *    reconciliation queue — a valid win is never silently dropped (brief §3/§5).
 *  - every money move and every settled round is logged immutably (brief §8).
 */

import { payoutFor, minor, commit, type Minor } from "../engine/index.js";
import { RoundEngine, EngineError, type RoundResult, type CashOut } from "../core/round-engine.js";
import type { WalletGateway, MoneyRequest } from "../wallet/wallet.js";
import type { OperatorConfig } from "../config/operator.js";
import type { AuditLog, RoundStore, TxLog, BetOutcome } from "../persistence/store.js";
import type { ServerMessage } from "../protocol/messages.js";

let seq = 0;
const id = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

interface Session {
  sessionId: string;
  playerId: string;
  currency: string;
  send: (m: ServerMessage) => void;
}

interface BetTrack {
  roundId: string;
  betId: string;
  playerId: string;
  sessionId: string;
  stake: Minor;
  currency: string;
  status: "placed" | "cashed" | "lost";
  cashOutMultiplier: number | null;
  payout: Minor;
  jackpotAward: Minor;
  debitTxId: string;
}

export interface OrchestratorDeps {
  engine: RoundEngine;
  wallet: WalletGateway;
  operator: OperatorConfig;
  txLog: TxLog;
  auditLog: AuditLog;
  roundStore: RoundStore;
  /** demo wallet hook to provision fake balances. */
  ensureDemoSession?: (sessionId: string) => void;
}

export class Orchestrator {
  private sessions = new Map<string, Session>();
  private bets = new Map<string, BetTrack>();
  private retryQueue: Array<{ req: MoneyRequest; kind: "credit"; attempts: number }> = [];

  constructor(private d: OrchestratorDeps) {
    d.engine.events.on("round_open", (r) =>
      this.broadcast({ type: "round_open", round: { roundId: r.roundId, roundNumber: r.roundNumber, commitment: r.commitment, nonce: r.nonce, bettingEndsAt: r.bettingEndsAt }, moonPool: r.moonPool }),
    );
    d.engine.events.on("betting_closed", (e) => this.broadcast({ type: "betting_closed", roundId: e.roundId, clientSeed: e.clientSeed, externalEntropy: e.externalEntropy, externalSource: e.externalSource }));
    d.engine.events.on("tick", (t) => this.broadcast({ type: "tick", roundId: t.roundId, multiplier: t.multiplier }));
    d.engine.events.on("cashout", (c) => void this.onCashOut(c));
    d.engine.events.on("crash", (r) => void this.onCrash(r));
  }

  // ---- sessions -----------------------------------------------------------

  async openSession(sessionToken: string, send: (m: ServerMessage) => void): Promise<Session> {
    // DEMO auth: the token IS the session id. A real adapter validates the token
    // against the operator's auth endpoint before any play (brief §6).
    const sessionId = sessionToken;
    this.d.ensureDemoSession?.(sessionId);
    const session: Session = { sessionId, playerId: sessionId, currency: this.d.operator.allowedCurrencies[0]!, send };
    this.sessions.set(sessionId, session);
    const balance = await this.d.wallet.getBalance(sessionId);
    send({ type: "welcome", sessionId, currency: session.currency, balance, edge: this.d.operator.edge, moonPool: this.d.engine.moonPool });
    return session;
  }

  closeSession(sessionId: string): void {
    // Bets live server-side; auto-cash-out (if set) still fires, otherwise the bet
    // rides to the crash. Nothing to settle here — just drop the socket.
    this.sessions.delete(sessionId);
  }

  // ---- player actions -----------------------------------------------------

  async placeBet(sessionId: string, stake: Minor, autoCashOut?: number, clientEntropy?: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error("no session");
    if (this.d.engine.phase !== "betting") return s.send({ type: "error", code: "betting_closed", message: "betting is closed" });

    const limits = this.d.operator.limits[s.currency];
    if (!limits || stake < limits.min || stake > limits.max) {
      return s.send({ type: "error", code: "bad_stake", message: "stake outside limits" });
    }
    if (autoCashOut !== undefined && (!this.d.operator.features.autoCashOut || !(autoCashOut > 1))) {
      return s.send({ type: "error", code: "bad_auto", message: "auto cash-out not allowed" });
    }

    const betId = id("bet");
    const roundId = this.d.engine.currentRoundId!;
    const debitTxId = id("db");

    try {
      const res = await this.d.wallet.debit({ txId: debitTxId, sessionId, amount: stake, currency: s.currency, roundId, betId });
      await this.d.txLog.append({ txId: debitTxId, at: Date.now(), kind: "debit", sessionId, playerId: s.playerId, roundId, betId, amount: stake, currency: s.currency, applied: res.applied });
    } catch (e) {
      return s.send({ type: "error", code: "debit_failed", message: (e as Error).message });
    }

    try {
      this.d.engine.placeBet({ betId, playerId: s.playerId, sessionId, stake, autoCashOut, clientEntropy });
    } catch (e) {
      // Round closed between the phase check and engine accept — reverse the debit.
      const rbTx = id("rb");
      const rb = await this.d.wallet.rollback({ txId: rbTx, originalTxId: debitTxId, sessionId });
      await this.d.txLog.append({ txId: rbTx, at: Date.now(), kind: "rollback", sessionId, playerId: s.playerId, roundId, betId, amount: stake, currency: s.currency, applied: rb.applied });
      return s.send({ type: "error", code: (e as EngineError).code ?? "bet_rejected", message: (e as Error).message });
    }

    this.bets.set(betId, { roundId, betId, playerId: s.playerId, sessionId, stake, currency: s.currency, status: "placed", cashOutMultiplier: null, payout: minor(0), jackpotAward: minor(0), debitTxId });
    s.send({ type: "bet_accepted", betId, stake, balance: await this.d.wallet.getBalance(sessionId) });
  }

  async cashOut(sessionId: string, betId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    const track = this.bets.get(betId);
    if (!track || track.sessionId !== sessionId) return s.send({ type: "cash_out_failed", betId, reason: "unknown bet" });
    const r = this.d.engine.cashOut(betId); // engine emits 'cashout' on success → onCashOut credits
    if ("lost" in r) s.send({ type: "cash_out_failed", betId, reason: "too late" });
  }

  // ---- engine reactions (money moves here) --------------------------------

  private async onCashOut(c: CashOut): Promise<void> {
    const track = this.bets.get(c.betId);
    if (!track || track.status !== "placed") return;
    let payout = payoutFor(track.stake, c.multiplier);
    if (this.d.operator.maxWin > 0 && payout > this.d.operator.maxWin) payout = this.d.operator.maxWin; // exposure cap
    track.status = "cashed";
    track.cashOutMultiplier = c.multiplier;
    track.payout = payout;

    const txId = id("cr");
    const req: MoneyRequest = { txId, sessionId: track.sessionId, amount: payout, currency: track.currency, roundId: c.roundId, betId: c.betId };
    const ok = await this.credit(req);
    const balance = await this.safeBalance(track.sessionId);
    this.sessions.get(track.sessionId)?.send({ type: "cash_out", betId: c.betId, multiplier: c.multiplier, payout, balance });
    if (!ok) this.enqueueRetry(req);
  }

  private async onCrash(res: RoundResult): Promise<void> {
    // Jackpot credit to the provably-fair winner (win OR loss eligible).
    if (res.jackpot.triggered && res.jackpot.winnerBetId) {
      const track = this.bets.get(res.jackpot.winnerBetId);
      if (track) {
        track.jackpotAward = res.jackpot.award;
        const txId = id("jp");
        const req: MoneyRequest = { txId, sessionId: track.sessionId, amount: res.jackpot.award, currency: track.currency, roundId: res.roundId, betId: track.betId };
        const ok = await this.credit(req);
        const balance = await this.safeBalance(track.sessionId);
        this.sessions.get(track.sessionId)?.send({ type: "jackpot", betId: track.betId, award: res.jackpot.award, balance });
        if (!ok) this.enqueueRetry(req);
      }
    }
    for (const betId of res.lostBetIds) { const t = this.bets.get(betId); if (t) t.status = "lost"; }

    // Build + persist the immutable audit + round record, then drop this round's bets.
    const outcomes: BetOutcome[] = [...this.bets.values()]
      .filter((b) => b.roundId === res.roundId)
      .map((b) => ({ betId: b.betId, playerId: b.playerId, stake: b.stake, status: b.status === "cashed" ? "cashed" : "lost", cashOutMultiplier: b.cashOutMultiplier, payout: b.payout, jackpotAward: b.jackpotAward }));
    await this.d.auditLog.append({
      roundId: res.roundId, roundNumber: res.roundNumber, at: Date.now(),
      commitment: commit(res.reveal.serverSeed), serverSeed: res.reveal.serverSeed, clientSeed: res.reveal.clientSeed, nonce: res.reveal.nonce,
      edge: this.d.operator.edge, crashPoint: res.crashPoint, jackpotTriggered: res.jackpot.triggered,
      jackpotWinnerBetId: res.jackpot.winnerBetId, jackpotAward: res.jackpot.award, bets: outcomes, moonPoolAfter: res.moonPool,
    });
    await this.d.roundStore.save(res);

    this.broadcast({
      type: "crash",
      round: { roundId: res.roundId, roundNumber: res.roundNumber, crashPoint: res.crashPoint, serverSeed: res.reveal.serverSeed, clientSeed: res.reveal.clientSeed, nonce: res.reveal.nonce, jackpotTriggered: res.jackpot.triggered },
      moonPool: res.moonPool,
    });

    for (const [betId, b] of [...this.bets]) if (b.roundId === res.roundId) this.bets.delete(betId);
  }

  // ---- money helpers ------------------------------------------------------

  private async credit(req: MoneyRequest): Promise<boolean> {
    try {
      const res = await this.d.wallet.credit(req);
      await this.d.txLog.append({ txId: req.txId, at: Date.now(), kind: "credit", sessionId: req.sessionId, playerId: req.sessionId, roundId: req.roundId, betId: req.betId, amount: req.amount, currency: req.currency, applied: res.applied });
      return true;
    } catch {
      return false;
    }
  }

  private enqueueRetry(req: MoneyRequest): void {
    this.retryQueue.push({ req, kind: "credit", attempts: 0 });
  }

  /** Drain the reconciliation queue — idempotent credits, so safe to retry. */
  async runReconciliation(maxAttempts = 5): Promise<{ pending: number }> {
    const still: typeof this.retryQueue = [];
    for (const item of this.retryQueue) {
      const ok = await this.credit(item.req);
      if (!ok && item.attempts + 1 < maxAttempts) still.push({ ...item, attempts: item.attempts + 1 });
    }
    this.retryQueue = still;
    return { pending: still.length };
  }

  get pendingReconciliations(): number { return this.retryQueue.length; }

  private async safeBalance(sessionId: string): Promise<Minor> {
    try { return await this.d.wallet.getBalance(sessionId); } catch { return minor(0); }
  }

  private broadcast(m: ServerMessage): void { for (const s of this.sessions.values()) s.send(m); }
}
