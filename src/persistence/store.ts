/**
 * store.ts — durable interfaces + in-memory implementations.
 *
 * The interfaces are what a Postgres-backed implementation will satisfy (brief
 * §2/§8). The in-memory versions make the whole RGS runnable and testable today.
 * The transaction and audit logs are APPEND-ONLY: entries are never mutated or
 * deleted, so any round is reconstructable from logs for dispute/audit (§8).
 */

import type { Minor } from "../engine/index.js";
import type { RoundResult } from "../core/round-engine.js";

export interface TxEntry {
  txId: string;
  at: number;
  kind: "debit" | "credit" | "rollback";
  sessionId: string;
  playerId: string;
  roundId: string;
  betId: string;
  amount: Minor;
  currency: string;
  /** false when the call was an idempotent replay (recorded for completeness). */
  applied: boolean;
}

export interface BetOutcome {
  betId: string;
  playerId: string;
  stake: Minor;
  status: "cashed" | "lost";
  cashOutMultiplier: number | null;
  payout: Minor;
  jackpotAward: Minor;
}

export interface RoundAudit {
  roundId: string;
  roundNumber: number;
  at: number;
  commitment: string;
  serverSeed: string; // revealed
  clientSeed: string;
  nonce: number;
  edge: number;
  crashPoint: number;
  jackpotTriggered: boolean;
  jackpotWinnerBetId: string | null;
  jackpotAward: Minor;
  bets: BetOutcome[];
  moonPoolAfter: Minor;
}

export interface TxLog {
  append(entry: TxEntry): Promise<void>;
  list(filter?: { sessionId?: string; roundId?: string }): Promise<TxEntry[]>;
}

export interface AuditLog {
  append(audit: RoundAudit): Promise<void>;
  get(roundId: string): Promise<RoundAudit | undefined>;
  list(limit?: number): Promise<RoundAudit[]>;
}

export interface RoundStore {
  save(result: RoundResult): Promise<void>;
  recent(limit: number): Promise<RoundResult[]>;
}

// ---- in-memory implementations -------------------------------------------

export class MemoryTxLog implements TxLog {
  private entries: TxEntry[] = [];
  async append(entry: TxEntry): Promise<void> { this.entries.push(Object.freeze({ ...entry })); }
  async list(filter?: { sessionId?: string; roundId?: string }): Promise<TxEntry[]> {
    return this.entries.filter(
      (e) => (!filter?.sessionId || e.sessionId === filter.sessionId) && (!filter?.roundId || e.roundId === filter.roundId),
    );
  }
}

export class MemoryAuditLog implements AuditLog {
  private byId = new Map<string, RoundAudit>();
  private order: string[] = [];
  async append(audit: RoundAudit): Promise<void> {
    if (this.byId.has(audit.roundId)) return; // append-only, no overwrite
    this.byId.set(audit.roundId, Object.freeze({ ...audit }));
    this.order.push(audit.roundId);
  }
  async get(roundId: string): Promise<RoundAudit | undefined> { return this.byId.get(roundId); }
  async list(limit = 50): Promise<RoundAudit[]> {
    return this.order.slice(-limit).map((id) => this.byId.get(id)!).reverse();
  }
}

export class MemoryRoundStore implements RoundStore {
  private rounds: RoundResult[] = [];
  async save(result: RoundResult): Promise<void> { this.rounds.push(result); }
  async recent(limit: number): Promise<RoundResult[]> { return this.rounds.slice(-limit).reverse(); }
}
