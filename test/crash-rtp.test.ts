import { describe, it, expect } from "vitest";
import { crashFromFloat, rtpForEdge } from "../src/engine/index.js";

/** Deterministic 48-bit uniform PRNG (mulberry32-ish) so the test is stable. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function realizedRtp(rounds: number, edge: number, target: number, rng: () => number): number {
  let won = 0;
  for (let i = 0; i < rounds; i++) if (crashFromFloat(rng(), edge) >= target) won += target;
  return won / rounds;
}

describe("RTP convergence", () => {
  const N = 400_000;

  it("realized RTP matches configured 97% within tolerance (multiple targets)", () => {
    const edge = 0.03;
    const expected = rtpForEdge(edge);
    for (const t of [1.5, 2, 5]) {
      const rtp = realizedRtp(N, edge, t, prng(12345 + t * 1000));
      expect(Math.abs(rtp - expected)).toBeLessThan(0.02); // within 2pp at 400k rounds
    }
  });

  it("a custom 99% RTP (1% edge) also converges", () => {
    const edge = 0.01;
    const rtp = realizedRtp(N, edge, 2, prng(99));
    expect(Math.abs(rtp - rtpForEdge(edge))).toBeLessThan(0.02);
  });

  it("instant-rug rate approximates the edge", () => {
    const edge = 0.05;
    const rng = prng(7);
    let rugs = 0;
    for (let i = 0; i < N; i++) if (crashFromFloat(rng(), edge) === 1.0) rugs++;
    expect(Math.abs(rugs / N - edge)).toBeLessThan(0.01);
  });
});
