/**
 * engine.ts — server-authoritative engine for the discrete step-multiplier
 * CROSSING game ("Ascent Cross"). Single-player, turn-based (no shared clock).
 *
 * THE authority rule (same as the crash RGS): the hidden hazard lane is computed
 * and held SERVER-SIDE and is never sent to the client until the run is over. The
 * client sends "hop" intents and renders what the server returns — it cannot see
 * where the hazard is, so it cannot cheat. Outcomes are provably fair and bound
 * to the same pre-committed server-seed chain + entropy as the crash game.
 *
 * Money is NOT here (debit on open, credit on cash-out) — the orchestrator owns
 * that, keeping game logic and the wallet cleanly separated.
 */

import {
  SeedChain, type EntropySource, ChainedEntropySource, type RoundSeeds, commit,
} from "../../engine/index.js";
import {
  configFor, failLane as deriveFailLane, stepMultiplier, ladder as buildLadder,
  type Difficulty, type DifficultyConfig,
} from "../../engine/stepcross.js";
import { type Minor } from "../../engine/money.js";
import { DEFAULT_EDGE } from "../../engine/crash.js";

export interface OpenRunReq {
  runId: string;
  sessionId: string;
  betId: string;
  stake: Minor;
  difficulty: Difficulty;
  /** Player entropy folded into the client seed (anti-genesis-grind). */
  clientEntropy?: string;
}

export interface Reveal {
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  /** The hazard lane (first un-survivable lane), revealed only when the run ends. */
  failLane: number;
}

export interface RunOpen {
  runId: string;
  commitment: string;     // SHA-256(serverSeed), pre-run
  clientSeed: string;     // public (includes the player's entropy)
  nonce: number;
  difficulty: Difficulty;
  lanes: number;
  ladder: number[];       // cash-out multiplier per lane
}

export interface HopResult {
  status: "alive" | "rugged";
  lane: number;
  /** Locked cash-out multiplier at this lane (0 if rugged). */
  multiplier: number;
  /** Present only when the run ends (rugged). */
  reveal?: Reveal;
}

export interface CashResult {
  status: "cashed";
  lane: number;
  multiplier: number;
  reveal: Reveal;
}

type RunStatus = "active" | "rugged" | "cashed";

interface Run {
  runId: string;
  sessionId: string;
  betId: string;
  stake: Minor;
  difficulty: Difficulty;
  cfg: DifficultyConfig;
  seeds: RoundSeeds;
  commitment: string;
  failLane: number; // SECRET until the run ends
  lane: number;     // current lane (0 = at the start pad)
  status: RunStatus;
}

export class CrossEngineError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "CrossEngineError"; }
}

export interface CrossEngineDeps {
  seedChain?: SeedChain;
  chainLength?: number;
  randomBytes: (n: number) => Uint8Array;
  entropy?: EntropySource;
  edge?: number;
  genesis?: string;
}

export class CrossEngine {
  private runs = new Map<string, Run>();
  private nonce = 0;
  private seedChain: SeedChain;
  private entropy: EntropySource;
  private edge: number;
  private prevServerSeed: string;

  constructor(deps: CrossEngineDeps) {
    this.seedChain = deps.seedChain ?? new SeedChain(deps.chainLength ?? 100_000, deps.randomBytes);
    this.entropy = deps.entropy ?? new ChainedEntropySource();
    this.edge = deps.edge ?? DEFAULT_EDGE;
    this.prevServerSeed = deps.genesis ?? "ascent-cross-genesis";
  }

  get fairness(): { serverSeedChainTerminal: string; chainRemaining: number; clientSeedScheme: string; edge: number } {
    return {
      serverSeedChainTerminal: this.seedChain.terminal,
      chainRemaining: this.seedChain.remaining,
      clientSeedScheme: this.entropy.describe(),
      edge: this.edge,
    };
  }

  /** Open a run: draw the next chain seed, finalise the client seed, fix (secretly) the hazard lane. */
  openRun(req: OpenRunReq): RunOpen {
    if (this.runs.has(req.runId)) throw new CrossEngineError("duplicate_run", `run ${req.runId} exists`);
    const cfg = configFor(req.difficulty);
    const n = this.nonce++;
    const serverSeed = this.seedChain.next().serverSeed;
    const clientSeed = this.entropy.clientSeedFor({
      nonce: n,
      prevServerSeed: this.prevServerSeed,
      playerEntropy: req.clientEntropy ? [req.clientEntropy] : [],
    });
    const seeds: RoundSeeds = { serverSeed, clientSeed, nonce: n };
    const failLane = deriveFailLane(seeds, cfg); // SECRET
    this.runs.set(req.runId, {
      runId: req.runId, sessionId: req.sessionId, betId: req.betId, stake: req.stake,
      difficulty: req.difficulty, cfg, seeds, commitment: commit(serverSeed), failLane, lane: 0, status: "active",
    });
    this.prevServerSeed = serverSeed; // chain forward — each run consumes one link
    return {
      runId: req.runId, commitment: commit(serverSeed), clientSeed, nonce: n,
      difficulty: req.difficulty, lanes: cfg.lanes, ladder: buildLadder(cfg, this.edge),
    };
  }

  /** Advance one lane. Server decides survival; the client never knew the hazard. */
  hop(sessionId: string, runId: string): HopResult {
    const r = this.own(sessionId, runId);
    if (r.status !== "active") throw new CrossEngineError("run_over", "run already settled");
    if (r.lane >= r.cfg.lanes) throw new CrossEngineError("board_cleared", "no lanes left — cash out");
    const next = r.lane + 1;
    r.lane = next;
    if (next === r.failLane) {
      r.status = "rugged";
      return { status: "rugged", lane: next, multiplier: 0, reveal: this.reveal(r) };
    }
    return { status: "alive", lane: next, multiplier: stepMultiplier(next, r.cfg, this.edge) };
  }

  /** Bank the current lane's multiplier. Idempotent once settled. */
  cashOut(sessionId: string, runId: string): CashResult {
    const r = this.own(sessionId, runId);
    if (r.status === "cashed") {
      return { status: "cashed", lane: r.lane, multiplier: r.lane >= 1 ? stepMultiplier(r.lane, r.cfg, this.edge) : 0, reveal: this.reveal(r) };
    }
    if (r.status !== "active") throw new CrossEngineError("run_over", "run already settled");
    if (r.lane < 1) throw new CrossEngineError("nothing_to_cash", "advance at least one lane first");
    r.status = "cashed";
    return { status: "cashed", lane: r.lane, multiplier: stepMultiplier(r.lane, r.cfg, this.edge), reveal: this.reveal(r) };
  }

  getStake(runId: string): Minor { return this.must(runId).stake; }

  private reveal(r: Run): Reveal {
    return { serverSeed: r.seeds.serverSeed, clientSeed: r.seeds.clientSeed, nonce: r.seeds.nonce, failLane: r.failLane };
  }
  private must(runId: string): Run {
    const r = this.runs.get(runId);
    if (!r) throw new CrossEngineError("unknown_run", `unknown run ${runId}`);
    return r;
  }
  private own(sessionId: string, runId: string): Run {
    const r = this.must(runId);
    if (r.sessionId !== sessionId) throw new CrossEngineError("not_your_run", "run belongs to another session");
    return r;
  }
}
