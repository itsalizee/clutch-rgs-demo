import { describe, it, expect, beforeEach } from "vitest";
import { DemoWallet } from "../src/wallet/demo-wallet.js";
import { minor } from "../src/engine/index.js";
import { WalletError } from "../src/wallet/wallet.js";

describe("DemoWallet — idempotency, atomicity, no lost/duplicated money", () => {
  let w: DemoWallet;
  beforeEach(() => { w = new DemoWallet(minor(1000)); w.ensureSession("s1"); });

  it("debit then credit moves balance correctly", async () => {
    const d = await w.debit({ txId: "d1", sessionId: "s1", amount: minor(100), currency: "C", roundId: "r1", betId: "b1" });
    expect(d.balance).toBe(900);
    const c = await w.credit({ txId: "c1", sessionId: "s1", amount: minor(250), currency: "C", roundId: "r1", betId: "b1" });
    expect(c.balance).toBe(1150);
  });

  it("re-sending the same txId never double-charges or double-pays", async () => {
    await w.debit({ txId: "d1", sessionId: "s1", amount: minor(100), currency: "C", roundId: "r1", betId: "b1" });
    const replay = await w.debit({ txId: "d1", sessionId: "s1", amount: minor(100), currency: "C", roundId: "r1", betId: "b1" });
    expect(replay.applied).toBe(false);
    expect(replay.balance).toBe(900); // still only debited once
    expect(await w.getBalance("s1")).toBe(900);

    await w.credit({ txId: "c1", sessionId: "s1", amount: minor(50), currency: "C", roundId: "r1", betId: "b1" });
    const creditReplay = await w.credit({ txId: "c1", sessionId: "s1", amount: minor(50), currency: "C", roundId: "r1", betId: "b1" });
    expect(creditReplay.applied).toBe(false);
    expect(await w.getBalance("s1")).toBe(950);
  });

  it("rollback reverses a debit exactly once (atomicity)", async () => {
    await w.debit({ txId: "d1", sessionId: "s1", amount: minor(300), currency: "C", roundId: "r1", betId: "b1" });
    const rb = await w.rollback({ txId: "rb1", originalTxId: "d1", sessionId: "s1" });
    expect(rb.applied).toBe(true);
    expect(await w.getBalance("s1")).toBe(1000);
    // a second rollback (same or new txId) does not over-credit
    const rb2 = await w.rollback({ txId: "rb2", originalTxId: "d1", sessionId: "s1" });
    expect(rb2.applied).toBe(false);
    expect(await w.getBalance("s1")).toBe(1000);
  });

  it("refuses to overspend", async () => {
    await expect(
      w.debit({ txId: "d1", sessionId: "s1", amount: minor(5000), currency: "C", roundId: "r1", betId: "b1" }),
    ).rejects.toBeInstanceOf(WalletError);
  });
});
