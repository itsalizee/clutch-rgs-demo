/**
 * crash.ts — the crash-point formula. PURE. Single source of truth for EDGE.
 *
 * RGS port: the house edge is now a PARAMETER (per-operator configurable, §7 of
 * the build brief) instead of a module constant. The same provably-fair float is
 * mapped to a crash point under a given edge, so a verifier that knows the
 * operator's configured edge can reproduce the exact result. DEFAULT_EDGE keeps
 * the original 3% (97% RTP) as the default.
 *
 * The client NEVER calls this to decide an outcome; the RGS does. The client and
 * the test suite import it only to render and to verify.
 */

import { floatFor, TAG_CRASH, type RoundSeeds } from "./provablyfair";

/** Default house edge: 0.03 => 97% RTP. Operators may override per-config. */
export const DEFAULT_EDGE = 0.03;

/** Lowest possible multiplier — an "instant rug". */
export const MIN_MULTIPLIER = 1.0;

/** Theoretical RTP implied by an edge. */
export function rtpForEdge(edge: number): number {
  return 1 - edge;
}

/** Guard an edge value into a sane range. Operators configure ~1%–10%. */
export function assertValidEdge(edge: number): void {
  if (!(edge >= 0 && edge < 0.5) || Number.isNaN(edge)) {
    throw new RangeError(`edge must be in [0, 0.5); got ${edge}`);
  }
}

/**
 * Map a uniform r in [0, 1) to a crash multiplier under a given edge.
 *
 *   crash = floor( (1 - edge) / (1 - r) * 100 ) / 100
 *
 * Anything below 1.00 clamps to an instant rug at 1.00x. Truncating to 2 dp is
 * what creates the ~edge share of instant rugs and yields P(crash >= x) ~= RTP/x.
 * Pure function of (r, edge) — no state, no history, no adaptive difficulty.
 */
export function crashFromFloat(r: number, edge: number = DEFAULT_EDGE): number {
  if (r < 0 || r >= 1 || Number.isNaN(r)) {
    throw new RangeError(`crashFromFloat expects r in [0,1); got ${r}`);
  }
  assertValidEdge(edge);
  const raw = Math.floor((rtpForEdge(edge) / (1 - r)) * 100) / 100;
  return raw < MIN_MULTIPLIER ? MIN_MULTIPLIER : raw;
}

/** Convenience: did this float produce an instant rug under this edge? */
export function isInstantRug(r: number, edge: number = DEFAULT_EDGE): boolean {
  return crashFromFloat(r, edge) === MIN_MULTIPLIER;
}

/** Derive the crash point for a round from its committed seeds and edge. */
export function crashPoint(seeds: RoundSeeds, edge: number = DEFAULT_EDGE): number {
  return crashFromFloat(floatFor(seeds, TAG_CRASH), edge);
}
