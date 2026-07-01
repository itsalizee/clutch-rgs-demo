/**
 * mines.ts — the "Vault" mines game math. PURE.
 *
 * A genuinely NEW mechanic (not crash, not crossing): an N-tile grid hides M
 * mines. The player reveals tiles one at a time; each safe reveal raises a
 * cumulative multiplier; revealing a mine ends the run; the player may cash out
 * after any safe reveal. This is the "mines / gems" family.
 *
 * Provably fair + RTP-tunable, reusing the SAME HMAC primitives as every other
 * Clutch game (single source of truth). The multiplier after k safe reveals is
 * derived from the exact hypergeometric survival probability, so RTP is exactly
 * (1 - edge) for ANY number of picks:
 *
 *     P(survive k) = C(N-M, k) / C(N, k) = Π_{i=0..k-1} (N-M-i)/(N-i)
 *     multiplier(k) = (1 - edge) / P(survive k)
 *     EV(cash at k) = P(survive k) · multiplier(k) = (1 - edge)
 *
 * Mine positions come from a provably-fair Fisher–Yates shuffle seeded by
 * (serverSeed, clientSeed, nonce) via per-swap HMAC draws — bound to the same
 * commitment as everything else. The server holds the mine set secret until the
 * run ends; the client only learns "safe" or "mine" per reveal.
 */

import { intFor, type RoundSeeds } from "./provablyfair";
import { DEFAULT_EDGE } from "./crash";

export const TAG_MINES = "mines";

export interface MinesConfig {
  /** Total tiles on the grid (default 25 = 5×5). */
  tiles: number;
  /** Number of hidden mines (1 .. tiles-1). More mines = deadlier = bigger multipliers. */
  mines: number;
}

export const MINES_TILES = 25;
export const DEFAULT_MINES = 3;
/** Mine counts a player may pick (1..24 on a 25-tile grid). */
export const MINES_MIN = 1;
export const MINES_MAX = MINES_TILES - 1;

export function minesConfig(mines: number, tiles: number = MINES_TILES): MinesConfig {
  if (!Number.isInteger(tiles) || tiles < 2) throw new RangeError(`bad tile count ${tiles}`);
  if (!Number.isInteger(mines) || mines < 1 || mines > tiles - 1) {
    throw new RangeError(`mines ${mines} out of range 1..${tiles - 1}`);
  }
  return { tiles, mines };
}

/** Max number of safe reveals possible on this grid (all non-mine tiles). */
export function maxSafe(cfg: MinesConfig): number {
  return cfg.tiles - cfg.mines;
}

/** P(surviving k safe reveals) = Π (N-M-i)/(N-i), exact hypergeometric. */
export function survivalProb(k: number, cfg: MinesConfig): number {
  const N = cfg.tiles, M = cfg.mines;
  if (!Number.isInteger(k) || k < 0 || k > N - M) throw new RangeError(`k ${k} out of range 0..${N - M}`);
  let p = 1;
  for (let i = 0; i < k; i++) p *= (N - M - i) / (N - i);
  return p;
}

/** Cumulative cash-out multiplier after `k` safe reveals (1..maxSafe), 2dp floor. */
export function minesMultiplier(k: number, cfg: MinesConfig, edge: number = DEFAULT_EDGE): number {
  if (!Number.isInteger(k) || k < 1 || k > maxSafe(cfg)) {
    throw new RangeError(`safe count ${k} out of range 1..${maxSafe(cfg)}`);
  }
  const raw = (1 - edge) / survivalProb(k, cfg);
  return Math.floor(raw * 100) / 100;
}

/** The full multiplier ladder (index 0 = 1 safe reveal … index maxSafe-1 = cleared). */
export function minesLadder(cfg: MinesConfig, edge: number = DEFAULT_EDGE): number[] {
  return Array.from({ length: maxSafe(cfg) }, (_, i) => minesMultiplier(i + 1, cfg, edge));
}

/**
 * The hidden mine positions: a provably-fair Fisher–Yates shuffle of tile
 * indices [0..N-1] seeded by the round's committed seeds; the first M shuffled
 * indices are the mines. Uniform over all C(N,M) placements, and fully
 * reproducible from (serverSeed, clientSeed, nonce). Returns the mine tile set.
 */
export function mineSet(seeds: RoundSeeds, cfg: MinesConfig): Set<number> {
  const N = cfg.tiles;
  const idx = Array.from({ length: N }, (_, i) => i);
  for (let i = N - 1; i > 0; i--) {
    const j = intFor(seeds, `${TAG_MINES}:${i}`, i + 1); // uniform in [0, i]
    const tmp = idx[i]!; idx[i] = idx[j]!; idx[j] = tmp;
  }
  return new Set(idx.slice(0, cfg.mines));
}

/** True if `tile` (0..N-1) is a mine under these seeds. */
export function isMine(seeds: RoundSeeds, cfg: MinesConfig, tile: number): boolean {
  if (!Number.isInteger(tile) || tile < 0 || tile >= cfg.tiles) throw new RangeError(`tile ${tile} out of range`);
  return mineSet(seeds, cfg).has(tile);
}
