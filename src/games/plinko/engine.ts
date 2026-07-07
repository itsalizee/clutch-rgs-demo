/**
 * engine.ts — server-authoritative engine for "Prism" (Plinko). Single-shot:
 * one drop settles immediately. The ball's path is computed SERVER-SIDE from the
 * pre-committed seed chain + player entropy and returned with the reveal, so it's
 * provably fair and anti-grind (bound to the same commitment scheme as every game).
 *
 * Money is NOT here — the orchestrator debits the stake and credits stake×multiplier.
 */

import {
  SeedChain, type EntropySource, ChainedEntropySource, type RoundSeeds, commit,
} from "../../engine/index.js";
import {
  drop as dropMath, multiplierTable, ROWS_OPTIONS, RISKS, DEFAULT_ROWS, DEFAULT_RISK,
  type Risk,
} from "../../engine/plinko.js";
import { type Minor } from "../../engine/money.js";
import { DEFAULT_EDGE } from "../../engine/crash.js";

export interface DropReq {
  sessionId: string;
  betId: string;
  stake: Minor;
  rows: number;
  risk: Risk;
  clientEntropy?: string;
}

export interface Reveal { serverSeed: string; clientSeed: string; nonce: number; }

export interface DropOutcome {
  commitment: string;   // SHA-256(serverSeed), pre-committed via the chain
  clientSeed: string;
  nonce: number;
  rows: number;
  risk: Risk;
  path: boolean[];      // left/right per row
  bin: number;          // landing bin
  multiplier: number;   // payout multiplier
  reveal: Reveal;       // serverSeed revealed (instant game — settled at drop)
}

export class PlinkoEngineError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "PlinkoEngineError"; }
}

export interface PlinkoEngineDeps {
  seedChain?: SeedChain;
  chainLength?: number;
  randomBytes: (n: number) => Uint8Array;
  entropy?: EntropySource;
  edge?: number;
  genesis?: string;
}

export class PlinkoEngine {
  private nonce = 0;
  private seedChain: SeedChain;
  private entropy: EntropySource;
  private edge: number;
  private prevServerSeed: string;

  constructor(deps: PlinkoEngineDeps) {
    this.seedChain = deps.seedChain ?? new SeedChain(deps.chainLength ?? 100_000, deps.randomBytes);
    this.entropy = deps.entropy ?? new ChainedEntropySource();
    this.edge = deps.edge ?? DEFAULT_EDGE;
    this.prevServerSeed = deps.genesis ?? "ascent-plinko-genesis";
  }

  get edgeValue(): number { return this.edge; }

  get fairness(): { serverSeedChainTerminal: string; chainRemaining: number; clientSeedScheme: string; edge: number } {
    return {
      serverSeedChainTerminal: this.seedChain.terminal,
      chainRemaining: this.seedChain.remaining,
      clientSeedScheme: this.entropy.describe(),
      edge: this.edge,
    };
  }

  /** Full config (rows options, risks, and the per-config multiplier tables). */
  config(): { rows: number[]; risks: Risk[]; defaultRows: number; defaultRisk: Risk; tables: Record<string, number[]> } {
    const tables: Record<string, number[]> = {};
    for (const r of ROWS_OPTIONS) for (const k of RISKS) tables[`${r}:${k}`] = multiplierTable(r, k, this.edge);
    return { rows: [...ROWS_OPTIONS], risks: RISKS, defaultRows: DEFAULT_ROWS, defaultRisk: DEFAULT_RISK, tables };
  }

  drop(req: DropReq): DropOutcome {
    if (!ROWS_OPTIONS.includes(req.rows as (typeof ROWS_OPTIONS)[number])) throw new PlinkoEngineError("bad_rows", "unsupported rows");
    if (!RISKS.includes(req.risk)) throw new PlinkoEngineError("bad_risk", "unknown risk");
    const n = this.nonce++;
    const serverSeed = this.seedChain.next().serverSeed;
    const clientSeed = this.entropy.clientSeedFor({
      nonce: n,
      prevServerSeed: this.prevServerSeed,
      playerEntropy: req.clientEntropy ? [req.clientEntropy] : [],
    });
    const seeds: RoundSeeds = { serverSeed, clientSeed, nonce: n };
    const res = dropMath(seeds, req.rows, req.risk, this.edge);
    this.prevServerSeed = serverSeed; // chain forward — each drop consumes one link
    return {
      commitment: commit(serverSeed), clientSeed, nonce: n,
      rows: req.rows, risk: req.risk, path: res.path, bin: res.bin, multiplier: res.multiplier,
      reveal: { serverSeed, clientSeed, nonce: n },
    };
  }
}
