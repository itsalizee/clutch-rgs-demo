import { describe, it, expect } from "vitest";
import {
  diceOutcome, diceMultiplier, winChancePct, rollFor,
  limboOutcome, wheelTable, wheelRtp, wheelOutcome, WHEEL_SEGMENTS, WHEEL_RISKS,
  slotsOutcome, slotsRtp, SLOTS_SYMBOLS,
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

describe("Slots (Fortune Reels) — provably fair", () => {
  it("exact enumerated RTP is house-favourable and close to (1 - edge)", () => {
    const rtp = slotsRtp();
    expect(rtp).toBeLessThanOrEqual(R + 1e-9);   // never pays over the target
    expect(rtp).toBeGreaterThan(R - 0.01);        // within a cent of quantization
  });
  it("realized RTP over a long run matches the enumerated RTP (Monte Carlo)", () => {
    const N = 120000; let ret = 0;
    for (let i = 0; i < N; i++) ret += slotsOutcome(seedsFor(i)).multiplier;
    expect(Math.abs(ret / N - slotsRtp())).toBeLessThan(0.03);
  });
  it("grid is 3×3 of valid symbols, deterministic, and the center line drives payout", () => {
    for (let i = 0; i < 5000; i++) {
      const o = slotsOutcome(seedsFor(i));
      expect(o.grid.length).toBe(3);
      for (const reel of o.grid) { expect(reel.length).toBe(3); for (const s of reel) { expect(s).toBeGreaterThanOrEqual(0); expect(s).toBeLessThan(SLOTS_SYMBOLS.length); } }
      expect(o.line).toEqual([o.grid[0][1], o.grid[1][1], o.grid[2][1]]);
      expect(o.won).toBe(o.multiplier > 0);
      expect(slotsOutcome(seedsFor(i)).multiplier).toBe(o.multiplier); // deterministic
    }
  });
});
