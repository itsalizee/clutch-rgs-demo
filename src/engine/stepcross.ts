/**
 * stepcross.ts — the discrete step-multiplier "crossing" game math. PURE.
 *
 * A new MECHANIC (not a reskinned crash): the player advances one lane at a time.
 * Each surviving lane raises a cumulative multiplier; a hidden hazard lane ends
 * the run; the player may cash out after any lane. Mechanically this is the
 * Chicken-Road / Mission-Uncrossable family — distinct from continuous crash.
 *
 * Provably fair + RTP-tunable, reusing the SAME HMAC primitives as the crash
 * game (single source of truth). The per-lane survival probability `s` is the
 * one knob per difficulty; the multiplier schedule is derived from it so RTP is
 * exactly (1 - edge) for ANY cash-out strategy:
 *
 *     multiplier(k) = (1 - edge) / s^k        // value after surviving k lanes
 *     P(survive k)  = s^k                      // lanes are independent rolls
 *     EV(cash at k) = multiplier(k) · s^k = (1 - edge)
 *
 * The hidden fail lane is the first lane whose provably-fair roll misses the
 * survival probability — derived from (serverSeed, clientSeed, nonce) via a
 * per-lane HMAC tag, so it's bound to the same commitment as everything else.
 */

import { floatFor, type RoundSeeds } from "./provablyfair";
import { DEFAULT_EDGE } from "./crash";

export type Difficulty = "easy" | "medium" | "hard" | "hardcore";

export interface DifficultyConfig {
  /** Total lanes to cross. */
  lanes: number;
  /** Per-lane survival probability s (0 < s < 1). Lower = deadlier = bigger multipliers. */
  survival: number;
}

/**
 * Tuned so each rung "feels" like its tier (step-1 and max multiplier shown):
 *   easy     step1 ≈ 1.10×   max ≈ 21×      (~1 in 21 to clear)
 *   medium   step1 ≈ 1.24×   max ≈ 260×
 *   hard     step1 ≈ 1.47×   max ≈ 16k×
 *   hardcore step1 ≈ 1.94×   max ≈ 254k×    (coin-flip per lane)
 */
export const DIFFICULTIES: Record<Difficulty, DifficultyConfig> = {
  easy: { lanes: 24, survival: 0.88 },
  medium: { lanes: 22, survival: 0.78 },
  hard: { lanes: 20, survival: 0.66 },
  hardcore: { lanes: 18, survival: 0.5 },
};

export const TAG_STEPCROSS = "stepcross";

export function configFor(d: Difficulty): DifficultyConfig {
  const c = DIFFICULTIES[d];
  if (!c) throw new RangeError(`unknown difficulty ${d}`);
  return c;
}

/** Cumulative cash-out multiplier after surviving `k` lanes (1..lanes), 2dp floor. */
export function stepMultiplier(k: number, cfg: DifficultyConfig, edge: number = DEFAULT_EDGE): number {
  if (!Number.isInteger(k) || k < 1 || k > cfg.lanes) {
    throw new RangeError(`lane ${k} out of range 1..${cfg.lanes}`);
  }
  const raw = (1 - edge) / Math.pow(cfg.survival, k);
  return Math.floor(raw * 100) / 100;
}

/** The full multiplier ladder for a difficulty (index 0 = lane 1). */
export function ladder(cfg: DifficultyConfig, edge: number = DEFAULT_EDGE): number[] {
  return Array.from({ length: cfg.lanes }, (_, i) => stepMultiplier(i + 1, cfg, edge));
}

/**
 * The hidden fail lane: the first lane (1-indexed) the player does NOT survive.
 * Returns `lanes + 1` if every lane is survived (a perfect run). Provably fair —
 * each lane is an independent roll bound to the round's committed seeds.
 */
export function failLane(seeds: RoundSeeds, cfg: DifficultyConfig): number {
  for (let i = 1; i <= cfg.lanes; i++) {
    const r = floatFor(seeds, `${TAG_STEPCROSS}:${i}`);
    if (r >= cfg.survival) return i; // hazard hits on entering lane i
  }
  return cfg.lanes + 1; // cleared the board
}

/**
 * Settle a run: given the hidden fail lane and how far the player chose to go.
 * `cashOutLane` is the lane they cashed out at (0 = never advanced / no win).
 * Returns the multiplier locked (0 if they walked into the hazard).
 */
export function settleRun(failLaneIdx: number, cashOutLane: number, cfg: DifficultyConfig, edge: number = DEFAULT_EDGE): number {
  if (cashOutLane < 1) return 0; // didn't bank anything
  if (cashOutLane >= failLaneIdx) return 0; // advanced into / past the hazard → lost
  return stepMultiplier(Math.min(cashOutLane, cfg.lanes), cfg, edge);
}
