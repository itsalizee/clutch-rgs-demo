import { describe, it, expect } from "vitest";
import {
  diceOutcome, diceMultiplier, winChancePct, rollFor,
  limboOutcome, wheelTable, wheelRtp, wheelOutcome, WHEEL_SEGMENTS, WHEEL_RISKS,
  sha256hex, DEFAULT_EDGE, type RoundSeeds,
} from "../src/engine/index.js";

const seedsFor = (i: number): RoundSeeds => ({ serverSeed: sha256hex("ss:" + i), clientSeed: "cs", nonce: i });
const R = 1 - DEFAULT_EDGE;

describe("Dice — provably fair", () => {
  it("multiplier × win-chance == (1 - edge) at every target/direction (analytic)", () => {
    for (const dir of ["over", "under"] as const) for (let t = 2; t <= 98; t++) {
      const ev = (winChancePct(t, dir) / 100) * diceMultiplier(t, dir);
      expect(ev).toBeLessThanOrEqual(R + 1e-9);
      expect(ev).toBeGreaterThanOrEqual(R - 0.01 * (winChancePct(t, dir) / 100) - 1e-9);
    }
  });
  it("realized win frequency matches the target chance (Monte Carlo)", () => {
    const N = 50000; let wins = 0;
    for (let i = 0; i < N; i++) if (diceOutcome(seedsFor(i), 50, "over").won) wins++;
    expect(Math.abs(wins / N - 0.5)).toBeLessThan(0.01); // over 50 → ~50%
    const roll = rollFor(seedsFor(1)); expect(roll).toBeGreaterThanOrEqual(0); expect(roll).toBeLessThan(100);
  });
});

describe("Limbo — provably fair", () => {
  it("realized RTP ≈ (1 - edge) for a fixed target (Monte Carlo)", () => {
    const N = 120000, target = 2; let ret = 0;
    for (let i = 0; i < N; i++) ret += limboOutcome(seedsFor(i), target).multiplier;
    const rtp = ret / N; // avg payout multiplier per unit stake
    expect(rtp).toBeGreaterThan(R - 0.03);
    expect(rtp).toBeLessThan(R + 0.03);
  });
});

describe("Wheel — provably fair", () => {
  it("every (segments, risk) table has exact RTP ≈ (1 - edge)", () => {
    for (const seg of WHEEL_SEGMENTS) for (const risk of WHEEL_RISKS) {
      const rtp = wheelRtp(seg, risk);
      expect(rtp).toBeLessThanOrEqual(R + 1e-9);
      expect(rtp).toBeGreaterThanOrEqual(R - 0.02);
      expect(wheelTable(seg, risk).length).toBe(seg);
    }
  });
  it("landing segment is in range, deterministic, and roughly uniform", () => {
    const seg = 30, N = 60000; const counts = new Array(seg).fill(0);
    for (let i = 0; i < N; i++) { const o = wheelOutcome(seedsFor(i), seg, "medium"); counts[o.segment]++;
      expect(wheelOutcome(seedsFor(i), seg, "medium").segment).toBe(o.segment); }
    for (const c of counts) expect(Math.abs(c / N - 1 / seg)).toBeLessThan(0.01);
  });
});
