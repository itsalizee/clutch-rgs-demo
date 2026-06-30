/**
 * moonpool.ts — the Moon Pool progressive jackpot. PURE.
 *
 * The Moon Pool sits ON TOP of the base game. It does NOT touch base RTP: the
 * crash game stays a clean 97%. The pool is funded by an explicit, disclosed
 * skim and pays out on its own independent provably-fair roll.
 *
 *  - Contribution: MOONPOOL_CONTRIB (1.5%) of every buy-in is added to the pool.
 *  - Trigger: an independent roll per round, ~1 in MOONPOOL_ODDS (55), derived
 *    from a DIFFERENT HMAC tag than the crash point (see provablyfair.ts), so it
 *    is uncorrelated with whether the round mooned or rugged.
 *  - Payout: on a trigger, the FULL current pool is awarded to any player who
 *    held a bet that round — WIN OR LOSS. It is a mystery progressive,
 *    independent of the round's crash outcome.
 *  - Reset: after a hit the pool returns to MOONPOOL_BASE (its seed value).
 *
 * PRODUCTION NOTE: the live pool balance and the trigger live on the RGS and are
 * SHARED across all players. This module models that authority so the mock RGS
 * behaves correctly; the client only displays and celebrates what it is told.
 */

import { intFor, TAG_MOONPOOL, type RoundSeeds } from "./provablyfair";

/** Fraction of each buy-in that feeds the pool. Disclosed + configurable. */
export const MOONPOOL_CONTRIB = 0.015;

/** Expected trigger rarity: ~1 in 55 rounds. */
export const MOONPOOL_ODDS = 55;

/** Pool value the jackpot seeds/resets to. */
export const MOONPOOL_BASE = 2500;

/** The contribution (in the same integer-friendly units as the bet) for a buy-in. */
export function contribution(betAmount: number): number {
  return betAmount * MOONPOOL_CONTRIB;
}

/**
 * Independent jackpot roll for a round. True iff this round triggers the pool.
 * Uses TAG_MOONPOOL so it is provably uncorrelated with the crash point.
 */
export function isJackpotRound(seeds: RoundSeeds): boolean {
  return intFor(seeds, TAG_MOONPOOL, MOONPOOL_ODDS) === 0;
}

/**
 * Immutable snapshot of the shared pool. The audit fields make the pool's books
 * provable: the house SEEDS `base` into the pool initially and again on every
 * reset, so the conservation law is
 *
 *     totalSeeded + totalContributed === totalPaidOut + balance
 *
 * at all times. (Contributions alone do NOT conserve, because each hit pays out
 * the house-funded seed too.)
 */
export interface PoolState {
  /** Current pool balance. */
  balance: number;
  /** Running total the house has seeded (initial base + base on each reset). */
  totalSeeded: number;
  /** Running total ever contributed by players. */
  totalContributed: number;
  /** Running total ever paid out. */
  totalPaidOut: number;
}

export function createPool(base: number = MOONPOOL_BASE): PoolState {
  return { balance: base, totalSeeded: base, totalContributed: 0, totalPaidOut: 0 };
}

/** Add a buy-in's contribution to the pool. Returns a new state. */
export function addContribution(pool: PoolState, betAmount: number): PoolState {
  const amt = contribution(betAmount);
  return {
    balance: pool.balance + amt,
    totalSeeded: pool.totalSeeded,
    totalContributed: pool.totalContributed + amt,
    totalPaidOut: pool.totalPaidOut,
  };
}

export interface JackpotPayout {
  pool: PoolState;
  /** Amount awarded to the holder(s) this round. */
  award: number;
}

/**
 * Pay out the full pool and reset it to base. Returns the award and the reset
 * pool. The caller is responsible for crediting the player's wallet.
 */
export function payJackpot(pool: PoolState, base: number = MOONPOOL_BASE): JackpotPayout {
  const award = pool.balance;
  return {
    award,
    pool: {
      balance: base, // house re-seeds the pool
      totalSeeded: pool.totalSeeded + base,
      totalContributed: pool.totalContributed,
      totalPaidOut: pool.totalPaidOut + award,
    },
  };
}
