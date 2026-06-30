/**
 * entropy.ts — where each round's PUBLIC client seed comes from.
 *
 * The server-seed chain (seedchain.ts) stops per-round grinding. But if the
 * client seed is fully determined by the chain, a sufficiently motivated
 * operator could still grind the GENESIS: try many tips and keep one whose whole
 * resulting run of crash points is house-favourable. To close that, at least one
 * input per round must be entropy the operator could NOT predict when it built
 * the chain — and cannot control.
 *
 * `EntropySource` is that seam. Production should back it with entropy outside
 * the operator's control:
 *   - PLAYER commit–reveal: each bet contributes a random value during the
 *     betting window; the round's client seed mixes them. The operator can't know
 *     players' future entropy at chain-build time. (Implemented below.)
 *   - PUBLIC chain entropy: e.g. a future Bitcoin/Ethereum block hash decided
 *     after the chain is committed. (Plug a fetcher into `MixedEntropySource`.)
 *
 * `ChainedEntropySource` is the demo default: client seed = SHA256(previous
 * round's revealed server seed). It is fully player-VERIFIABLE every round, but
 * on its own it does NOT defeat genesis grinding — hence the production note.
 */

import { sha256hex } from "./provablyfair";

export interface EntropyContext {
  /** Round number / nonce. */
  nonce: number;
  /** Previous round's revealed server seed (or the genesis label for round 0). */
  prevServerSeed: string;
  /** Player-contributed entropy collected during this round's betting window. */
  playerEntropy: string[];
  /** Optional external public entropy (e.g. a committed future block hash). */
  externalEntropy?: string;
}

export interface EntropySource {
  /** Derive the public client seed for a round. Pure + deterministic. */
  clientSeedFor(ctx: EntropyContext): string;
  /** Human-readable disclosure for the /fairness endpoint. */
  describe(): string;
}

/** Demo default: client seed chains to the previous reveal. Verifiable; not anti-genesis-grind. */
export class ChainedEntropySource implements EntropySource {
  clientSeedFor(ctx: EntropyContext): string {
    return sha256hex(ctx.prevServerSeed);
  }
  describe(): string {
    return "client seed = SHA256(previous round's revealed server seed). Verifiable each round. " +
      "Demo only — production uses MixedEntropySource (player and/or block-hash entropy).";
  }
}

/**
 * Production source: client seed = SHA256 of (prev reveal | sorted player
 * entropy | external entropy | nonce). Any unpredictable contribution (a player
 * seed or a future block hash the operator didn't know at chain-build time)
 * makes genesis grinding useless — the crash points depend on inputs that did
 * not exist when the chain was sealed.
 */
export class MixedEntropySource implements EntropySource {
  clientSeedFor(ctx: EntropyContext): string {
    const players = [...ctx.playerEntropy].sort().join(",");
    const ext = ctx.externalEntropy ?? "";
    return sha256hex(`${ctx.prevServerSeed}|${players}|${ext}|${ctx.nonce}`);
  }
  describe(): string {
    return "client seed = SHA256(prevServerSeed | sorted player entropy | external entropy | nonce). " +
      "At least one unpredictable contribution per round removes any operator grinding vector.";
  }
}
