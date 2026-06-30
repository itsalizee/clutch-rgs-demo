import { describe, it, expect } from "vitest";
import { BlockHashEntropyProvider, MixedEntropySource } from "../src/engine/index";

describe("BlockHashEntropyProvider (resilient external entropy)", () => {
  it("returns the fetched block hash as public entropy", async () => {
    const p = new BlockHashEntropyProvider({ fetchTipHash: async () => "abc123def", source: "test" });
    const e = await p.forRound(0);
    expect(e).toEqual({ source: "test", value: "abc123def" });
  });

  it("caches within the TTL (one fetch reused across rounds)", async () => {
    let calls = 0;
    let clock = 0;
    const p = new BlockHashEntropyProvider({
      fetchTipHash: async () => { calls++; return "hash-" + calls; },
      ttlMs: 1000,
      now: () => clock,
    });
    expect((await p.forRound(0))!.value).toBe("hash-1");
    clock = 500; // within TTL
    expect((await p.forRound(1))!.value).toBe("hash-1");
    expect(calls).toBe(1);
    clock = 1500; // past TTL → refetch
    expect((await p.forRound(2))!.value).toBe("hash-2");
    expect(calls).toBe(2);
  });

  it("is resilient: a failing feed yields null (round falls back, never breaks)", async () => {
    const p = new BlockHashEntropyProvider({ fetchTipHash: async () => { throw new Error("feed down"); } });
    expect(await p.forRound(0)).toBeNull();
  });
});

describe("MixedEntropySource folds in external entropy", () => {
  it("changes the client seed when external entropy is present", () => {
    const m = new MixedEntropySource();
    const base = { nonce: 0, prevServerSeed: "prev", playerEntropy: ["p1"] };
    const without = m.clientSeedFor(base);
    const withExt = m.clientSeedFor({ ...base, externalEntropy: "blockhash" });
    expect(withExt).not.toBe(without);
    // deterministic + reproducible
    expect(m.clientSeedFor({ ...base, externalEntropy: "blockhash" })).toBe(withExt);
  });
});
