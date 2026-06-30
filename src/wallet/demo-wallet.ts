/**
 * demo-wallet.ts — in-memory wallet for DEMO/FUN mode and tests (brief §9).
 *
 * Same engine, same provably-fair flow, fake credits, NO operator calls. Fully
 * idempotent by txId so it exercises the same money path as a real seamless
 * adapter. The balance is server-held (never client-trusted).
 */

import { minor, type Minor } from "../engine/index.js";
import { WalletError, type MoneyRequest, type RollbackRequest, type WalletGateway, type WalletResult } from "./wallet.js";

interface Applied {
  kind: "debit" | "credit" | "rollback";
  amount: Minor;
  rolledBack: boolean;
}

export class DemoWallet implements WalletGateway {
  private balances = new Map<string, number>();
  private txs = new Map<string, Applied>();
  private startingBalance: number;

  constructor(startingBalance: Minor = minor(100_000)) {
    this.startingBalance = startingBalance;
  }

  /** Open/ensure a demo session with a fresh fake balance. */
  ensureSession(sessionId: string, startingBalance?: Minor): void {
    if (!this.balances.has(sessionId)) {
      this.balances.set(sessionId, startingBalance ?? this.startingBalance);
    }
  }

  private bal(sessionId: string): number {
    const b = this.balances.get(sessionId);
    if (b === undefined) throw new WalletError("no_session", `unknown session ${sessionId}`);
    return b;
  }

  async getBalance(sessionId: string): Promise<Minor> {
    return minor(this.bal(sessionId));
  }

  async debit(req: MoneyRequest): Promise<WalletResult> {
    const prior = this.txs.get(req.txId);
    if (prior) return { txId: req.txId, balance: minor(this.bal(req.sessionId)), applied: false };
    const b = this.bal(req.sessionId);
    if (req.amount < 0) throw new WalletError("invalid", "amount must be >= 0");
    if (b < req.amount) throw new WalletError("insufficient_funds", "insufficient funds");
    this.balances.set(req.sessionId, b - req.amount);
    this.txs.set(req.txId, { kind: "debit", amount: req.amount, rolledBack: false });
    return { txId: req.txId, balance: minor(b - req.amount), applied: true };
  }

  async credit(req: MoneyRequest): Promise<WalletResult> {
    const prior = this.txs.get(req.txId);
    if (prior) return { txId: req.txId, balance: minor(this.bal(req.sessionId)), applied: false };
    const b = this.bal(req.sessionId);
    if (req.amount < 0) throw new WalletError("invalid", "amount must be >= 0");
    this.balances.set(req.sessionId, b + req.amount);
    this.txs.set(req.txId, { kind: "credit", amount: req.amount, rolledBack: false });
    return { txId: req.txId, balance: minor(b + req.amount), applied: true };
  }

  async rollback(req: RollbackRequest): Promise<WalletResult> {
    const prior = this.txs.get(req.txId);
    if (prior) return { txId: req.txId, balance: minor(this.bal(req.sessionId)), applied: false };
    const orig = this.txs.get(req.originalTxId);
    const b = this.bal(req.sessionId);
    if (!orig || orig.rolledBack || orig.kind !== "debit") {
      // Nothing to reverse (or already reversed) — record + no-op for idempotency.
      this.txs.set(req.txId, { kind: "rollback", amount: minor(0), rolledBack: false });
      return { txId: req.txId, balance: minor(b), applied: false };
    }
    orig.rolledBack = true;
    this.balances.set(req.sessionId, b + orig.amount);
    this.txs.set(req.txId, { kind: "rollback", amount: orig.amount, rolledBack: false });
    return { txId: req.txId, balance: minor(b + orig.amount), applied: true };
  }
}
