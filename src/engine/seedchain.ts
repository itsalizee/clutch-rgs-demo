/**
 * seedchain.ts — pre-committed server-seed chain (the anti-grind hardening).
 *
 * THE PROBLEM IT SOLVES
 * ---------------------
 * A fresh random server seed per round lets a malicious operator *grind*:
 * generate many candidate seeds, compute the crash each would produce, and
 * commit a house-favourable one. The per-round commitment doesn't stop this,
 * because the operator still chooses the seed.
 *
 * THE FIX (bustabit-style hash chain)
 * -----------------------------------
 * Generate the whole sequence of seeds BACKWARD from one random tip, so the
 * entire run of outcomes is fixed by a single value published BEFORE round 0:
 *
 *     chain[len-1] = random tip
 *     chain[i]     = SHA256( chain[i+1] )        // hash backward
 *     terminal     = SHA256( chain[0] )          // PUBLISHED before any round
 *
 * Rounds consume the chain FORWARD: round k uses chain[k]. Therefore
 *
 *     SHA256( seed_k ) === seed_{k-1}            // links to the previous reveal
 *     SHA256( seed_0 ) === terminal              // links to the public commitment
 *
 * Anyone can take a round's revealed seed, hash it once, and confirm it equals
 * the previous round's seed — walking all the way back to the terminal that was
 * published before the operator had seen a single bet. The operator cannot grind
 * because the order, and every outcome, was sealed by one pre-published hash.
 *
 * NOTE: seeds are hex strings; we hash the hex STRING (its UTF-8 bytes)
 * consistently everywhere, so verifiers re-run SHA256 on the exact reveal text.
 */

import { sha256hex, bytesToHex } from "./provablyfair";

export interface ChainDraw {
  /** Position consumed (0-based). */
  index: number;
  /** The server seed for this round (secret until the round reveals it). */
  serverSeed: string;
}

export class SeedChain {
  private chain: string[];
  private cursor = 0;
  /** SHA256(chain[0]) — publish this BEFORE round 0. The whole run links to it. */
  readonly terminal: string;

  constructor(length: number, randomBytes: (n: number) => Uint8Array, presetSeeds?: string[]) {
    if (presetSeeds) {
      if (presetSeeds.length < 1) throw new RangeError("preset chain must be non-empty");
      this.chain = [...presetSeeds];
    } else {
      if (!Number.isInteger(length) || length < 1) throw new RangeError("chain length must be a positive integer");
      const chain = new Array<string>(length);
      chain[length - 1] = bytesToHex(randomBytes(32));
      for (let i = length - 2; i >= 0; i--) chain[i] = sha256hex(chain[i + 1]!);
      this.chain = chain;
    }
    this.terminal = sha256hex(this.chain[0]!);
  }

  /**
   * Build a chain from an explicit ordered seed list — for deterministic tests
   * and for REPLAYING a known run from logs (brief §8 deterministic replay).
   * The caller is responsible for the linkage invariant; the public factory in
   * production is the random constructor.
   */
  static fromSeeds(seeds: string[]): SeedChain {
    return new SeedChain(seeds.length, () => new Uint8Array(0), seeds);
  }

  get length(): number { return this.chain.length; }
  get consumed(): number { return this.cursor; }
  get remaining(): number { return this.chain.length - this.cursor; }

  /** Draw the next seed in order. Throws when exhausted → rotate to a new chain. */
  next(): ChainDraw {
    if (this.cursor >= this.chain.length) throw new Error("seed_chain_exhausted");
    const index = this.cursor++;
    return { index, serverSeed: this.chain[index]! };
  }

  /** Peek a position without consuming (verification / replay). */
  at(index: number): string {
    const s = this.chain[index];
    if (s === undefined) throw new RangeError(`index ${index} out of range`);
    return s;
  }
}

/**
 * Verify a single chain link: SHA256(serverSeed) must equal the seed revealed in
 * the PREVIOUS round, or — for the first round — the pre-published `terminal`.
 * This is all a verifier needs, applied across consecutive reveals.
 */
export function verifyChainLink(serverSeed: string, previousRevealOrTerminal: string): boolean {
  return sha256hex(serverSeed) === previousRevealOrTerminal.toLowerCase();
}
