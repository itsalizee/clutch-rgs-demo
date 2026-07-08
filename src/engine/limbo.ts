/**
 * limbo.ts — provably-fair Limbo. PURE. Pick a target multiplier; the server
 * generates a "crash-like" multiplier instantly (reusing the crash math). Win if
 * generated >= target, paying the target multiplier.
 *   P(generated >= T) = (1 - edge) / T     ⇒  EV = P · T = (1 - edge)
 */

import { floatFor, type RoundSeeds } from "./provablyfair";
import { DEFAULT_EDGE, crashFromFloat } from "./crash";

export const LIMBO_MIN_TARGET = 1.01;
export const LIMBO_MAX_TARGET = 1_000_000;
export const TAG_LIMBO = "limbo";

/** The instantly-generated multiplier (same distribution as a crash point). */
export function limboGenerated(seeds: RoundSeeds, edge: number = DEFAULT_EDGE): number {
  return crashFromFloat(floatFor(seeds, TAG_LIMBO), edge);
}

export interface LimboOutcome { generated: number; won: boolean; multiplier: number; target: number; }

export function limboOutcome(seeds: RoundSeeds, target: number, edge: number = DEFAULT_EDGE): LimboOutcome {
  if (!(target >= LIMBO_MIN_TARGET && target <= LIMBO_MAX_TARGET)) throw new RangeError(`target must be ${LIMBO_MIN_TARGET}..${LIMBO_MAX_TARGET}`);
  const generated = limboGenerated(seeds, edge);
  const won = generated >= target;
  return { generated, won, multiplier: won ? Math.floor(target * 100) / 100 : 0, target };
}
