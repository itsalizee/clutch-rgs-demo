/**
 * wallet.ts — the canonical Wallet Gateway (brief §5).
 *
 * The RGS performs money movements against THIS interface. Each aggregator gets
 * an adapter that implements it by calling the operator's seamless-wallet API.
 * The demo wallet implements it in-memory. The engine/orchestrator never knows
 * which is behind it — no aggregator protocol leaks into the core (brief §12).
 *
 * Hard rules baked into the shape:
 *  - Every money call carries a unique, persisted `txId`. Re-sending the same
 *    `txId` MUST NOT double-charge or double-pay → `applied:false` on replay.
 *  - All amounts are INTEGER minor units (Minor). Never floats.
 */

import type { Minor } from "../engine/index.js";

export interface MoneyRequest {
  /** Unique, caller-generated, persisted. Idempotency key. */
  txId: string;
  sessionId: string;
  amount: Minor;
  currency: string;
  roundId: string;
  betId: string;
}

export interface RollbackRequest {
  txId: string;
  /** The debit/credit txId being reversed. */
  originalTxId: string;
  sessionId: string;
}

export interface WalletResult {
  txId: string;
  /** Balance after the call (or the unchanged balance on idempotent replay). */
  balance: Minor;
  /** false when this txId was already processed (idempotent no-op). */
  applied: boolean;
}

export class WalletError extends Error {
  constructor(readonly code: "insufficient_funds" | "no_session" | "invalid", message: string) {
    super(message);
    this.name = "WalletError";
  }
}

export interface WalletGateway {
  getBalance(sessionId: string): Promise<Minor>;
  debit(req: MoneyRequest): Promise<WalletResult>;
  credit(req: MoneyRequest): Promise<WalletResult>;
  rollback(req: RollbackRequest): Promise<WalletResult>;
}
