/**
 * engine.ts — server-authoritative European roulette engine. Single-shot: one
 * spin settles immediately. Each spin draws the next pre-committed chain seed +
 * player entropy, picks the winning number, and resolves every bet against the
 * canonical catalog — provably fair and anti-grind, like the Originals pack.
 */

import { SeedChain, type EntropySource, ChainedEntropySource, type RoundSeeds, commit } from "../../engine/index.js";
import {
  rouletteNumber, resolveBets, validateBets, rouletteColor, rouletteCatalog,
  WHEEL_ORDER, RED_NUMBERS, ROULETTE_POCKETS, ROULETTE_EDGE,
  type BetInput, type BetResult, type RColor, RouletteError,
} from "../../engine/roulette.js";

export interface Reveal { serverSeed: string; clientSeed: string; nonce: number; }

export interface SpinOutcome {
  number: number;
  color: RColor;
  commitment: string;
  clientSeed: string;
  nonce: number;
  results: BetResult[];
  totalStake: number;
  totalReturn: number;
  reveal: Reveal;
}

export interface RouletteEngineDeps {
  seedChain?: SeedChain;
  chainLength?: number;
  randomBytes: (n: number) => Uint8Array;
  entropy?: EntropySource;
  genesis?: string;
}

export class RouletteEngine {
  private nonce = 0;
  private seedChain: SeedChain;
  private entropy: EntropySource;
  private prevServerSeed: string;
  private cat = rouletteCatalog();

  constructor(deps: RouletteEngineDeps) {
    this.seedChain = deps.seedChain ?? new SeedChain(deps.chainLength ?? 100_000, deps.randomBytes);
    this.entropy = deps.entropy ?? new ChainedEntropySource();
    this.prevServerSeed = deps.genesis ?? "ascent-roulette-genesis";
  }

  get edgeValue(): number { return ROULETTE_EDGE; }
  get fairness(): { serverSeedChainTerminal: string; chainRemaining: number; clientSeedScheme: string; edge: number } {
    return { serverSeedChainTerminal: this.seedChain.terminal, chainRemaining: this.seedChain.remaining, clientSeedScheme: this.entropy.describe(), edge: ROULETTE_EDGE };
  }

  config() {
    return { pockets: ROULETTE_POCKETS, wheelOrder: [...WHEEL_ORDER], red: RED_NUMBERS, edge: ROULETTE_EDGE };
  }

  /** Validate a bet list without drawing (so the orchestrator can debit safely). Returns total stake. */
  validate(bets: BetInput[]): number { return validateBets(bets, this.cat); }

  /** Draw the winning number and resolve every bet. Throws RouletteError on an illegal bet list. */
  spin(bets: BetInput[], clientEntropy?: string): SpinOutcome {
    validateBets(bets, this.cat); // defensive: never draw on an invalid list
    const n = this.nonce++;
    const serverSeed = this.seedChain.next().serverSeed;
    const clientSeed = this.entropy.clientSeedFor({ nonce: n, prevServerSeed: this.prevServerSeed, playerEntropy: clientEntropy ? [clientEntropy] : [] });
    const seeds: RoundSeeds = { serverSeed, clientSeed, nonce: n };
    const number = rouletteNumber(seeds);
    const { results, totalStake, totalReturn } = resolveBets(bets, number, this.cat);
    this.prevServerSeed = serverSeed; // chain forward
    return {
      number, color: rouletteColor(number), commitment: commit(serverSeed),
      clientSeed, nonce: n, results, totalStake, totalReturn,
      reveal: { serverSeed, clientSeed, nonce: n },
    };
  }
}

export { RouletteError };
