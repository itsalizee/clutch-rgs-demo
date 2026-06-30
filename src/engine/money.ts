/**
 * money.ts — money is ALWAYS integer minor units (cents, sats, etc.). Never a
 * float touches a balance (brief §5, §12). Multipliers are decimals used only to
 * compute an integer payout, rounded DOWN (house-favourable, deterministic).
 */

/** A monetary amount in integer minor units (e.g. cents). Branded for safety. */
export type Minor = number & { readonly __brand: "Minor" };

export function minor(n: number): Minor {
  if (!Number.isInteger(n)) throw new TypeError(`money must be an integer minor unit; got ${n}`);
  return n as Minor;
}

export function isMinor(n: number): n is Minor {
  return Number.isInteger(n) && Number.isFinite(n);
}

/**
 * Payout = floor(stake * multiplier), in minor units. Rounding down is the only
 * rounding that ever happens to money; it is deterministic and logged.
 */
export function payoutFor(stake: Minor, multiplier: number): Minor {
  if (!(multiplier >= 1)) throw new RangeError(`multiplier must be >= 1; got ${multiplier}`);
  return minor(Math.floor(stake * multiplier));
}

/** Skim a fraction of a stake into the pool, floored to an integer minor unit. */
export function skim(stake: Minor, fraction: number): Minor {
  return minor(Math.floor(stake * fraction));
}
