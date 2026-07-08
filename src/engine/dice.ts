/**
 * dice.ts — the classic provably-fair Dice. PURE. Roll a number in [0,100); bet
 * that it lands over/under a target. Win chance and multiplier are exact:
 *   chance(over t)  = (100 - t)/100      chance(under t) = t/100
 *   multiplier      = (1 - edge) / chance     ⇒  EV = chance · multiplier = (1 - edge)
 * The roll is derived from (serverSeed, clientSeed, nonce) via one HMAC draw.
 */

import { floatFor, type RoundSeeds } from "./provablyfair";
import { DEFAULT_EDGE } from "./crash";

export type DiceDir = "over" | "under";
export const DICE_MIN_TARGET = 2;    // keeps multiplier below ~48× and chance sane
export const DICE_MAX_TARGET = 98;
export const TAG_DICE = "dice";

/** The roll, in [0, 100) with 2 decimals. */
export function rollFor(seeds: RoundSeeds): number {
  return Math.floor(floatFor(seeds, TAG_DICE) * 10000) / 100;
}

/** Win chance in PERCENT (0..100) for a target + direction. */
export function winChancePct(target: number, dir: DiceDir): number {
  return dir === "over" ? 100 - target : target;
}

/** Payout multiplier for a target + direction (2dp floor). */
export function diceMultiplier(target: number, dir: DiceDir, edge: number = DEFAULT_EDGE): number {
  const wc = winChancePct(target, dir);
  if (wc <= 0 || wc >= 100) throw new RangeError(`target ${target} out of range`);
  return Math.floor(((1 - edge) * 100 / wc) * 100) / 100;
}

export interface DiceOutcome { roll: number; won: boolean; multiplier: number; target: number; dir: DiceDir; }

export function diceOutcome(seeds: RoundSeeds, target: number, dir: DiceDir, edge: number = DEFAULT_EDGE): DiceOutcome {
  if (!(target >= DICE_MIN_TARGET && target <= DICE_MAX_TARGET)) throw new RangeError(`target must be ${DICE_MIN_TARGET}..${DICE_MAX_TARGET}`);
  const roll = rollFor(seeds);
  const won = dir === "over" ? roll > target : roll < target;
  return { roll, won, multiplier: won ? diceMultiplier(target, dir, edge) : 0, target, dir };
}
