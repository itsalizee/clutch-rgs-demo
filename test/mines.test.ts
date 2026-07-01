import { describe, it, expect } from "vitest";
import {
  minesConfig, survivalProb, minesMultiplier, minesLadder, mineSet, maxSafe,
  sha256hex, DEFAULT_EDGE, type RoundSeeds,
} from "../src/engine/index.js";

const seedsFor = (i: number): RoundSeeds => ({ serverSeed: sha256hex("ss:" + i), clientSeed: "cs", nonce: i });

describe("mines (Vault) — provably-fair grid math", () => {
  it("ladder is strictly increasing; more mines pays more per pick", () => {
    const lad = minesLadder(minesConfig(3));
    for (let i = 1; i < lad.length; i++) expect(lad[i]!).toBeGreaterThan(lad[i - 1]!);
    expect(minesMultiplier(1, minesConfig(3))).toBeGreaterThan(1);            // a real win on pick 1
    expect(minesMultiplier(1, minesConfig(10))).toBeGreaterThan(minesMultiplier(1, minesConfig(3)));
  });

  it("EV at every pick equals (1 - edge) up to 2dp truncation (analytic, exact)", () => {
    // EV(cash after k safe picks) = P(survive k) · multiplier(k). With
    // multiplier = (1-edge)/P pre-truncation, EV = (1-edge) exactly; the 2dp
    // floor removes at most 0.01·P. Variance-free — holds for every mine count.
    for (const m of [1, 3, 5, 10, 24]) {
      const cfg = minesConfig(m);
      for (let k = 1; k <= maxSafe(cfg); k++) {
        const p = survivalProb(k, cfg);
        const ev = p * minesMultiplier(k, cfg);
        expect(ev).toBeLessThanOrEqual(1 - DEFAULT_EDGE + 1e-9);
        expect(ev).toBeGreaterThanOrEqual(1 - DEFAULT_EDGE - 0.01 * p - 1e-9);
      }
    }
  });

  it("mineSet: exactly M distinct mines in range, and deterministic from the seeds", () => {
    const cfg = minesConfig(5);
    for (let i = 0; i < 200; i++) {
      const s = seedsFor(i);
      const set = mineSet(s, cfg);
      expect(set.size).toBe(5);
      for (const t of set) { expect(t).toBeGreaterThanOrEqual(0); expect(t).toBeLessThan(cfg.tiles); }
      // same seeds → identical placement (reproducible / verifiable)
      const again = mineSet(s, cfg);
      expect([...again].sort((a, b) => a - b)).toEqual([...set].sort((a, b) => a - b));
    }
  });

  it("mine placement is uniform: each tile is a mine ~ M/N of the time (provably fair)", () => {
    const cfg = minesConfig(5); // 5 mines of 25 → each tile mined 20% of the time
    const N = 40000;
    const counts = new Array(cfg.tiles).fill(0);
    for (let i = 0; i < N; i++) for (const t of mineSet(seedsFor(i), cfg)) counts[t]++;
    const expected = cfg.mines / cfg.tiles; // 0.20
    for (const c of counts) {
      const freq = c / N;
      expect(freq).toBeGreaterThan(expected - 0.02);
      expect(freq).toBeLessThan(expected + 0.02);
    }
  });

  it("survivalProb matches the hypergeometric closed form and decreases with k", () => {
    const cfg = minesConfig(3); // N=25, M=3
    // P(survive 1) = (N-M)/N = 22/25
    expect(survivalProb(1, cfg)).toBeCloseTo(22 / 25, 12);
    // P(survive 2) = 22/25 · 21/24
    expect(survivalProb(2, cfg)).toBeCloseTo((22 / 25) * (21 / 24), 12);
    for (let k = 1; k <= maxSafe(cfg); k++) expect(survivalProb(k, cfg)).toBeLessThan(survivalProb(k - 1, cfg));
  });
});
