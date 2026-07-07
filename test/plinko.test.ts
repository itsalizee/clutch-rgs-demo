import { describe, it, expect } from "vitest";
import {
  ROWS_OPTIONS, RISKS, multiplierTable, rtpOf, binProbs, drop,
  sha256hex, DEFAULT_EDGE, type RoundSeeds,
} from "../src/engine/index.js";

const seedsFor = (i: number): RoundSeeds => ({ serverSeed: sha256hex("ss:" + i), clientSeed: "cs", nonce: i });

describe("plinko (Prism) — provably-fair drop math", () => {
  it("every (rows, risk) table has exact RTP == (1 - edge) up to 2dp truncation", () => {
    // The bin distribution is an exact binomial, so RTP is exact (variance-free).
    for (const rows of ROWS_OPTIONS) for (const risk of RISKS) {
      const rtp = rtpOf(rows, risk);
      expect(rtp).toBeLessThanOrEqual(1 - DEFAULT_EDGE + 1e-9);
      expect(rtp).toBeGreaterThanOrEqual(1 - DEFAULT_EDGE - 0.01); // 2dp floor loss only
    }
  });

  it("tables have rows+1 bins, all non-negative, and a spiky edge for higher risk", () => {
    for (const rows of ROWS_OPTIONS) {
      const low = multiplierTable(rows, "low"), high = multiplierTable(rows, "high");
      expect(low.length).toBe(rows + 1);
      for (const m of high) expect(m).toBeGreaterThanOrEqual(0);
      // high-risk edge multiplier is much larger than low-risk edge
      expect(high[0]!).toBeGreaterThan(low[0]!);
      // and higher risk has a deeper (smaller) centre than low risk
      const c = rows / 2;
      expect(high[c]!).toBeLessThan(low[c]!);
    }
  });

  it("bin frequency matches the binomial distribution (provably fair)", () => {
    const rows = 12, N = 60000;
    const counts = new Array(rows + 1).fill(0);
    for (let i = 0; i < N; i++) counts[drop(seedsFor(i), rows, "medium").bin]++;
    const p = binProbs(rows);
    for (let k = 0; k <= rows; k++) {
      const freq = counts[k] / N;
      expect(Math.abs(freq - p[k]!)).toBeLessThan(0.02); // within 2 points of exact prob
    }
  });

  it("drop is deterministic from the seeds and bin equals the number of rights", () => {
    for (let i = 0; i < 100; i++) {
      const s = seedsFor(i);
      const a = drop(s, 16, "high"), b = drop(s, 16, "high");
      expect(a.bin).toBe(b.bin);
      expect(a.path).toEqual(b.path);
      expect(a.path.filter(Boolean).length).toBe(a.bin);
      expect(a.bin).toBeGreaterThanOrEqual(0); expect(a.bin).toBeLessThanOrEqual(16);
    }
  });
});
