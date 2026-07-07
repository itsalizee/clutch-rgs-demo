/**
 * plinko.ts — the "Prism" Plinko game math. PURE.
 *
 * A ball drops through `rows` of pegs; at each peg a provably-fair coin flip sends
 * it left or right. The landing bin is the number of rights (a binomial over the
 * rows), and each bin pays a fixed multiplier. Risk (low/medium/high) reshapes the
 * multiplier curve — flatter for low, spiky edges for high — while RTP stays fixed.
 *
 * The multiplier tables use the recognizable industry "Plinko" shapes, but each is
 * AUTO-SCALED so the exact expected return equals (1 - edge). Because the bin
 * distribution is an exact binomial, RTP here is exact and variance-free:
 *
 *     P(bin = k) = C(rows, k) / 2^rows
 *     RTP        = Σ P(bin=k) · multiplier[k]  ==  (1 - edge)   (pre-2dp-rounding)
 *
 * The path (and thus the bin) is derived from (serverSeed, clientSeed, nonce) via a
 * per-row HMAC bit — bound to the same commitment as every other Clutch game.
 */

import { floatFor, type RoundSeeds } from "./provablyfair";
import { DEFAULT_EDGE } from "./crash";

export type Risk = "low" | "medium" | "high";
export const ROWS_OPTIONS = [8, 12, 16] as const;
export const RISKS: Risk[] = ["low", "medium", "high"];
export const DEFAULT_ROWS = 12;
export const DEFAULT_RISK: Risk = "medium";
export const TAG_PLINKO = "plinko";

/** Recognizable industry multiplier SHAPES per (rows, risk); auto-scaled to RTP below. */
const SHAPES: Record<number, Record<Risk, number[]>> = {
  8: {
    low: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
    medium: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
    high: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
  },
  12: {
    low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
    medium: [24, 5, 3, 1.5, 0.7, 0.4, 0.5, 0.4, 0.7, 1.5, 3, 5, 24],
    high: [58, 8, 3, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 3, 8, 58],
  },
  16: {
    low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
    medium: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
    high: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000],
  },
};

function binom(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let c = 1;
  for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
  return c;
}

/** Exact bin probabilities for `rows` (binomial, fair coin). */
export function binProbs(rows: number): number[] {
  const tot = Math.pow(2, rows);
  return Array.from({ length: rows + 1 }, (_, k) => binom(rows, k) / tot);
}

function baseShape(rows: number, risk: Risk): number[] {
  const s = SHAPES[rows]?.[risk];
  if (!s) throw new RangeError(`no Plinko table for rows=${rows} risk=${risk}`);
  return s;
}

/**
 * The payout multiplier per bin, auto-scaled so the exact RTP equals (1 - edge).
 * Values are floored to 2dp (so realized RTP is (1-edge) minus a tiny rounding loss).
 */
export function multiplierTable(rows: number, risk: Risk, edge: number = DEFAULT_EDGE): number[] {
  const shape = baseShape(rows, risk);
  const p = binProbs(rows);
  const raw = shape.reduce((a, m, k) => a + p[k]! * m, 0);
  const scale = (1 - edge) / raw;
  return shape.map((m) => Math.floor(m * scale * 100) / 100);
}

/** Exact RTP of the scaled table (sanity/QA — should be ~(1-edge)). */
export function rtpOf(rows: number, risk: Risk, edge: number = DEFAULT_EDGE): number {
  const t = multiplierTable(rows, risk, edge);
  const p = binProbs(rows);
  return t.reduce((a, m, k) => a + p[k]! * m, 0);
}

export interface DropResult {
  /** Left/right bit per row (false = left, true = right). */
  path: boolean[];
  /** Landing bin = number of rights (0..rows). */
  bin: number;
  /** Payout multiplier for the landing bin. */
  multiplier: number;
}

/** Provably-fair drop: a per-row HMAC bit decides left/right; bin = rights. */
export function drop(seeds: RoundSeeds, rows: number, risk: Risk, edge: number = DEFAULT_EDGE): DropResult {
  const table = multiplierTable(rows, risk, edge);
  const path: boolean[] = [];
  let bin = 0;
  for (let i = 0; i < rows; i++) {
    const right = floatFor(seeds, `${TAG_PLINKO}:${i}`) >= 0.5;
    path.push(right);
    if (right) bin++;
  }
  return { path, bin, multiplier: table[bin]! };
}
