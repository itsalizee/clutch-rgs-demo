/**
 * engine.ts — server-authoritative engine for the "Originals" pack (Dice, Limbo,
 * Wheel). Single-shot: one play settles immediately. Each play draws the next
 * pre-committed chain seed + player entropy, dispatches to the pure per-game math,
 * and returns the outcome + reveal — provably fair and anti-grind.
 */

import {
  SeedChain, type EntropySource, ChainedEntropySource, type RoundSeeds, commit,
} from "../../engine/index.js";
import {
  diceOutcome, DICE_MIN_TARGET, DICE_MAX_TARGET, type DiceDir,
  limboOutcome, LIMBO_MIN_TARGET, LIMBO_MAX_TARGET,
  wheelOutcome, wheelTable, WHEEL_SEGMENTS, WHEEL_RISKS, DEFAULT_SEGMENTS, DEFAULT_WHEEL_RISK, type WheelRisk,
} from "../../engine/index.js";
import { DEFAULT_EDGE } from "../../engine/crash.js";

export type OriginalGame = "dice" | "limbo" | "wheel";
export interface Reveal { serverSeed: string; clientSeed: string; nonce: number; }

export type PlayParams =
  | { game: "dice"; target: number; dir: DiceDir }
  | { game: "limbo"; target: number }
  | { game: "wheel"; segments: number; risk: WheelRisk };

export interface PlayOutcome {
  game: OriginalGame;
  commitment: string;
  clientSeed: string;
  nonce: number;
  multiplier: number;
  detail: Record<string, unknown>; // game-specific (roll/generated/segment, won, etc.)
  reveal: Reveal;
}

export class OriginalsEngineError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "OriginalsEngineError"; }
}

export interface OriginalsEngineDeps {
  seedChain?: SeedChain;
  chainLength?: number;
  randomBytes: (n: number) => Uint8Array;
  entropy?: EntropySource;
  edge?: number;
  genesis?: string;
}

export class OriginalsEngine {
  private nonce = 0;
  private seedChain: SeedChain;
  private entropy: EntropySource;
  private edge: number;
  private prevServerSeed: string;

  constructor(deps: OriginalsEngineDeps) {
    this.seedChain = deps.seedChain ?? new SeedChain(deps.chainLength ?? 100_000, deps.randomBytes);
    this.entropy = deps.entropy ?? new ChainedEntropySource();
    this.edge = deps.edge ?? DEFAULT_EDGE;
    this.prevServerSeed = deps.genesis ?? "ascent-originals-genesis";
  }

  get edgeValue(): number { return this.edge; }
  get fairness(): { serverSeedChainTerminal: string; chainRemaining: number; clientSeedScheme: string; edge: number } {
    return { serverSeedChainTerminal: this.seedChain.terminal, chainRemaining: this.seedChain.remaining, clientSeedScheme: this.entropy.describe(), edge: this.edge };
  }

  config() {
    const tables: Record<string, number[]> = {};
    for (const seg of WHEEL_SEGMENTS) for (const risk of WHEEL_RISKS) tables[`${seg}:${risk}`] = wheelTable(seg, risk, this.edge);
    return {
      edge: this.edge,
      dice: { minTarget: DICE_MIN_TARGET, maxTarget: DICE_MAX_TARGET },
      limbo: { minTarget: LIMBO_MIN_TARGET, maxTarget: LIMBO_MAX_TARGET },
      wheel: { segments: [...WHEEL_SEGMENTS], risks: WHEEL_RISKS, defaultSegments: DEFAULT_SEGMENTS, defaultRisk: DEFAULT_WHEEL_RISK, tables },
    };
  }

  play(p: PlayParams, clientEntropy?: string): PlayOutcome {
    const n = this.nonce++;
    const serverSeed = this.seedChain.next().serverSeed;
    const clientSeed = this.entropy.clientSeedFor({ nonce: n, prevServerSeed: this.prevServerSeed, playerEntropy: clientEntropy ? [clientEntropy] : [] });
    const seeds: RoundSeeds = { serverSeed, clientSeed, nonce: n };
    let multiplier: number; let detail: Record<string, unknown>;
    try {
      if (p.game === "dice") { const o = diceOutcome(seeds, p.target, p.dir, this.edge); multiplier = o.multiplier; detail = { roll: o.roll, won: o.won, target: o.target, dir: o.dir }; }
      else if (p.game === "limbo") { const o = limboOutcome(seeds, p.target, this.edge); multiplier = o.multiplier; detail = { generated: o.generated, won: o.won, target: o.target }; }
      else if (p.game === "wheel") { const o = wheelOutcome(seeds, p.segments, p.risk, this.edge); multiplier = o.multiplier; detail = { segment: o.segment, segments: o.segments, risk: o.risk, won: o.multiplier > 0 }; }
      else throw new OriginalsEngineError("bad_game", "unknown game");
    } catch (e) { throw new OriginalsEngineError((e as OriginalsEngineError).code ?? "bad_params", (e as Error).message); }
    this.prevServerSeed = serverSeed; // chain forward
    return { game: p.game, commitment: commit(serverSeed), clientSeed, nonce: n, multiplier, detail, reveal: { serverSeed, clientSeed, nonce: n } };
  }
}
