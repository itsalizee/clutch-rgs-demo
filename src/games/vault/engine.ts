/**
 * engine.ts — server-authoritative engine for the "Vault" mines game.
 * Single-player, turn-based. A genuinely new mechanic (not crash, not crossing).
 *
 * THE authority rule (same as every Clutch game): the hidden mine positions are
 * computed and held SERVER-SIDE and never sent to the client until the run ends.
 * The client sends "reveal tile i" intents and renders what the server returns —
 * it cannot see the mines, so it cannot cheat. Placement is provably fair and
 * bound to the same pre-committed server-seed chain + entropy as the crash game.
 *
 * Money is NOT here (debit on open, credit on cash-out) — the orchestrator owns
 * that, keeping game logic and the wallet cleanly separated.
 */

import {
  SeedChain, type EntropySource, ChainedEntropySource, type RoundSeeds, commit,
} from "../../engine/index.js";
import {
  minesConfig, mineSet as deriveMineSet, minesMultiplier, minesLadder, maxSafe,
  type MinesConfig,
} from "../../engine/mines.js";
import { type Minor } from "../../engine/money.js";
import { DEFAULT_EDGE } from "../../engine/crash.js";

export interface OpenRunReq {
  runId: string;
  sessionId: string;
  betId: string;
  stake: Minor;
  mines: number;
  /** Player entropy folded into the client seed (anti-genesis-grind). */
  clientEntropy?: string;
}

export interface Reveal {
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  /** The hidden mine tiles, revealed only when the run ends. */
  mines: number[];
}

export interface RunOpen {
  runId: string;
  commitment: string;   // SHA-256(serverSeed), pre-run
  clientSeed: string;   // public (includes the player's entropy)
  nonce: number;
  tiles: number;
  mines: number;
  ladder: number[];     // cash-out multiplier per number of safe reveals
}

export interface RevealResult {
  status: "safe" | "boom";
  tile: number;
  /** How many safe tiles revealed so far. */
  safe: number;
  /** Locked cash-out multiplier at this point (0 if boom). */
  multiplier: number;
  /** True when every safe tile has been found (auto-completes the run). */
  cleared?: boolean;
  /** Present only when the run ends (boom or cleared). */
  reveal?: Reveal;
}

export interface CashResult {
  status: "cashed";
  safe: number;
  multiplier: number;
  reveal: Reveal;
}

type RunStatus = "active" | "boom" | "cashed";

interface Run {
  runId: string;
  sessionId: string;
  betId: string;
  stake: Minor;
  cfg: MinesConfig;
  seeds: RoundSeeds;
  commitment: string;
  mines: Set<number>;      // SECRET until the run ends
  revealed: Set<number>;   // safe tiles the player has opened
  status: RunStatus;
}

export class VaultEngineError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "VaultEngineError"; }
}

export interface VaultEngineDeps {
  seedChain?: SeedChain;
  chainLength?: number;
  randomBytes: (n: number) => Uint8Array;
  entropy?: EntropySource;
  edge?: number;
  genesis?: string;
}

export class VaultEngine {
  private runs = new Map<string, Run>();
  private nonce = 0;
  private seedChain: SeedChain;
  private entropy: EntropySource;
  private edge: number;
  private prevServerSeed: string;

  constructor(deps: VaultEngineDeps) {
    this.seedChain = deps.seedChain ?? new SeedChain(deps.chainLength ?? 100_000, deps.randomBytes);
    this.entropy = deps.entropy ?? new ChainedEntropySource();
    this.edge = deps.edge ?? DEFAULT_EDGE;
    this.prevServerSeed = deps.genesis ?? "ascent-vault-genesis";
  }

  get fairness(): { serverSeedChainTerminal: string; chainRemaining: number; clientSeedScheme: string; edge: number } {
    return {
      serverSeedChainTerminal: this.seedChain.terminal,
      chainRemaining: this.seedChain.remaining,
      clientSeedScheme: this.entropy.describe(),
      edge: this.edge,
    };
  }

  /** Open a run: draw the next chain seed, finalise the client seed, place (secretly) the mines. */
  openRun(req: OpenRunReq): RunOpen {
    if (this.runs.has(req.runId)) throw new VaultEngineError("duplicate_run", `run ${req.runId} exists`);
    const cfg = minesConfig(req.mines);
    const n = this.nonce++;
    const serverSeed = this.seedChain.next().serverSeed;
    const clientSeed = this.entropy.clientSeedFor({
      nonce: n,
      prevServerSeed: this.prevServerSeed,
      playerEntropy: req.clientEntropy ? [req.clientEntropy] : [],
    });
    const seeds: RoundSeeds = { serverSeed, clientSeed, nonce: n };
    const mines = deriveMineSet(seeds, cfg); // SECRET
    this.runs.set(req.runId, {
      runId: req.runId, sessionId: req.sessionId, betId: req.betId, stake: req.stake,
      cfg, seeds, commitment: commit(serverSeed), mines, revealed: new Set(), status: "active",
    });
    this.prevServerSeed = serverSeed; // chain forward — each run consumes one link
    return {
      runId: req.runId, commitment: commit(serverSeed), clientSeed, nonce: n,
      tiles: cfg.tiles, mines: cfg.mines, ladder: minesLadder(cfg, this.edge),
    };
  }

  /** Reveal a tile. Server decides safe/mine; the client never knew the layout. */
  reveal(sessionId: string, runId: string, tile: number): RevealResult {
    const r = this.own(sessionId, runId);
    if (r.status !== "active") throw new VaultEngineError("run_over", "run already settled");
    if (!Number.isInteger(tile) || tile < 0 || tile >= r.cfg.tiles) throw new VaultEngineError("bad_tile", "tile out of range");
    if (r.revealed.has(tile)) throw new VaultEngineError("already_open", "tile already revealed");

    if (r.mines.has(tile)) {
      r.status = "boom";
      return { status: "boom", tile, safe: r.revealed.size, multiplier: 0, reveal: this.reveal_(r) };
    }
    r.revealed.add(tile);
    const safe = r.revealed.size;
    const multiplier = minesMultiplier(safe, r.cfg, this.edge);
    if (safe >= maxSafe(r.cfg)) {
      // found every safe tile — auto-complete at the top multiplier
      r.status = "cashed";
      return { status: "safe", tile, safe, multiplier, cleared: true, reveal: this.reveal_(r) };
    }
    return { status: "safe", tile, safe, multiplier };
  }

  /** Bank the current multiplier. Idempotent once settled. */
  cashOut(sessionId: string, runId: string): CashResult {
    const r = this.own(sessionId, runId);
    const safe = r.revealed.size;
    if (r.status === "cashed") {
      return { status: "cashed", safe, multiplier: safe >= 1 ? minesMultiplier(safe, r.cfg, this.edge) : 0, reveal: this.reveal_(r) };
    }
    if (r.status !== "active") throw new VaultEngineError("run_over", "run already settled");
    if (safe < 1) throw new VaultEngineError("nothing_to_cash", "reveal at least one safe tile first");
    r.status = "cashed";
    return { status: "cashed", safe, multiplier: minesMultiplier(safe, r.cfg, this.edge), reveal: this.reveal_(r) };
  }

  getStake(runId: string): Minor { return this.must(runId).stake; }

  private reveal_(r: Run): Reveal {
    return { serverSeed: r.seeds.serverSeed, clientSeed: r.seeds.clientSeed, nonce: r.seeds.nonce, mines: [...r.mines].sort((a, b) => a - b) };
  }
  private must(runId: string): Run {
    const r = this.runs.get(runId);
    if (!r) throw new VaultEngineError("unknown_run", `unknown run ${runId}`);
    return r;
  }
  private own(sessionId: string, runId: string): Run {
    const r = this.must(runId);
    if (r.sessionId !== sessionId) throw new VaultEngineError("not_your_run", "run belongs to another session");
    return r;
  }
}
