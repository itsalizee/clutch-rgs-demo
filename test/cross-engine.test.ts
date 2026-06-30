import { describe, it, expect } from "vitest";
import { CrossEngine } from "../src/games/crossing/engine.js";
import { SeedChain, MixedEntropySource, commit, sha256hex, minor, configFor, failLane as deriveFailLane, stepMultiplier } from "../src/engine/index.js";

function seededBytes(seed: number): (n: number) => Uint8Array {
  let s = seed >>> 0;
  return (n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; b[i] = s & 0xff; } return b; };
}

function mkEngine() {
  return new CrossEngine({
    randomBytes: seededBytes(42),
    seedChain: new SeedChain(200, seededBytes(7)),
    entropy: new MixedEntropySource(),
    edge: 0.03,
    genesis: "test-genesis",
  });
}

describe("CrossEngine — server-authoritative crossing", () => {
  it("hides the hazard, reveals a verifiable run, and the reveal reproduces the hazard lane", () => {
    const e = mkEngine();
    const open = e.openRun({ runId: "r1", sessionId: "s1", betId: "b1", stake: minor(1000), difficulty: "medium", clientEntropy: "player-x" });
    // run_open exposes NO serverSeed and NO failLane (server-authority)
    expect(Object.prototype.hasOwnProperty.call(open, "serverSeed")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(open, "failLane")).toBe(false);
    expect(open.commitment).toMatch(/^[0-9a-f]{64}$/);

    // hop until the run ends
    const cfg = configFor("medium");
    let reveal: { serverSeed: string; clientSeed: string; nonce: number; failLane: number } | undefined;
    let lastLane = 0;
    for (let i = 0; i < cfg.lanes; i++) {
      const r = e.hop("s1", "r1");
      lastLane = r.lane;
      if (r.status === "rugged") { reveal = r.reveal!; break; }
    }
    if (!reveal) reveal = e.cashOut("s1", "r1").reveal; // cleared the board
    // commit/reveal + the hazard lane is reproducible from the revealed seeds
    expect(commit(reveal.serverSeed)).toBe(open.commitment);
    expect(deriveFailLane({ serverSeed: reveal.serverSeed, clientSeed: reveal.clientSeed, nonce: reveal.nonce }, cfg)).toBe(reveal.failLane);
    // we either rugged ON the hazard lane or cleared the board before it
    if (lastLane >= 1) expect(reveal.failLane).toBeGreaterThanOrEqual(1);
  });

  it("cash-out before the hazard pays the lane multiplier; cashing is idempotent; you can't cash a rugged run", () => {
    // find a run where lane 1 is safe so we can cash at lane 1 deterministically
    const e = mkEngine();
    let runId = "";
    for (let i = 0; i < 50; i++) {
      const rid = "run" + i;
      e.openRun({ runId: rid, sessionId: "s1", betId: "b" + i, stake: minor(1000), difficulty: "easy", clientEntropy: "e" + i });
      const r = e.hop("s1", rid);
      if (r.status === "alive") { runId = rid; break; }
      // rugged on lane 1: cashing must throw
      expect(() => e.cashOut("s1", rid)).toThrow();
    }
    expect(runId).not.toBe("");
    const cash = e.cashOut("s1", runId);
    expect(cash.multiplier).toBe(stepMultiplier(1, configFor("easy"), 0.03));
    const again = e.cashOut("s1", runId); // idempotent
    expect(again.multiplier).toBe(cash.multiplier);
  });

  it("reveals chain back to the pre-published terminal (anti-grind), across runs", () => {
    const chain = new SeedChain(50, seededBytes(99));
    const terminal = chain.terminal;
    const e = new CrossEngine({ randomBytes: seededBytes(1), seedChain: chain, entropy: new MixedEntropySource(), edge: 0.03 });
    const seeds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const rid = "r" + i;
      e.openRun({ runId: rid, sessionId: "s1", betId: "b" + i, stake: minor(100), difficulty: "hard", clientEntropy: "x" + i });
      // settle immediately to get the reveal
      let rev;
      const cfg = configFor("hard");
      for (let k = 0; k < cfg.lanes; k++) { const r = e.hop("s1", rid); if (r.status === "rugged") { rev = r.reveal!; break; } }
      if (!rev) rev = e.cashOut("s1", rid).reveal;
      seeds.push(rev.serverSeed);
    }
    expect(sha256hex(seeds[0]!)).toBe(terminal);
    for (let i = 1; i < seeds.length; i++) expect(sha256hex(seeds[i]!)).toBe(seeds[i - 1]!);
  });
});
