/**
 * round-engine.ts — the server-authoritative SHARED-round crash engine.
 *
 * One engine instance runs a continuous sequence of shared rounds. EVERY player
 * in a round sees the same curve and the same crash point (brief §3). The engine
 * is the sole authority for OUTCOMES and TIMING:
 *   - it generates + commits the server seed before betting closes,
 *   - it privately fixes the crash point (provably fair, secret until reveal),
 *   - it reads its OWN clock to decide multipliers and cash-out timing,
 *   - it runs the Moon Pool trigger + winner selection.
 *
 * It does NOT move money. It emits events; the RGS orchestrator reacts by calling
 * the operator wallet (debit/credit). Keeping money out of the engine keeps the
 * Game Engine and Wallet Gateway cleanly separated (brief §2).
 *
 * Provably-fair note (Phase 1): server seed is random per round and committed
 * before the round; the public client seed CHAINS to the previous round's
 * revealed server seed; nonce = round number. Players can verify every round.
 * A production hardening (pre-committed seed chain + external client-seed entropy
 * to remove any operator-grinding vector) is tracked in docs/provably-fair.md.
 */

import {
  commit,
  crashPoint as deriveCrash,
  isJackpotRound,
  intFor,
  type RoundSeeds,
  type PoolState,
  createPool,
  payJackpot,
  MOONPOOL_CONTRIB,
  type Minor,
  minor,
  skim,
  SeedChain,
  type EntropySource,
  ChainedEntropySource,
  type ExternalEntropyProvider,
} from "../engine/index.js";
import { Emitter } from "./emitter.js";

export type Phase = "betting" | "inflight" | "crashed" | "intermission";
export type BetStatus = "placed" | "cashed" | "lost";

export interface EngineConfig {
  /** BETTING_OPEN window length (ms). */
  bettingMs: number;
  /** Pause between a crash and the next betting window (ms). */
  intermissionMs: number;
  /** Broadcast cadence during flight (ms). Target <50ms for production. */
  tickMs: number;
  /** Multiplier pacing: multiplier = e^(growth * seconds). Pure cosmetics. */
  growth: number;
  /** House edge (0.03 => 97% RTP). Per-operator configurable. */
  edge: number;
  /** Moon Pool seed/reset value, in minor units. */
  moonPoolBase: Minor;
  /** Genesis public client seed for round 0. */
  genesisClientSeed?: string;
}

export interface EngineDeps {
  /** Monotonic ms clock. Injectable for tests. */
  now: () => number;
  /** CSPRNG bytes. Injectable for tests. (Used to build the seed chain if one isn't supplied.) */
  randomBytes: (n: number) => Uint8Array;
  /**
   * Pre-committed server-seed chain (anti-grind). If omitted, one is generated
   * from `randomBytes` at the given `chainLength`. The chain's `terminal` is the
   * value to publish before round 0.
   */
  seedChain?: SeedChain;
  /** Length of the auto-generated chain when `seedChain` is not supplied. */
  chainLength?: number;
  /** Where each round's public client seed comes from. Defaults to ChainedEntropySource. */
  entropy?: EntropySource;
  /**
   * Optional public, operator-unpredictable entropy (e.g. a blockchain block
   * hash) mixed into the client seed. Polled during betting; resilient — a
   * failure just falls back to player/chained entropy. Closes the genesis-grind
   * gap for player-less rounds.
   */
  externalEntropy?: ExternalEntropyProvider;
  /** Schedules a callback; returns a cancel fn. Injectable (defaults to timers). */
  schedule?: (fn: () => void, ms: number) => () => void;
}

export interface PlaceBet {
  betId: string;
  playerId: string;
  sessionId: string;
  stake: Minor;
  /** Server-enforced auto cash-out multiplier (> 1), optional. */
  autoCashOut?: number;
  /**
   * Player-contributed entropy (anti-genesis-grind). Mixed into the round's
   * client seed at betting close, so the operator can't have known this round's
   * outcome when it built the seed chain. Optional; rounds with no contributions
   * fall back to the entropy source's default.
   */
  clientEntropy?: string;
}

export interface BetRecord extends PlaceBet {
  status: BetStatus;
  cashOutMultiplier: number | null;
}

/** Public info broadcast when betting opens. NO outcome fields. */
export interface RoundOpen {
  roundId: string;
  roundNumber: number;
  commitment: string; // SHA-256(serverSeed), pre-round
  nonce: number;
  bettingEndsAt: number; // ms (engine clock)
  moonPool: Minor;
  // NB: the client seed is NOT here — it is finalised at betting close (after
  // collecting player entropy) and published in the `betting_closed` event.
}

export interface Tick {
  roundId: string;
  multiplier: number;
}

/** Emitted the instant a bet locks in (manual or auto). Orchestrator credits. */
export interface CashOut {
  roundId: string;
  betId: string;
  playerId: string;
  stake: Minor;
  multiplier: number;
}

export interface JackpotResult {
  triggered: boolean;
  /** Winning bet (provably-fair pick among holders), if triggered. */
  winnerBetId: string | null;
  winnerPlayerId: string | null;
  award: Minor; // full pool at trigger
}

/** Terminal round result with full reveal — emitted on crash/settlement. */
export interface RoundResult {
  roundId: string;
  roundNumber: number;
  crashPoint: number;
  reveal: RoundSeeds; // serverSeed now public
  jackpot: JackpotResult;
  /** Bets that rode to the crash and lost. */
  lostBetIds: string[];
  /** Final pool balance after settlement. */
  moonPool: Minor;
}

interface EngineEvents extends Record<string, unknown> {
  round_open: RoundOpen;
  betting_closed: { roundId: string; clientSeed: string; externalEntropy?: string; externalSource?: string };
  tick: Tick;
  cashout: CashOut;
  crash: RoundResult;
  phase: { phase: Phase; roundId: string };
}

interface ActiveRound {
  roundId: string;
  roundNumber: number;
  seeds: RoundSeeds;
  commitment: string;
  crashPoint: number; // SECRET until crash
  jackpot: boolean; // SECRET until crash
  phase: Phase;
  inflightStart: number | null; // ms
  bets: Map<string, BetRecord>;
  /** Player-contributed entropy collected during betting (anti-genesis-grind). */
  playerEntropy: string[];
  /** Public external entropy (block hash), fetched during betting if available. */
  externalEntropy?: string;
  externalSource?: string;
  settled: boolean;
}

const DEFAULT_GENESIS = "ascent-genesis-client-seed";

export class RoundEngine {
  readonly events = new Emitter<EngineEvents>();
  private cfg: EngineConfig;
  private now: () => number;
  private randomBytes: (n: number) => Uint8Array;
  private schedule: (fn: () => void, ms: number) => () => void;

  private pool: PoolState;
  private roundNumber = 0;
  private prevServerSeed: string;
  private round: ActiveRound | null = null;
  private cancels: Array<() => void> = [];
  private running = false;
  private seedChain: SeedChain;
  private entropy: EntropySource;
  private externalProvider?: ExternalEntropyProvider;

  constructor(cfg: EngineConfig, deps: EngineDeps) {
    this.cfg = cfg;
    this.now = deps.now;
    this.randomBytes = deps.randomBytes;
    this.schedule = deps.schedule ?? ((fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); });
    this.pool = createPool(cfg.moonPoolBase);
    this.prevServerSeed = cfg.genesisClientSeed ?? DEFAULT_GENESIS;
    // Server seeds come from a PRE-COMMITTED chain (anti-grind), not per-round randomness.
    this.seedChain = deps.seedChain ?? new SeedChain(deps.chainLength ?? 100_000, deps.randomBytes);
    this.entropy = deps.entropy ?? new ChainedEntropySource();
    this.externalProvider = deps.externalEntropy;
  }

  /** Public fairness disclosure for the /fairness endpoint. */
  get fairness(): { serverSeedChainTerminal: string; chainLength: number; chainRemaining: number; clientSeedScheme: string; externalEntropyScheme: string } {
    return {
      serverSeedChainTerminal: this.seedChain.terminal,
      chainLength: this.seedChain.length,
      chainRemaining: this.seedChain.remaining,
      clientSeedScheme: this.entropy.describe(),
      externalEntropyScheme: this.externalProvider?.describe() ?? "none (player entropy only)",
    };
  }

  // ---- lifecycle ----------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.openBetting();
  }

  stop(): void {
    this.running = false;
    for (const c of this.cancels) c();
    this.cancels = [];
  }

  get phase(): Phase { return this.round?.phase ?? "intermission"; }
  get currentRoundId(): string | null { return this.round?.roundId ?? null; }
  get moonPool(): Minor { return minor(this.pool.balance); }
  get poolBooks(): PoolState { return { ...this.pool }; }

  // ---- phase 1: BETTING_OPEN ---------------------------------------------

  private openBetting(): void {
    if (!this.running) return;
    const n = this.roundNumber++;
    // Server seed is the next link of the PRE-COMMITTED chain — not freshly
    // random — so the operator cannot grind it. SHA256(serverSeed) === the prior
    // round's seed, back to a terminal published before round 0.
    const serverSeed = this.seedChain.next().serverSeed;
    // The client seed is finalised at betting CLOSE (after collecting player
    // entropy), so the outcome can't be known while bets are still coming in.
    const seeds: RoundSeeds = { serverSeed, clientSeed: "", nonce: n };

    this.round = {
      roundId: `r-${n}`,
      roundNumber: n,
      seeds,
      commitment: commit(serverSeed),
      crashPoint: 0,  // derived at betting close
      jackpot: false, // derived at betting close
      phase: "betting",
      inflightStart: null,
      bets: new Map(),
      playerEntropy: [],
      settled: false,
    };

    // Kick off the external-entropy fetch now so it can resolve within the betting
    // window (best-effort). Guarded so a late resolve can't touch a later round.
    if (this.externalProvider) {
      const roundId = this.round.roundId;
      void this.externalProvider.forRound(n).then((e) => {
        if (e && this.round && this.round.roundId === roundId && this.round.phase === "betting") {
          this.round.externalEntropy = e.value;
          this.round.externalSource = e.source;
        }
      }).catch(() => { /* resilient: ignore */ });
    }

    const bettingEndsAt = this.now() + this.cfg.bettingMs;
    this.emitPhase("betting");
    this.events.emit("round_open", {
      roundId: this.round.roundId,
      roundNumber: n,
      commitment: this.round.commitment,
      nonce: n,
      bettingEndsAt,
      moonPool: this.moonPool,
    });

    this.cancels.push(this.schedule(() => this.startFlight(), this.cfg.bettingMs));
  }

  // ---- phase 2/3: ROUND_START + IN_FLIGHT --------------------------------

  private startFlight(): void {
    const r = this.round;
    if (!r || !this.running) return;
    // Finalise the client seed from collected player entropy (anti-genesis-grind),
    // THEN fix the crash point + jackpot — only now, after betting has closed and
    // no further inputs can arrive. The operator could not have known this outcome
    // while building the seed chain, because it depends on players' contributions.
    r.seeds.clientSeed = this.entropy.clientSeedFor({
      nonce: r.roundNumber,
      prevServerSeed: this.prevServerSeed,
      playerEntropy: r.playerEntropy,
      externalEntropy: r.externalEntropy,
    });
    r.crashPoint = deriveCrash(r.seeds, this.cfg.edge);
    r.jackpot = isJackpotRound(r.seeds);

    r.phase = "inflight";
    r.inflightStart = this.now();
    this.events.emit("betting_closed", { roundId: r.roundId, clientSeed: r.seeds.clientSeed, externalEntropy: r.externalEntropy, externalSource: r.externalSource });
    this.emitPhase("inflight");
    this.loop();
  }

  /** Multiplier on the engine clock for the active round. */
  multiplierAt(tMs: number): number {
    const r = this.round;
    if (!r || r.inflightStart == null) return 1;
    const seconds = Math.max(0, (tMs - r.inflightStart) / 1000);
    const m = Math.exp(this.cfg.growth * seconds);
    return m < 1 ? 1 : m;
  }

  private loop(): void {
    const r = this.round;
    if (!r || r.phase !== "inflight" || !this.running) return;
    const t = this.now();
    const live = this.multiplierAt(t);

    // Auto cash-outs that are due (and would fire before the rug).
    for (const bet of r.bets.values()) {
      if (
        bet.status === "placed" &&
        bet.autoCashOut !== undefined &&
        bet.autoCashOut <= r.crashPoint &&
        live >= bet.autoCashOut
      ) {
        this.lockCashOut(bet, bet.autoCashOut);
      }
    }

    if (live >= r.crashPoint) {
      this.crash();
      return;
    }

    this.events.emit("tick", { roundId: r.roundId, multiplier: round2(live) });
    this.cancels.push(this.schedule(() => this.loop(), this.cfg.tickMs));
  }

  // ---- phase 4/5: CRASH + SETTLEMENT -------------------------------------

  private crash(): void {
    const r = this.round;
    if (!r || r.settled) return;
    r.phase = "crashed";
    r.settled = true;

    const lostBetIds: string[] = [];
    for (const bet of r.bets.values()) {
      if (bet.status === "placed") { bet.status = "lost"; lostBetIds.push(bet.betId); }
    }

    // Moon Pool: independent provably-fair trigger; a single provably-fair winner
    // among the round's holders (win OR loss eligible).
    let jackpot: JackpotResult = { triggered: false, winnerBetId: null, winnerPlayerId: null, award: minor(0) };
    if (r.jackpot && r.bets.size > 0) {
      const holders = [...r.bets.values()].sort((a, b) => (a.betId < b.betId ? -1 : 1));
      const idx = intFor(r.seeds, "moonpool-winner", holders.length);
      const winner = holders[idx]!;
      const { pool, award } = payJackpot(this.pool, this.cfg.moonPoolBase);
      this.pool = pool;
      jackpot = { triggered: true, winnerBetId: winner.betId, winnerPlayerId: winner.playerId, award: minor(award) };
    }

    const result: RoundResult = {
      roundId: r.roundId,
      roundNumber: r.roundNumber,
      crashPoint: r.crashPoint,
      reveal: { ...r.seeds },
      jackpot,
      lostBetIds,
      moonPool: this.moonPool,
    };
    this.emitPhase("crashed");
    this.events.emit("crash", result);

    this.prevServerSeed = r.seeds.serverSeed; // chain forward
    this.scheduleNext();
  }

  private scheduleNext(): void {
    this.round && (this.round.phase = "intermission");
    this.emitPhase("intermission");
    this.cancels.push(this.schedule(() => this.openBetting(), this.cfg.intermissionMs));
  }

  // ---- player actions -----------------------------------------------------

  /** Register a bet that the orchestrator has already debited. Betting phase only. */
  placeBet(b: PlaceBet): void {
    const r = this.round;
    if (!r || r.phase !== "betting") throw new EngineError("betting_closed", "betting window is closed");
    if (r.bets.has(b.betId)) throw new EngineError("duplicate_bet", `bet ${b.betId} already placed`);
    if (b.autoCashOut !== undefined && !(b.autoCashOut > 1)) {
      throw new EngineError("bad_auto_cashout", "autoCashOut must be > 1");
    }
    r.bets.set(b.betId, { ...b, status: "placed", cashOutMultiplier: null });
    // Fold this player's entropy into the round (finalised into the client seed
    // at betting close). One unpredictable contribution defeats genesis grinding.
    if (b.clientEntropy && b.clientEntropy.length) r.playerEntropy.push(b.clientEntropy);
    // Feed the shared pool (disclosed skim, INTEGER minor units — never floats).
    const c = skim(b.stake, MOONPOOL_CONTRIB);
    this.pool = {
      balance: this.pool.balance + c,
      totalSeeded: this.pool.totalSeeded,
      totalContributed: this.pool.totalContributed + c,
      totalPaidOut: this.pool.totalPaidOut,
    };
  }

  /**
   * Cash a bet out NOW. The engine reads its own clock; the client cannot supply
   * a multiplier. Idempotent: a second call for a settled bet returns its locked
   * state. Returns the locked multiplier, or null if the request lost the race.
   */
  cashOut(betId: string): { multiplier: number } | { lost: true } {
    const r = this.round;
    if (!r) throw new EngineError("no_round", "no active round");
    const bet = r.bets.get(betId);
    if (!bet) throw new EngineError("unknown_bet", `unknown bet ${betId}`);
    if (bet.status === "cashed") return { multiplier: bet.cashOutMultiplier! };
    if (bet.status === "lost" || r.phase !== "inflight") return { lost: true };

    const live = this.multiplierAt(this.now());
    if (live >= r.crashPoint) { return { lost: true }; } // too late; crash will settle
    this.lockCashOut(bet, round2(live));
    return { multiplier: bet.cashOutMultiplier! };
  }

  private lockCashOut(bet: BetRecord, multiplier: number): void {
    bet.status = "cashed";
    bet.cashOutMultiplier = multiplier;
    this.events.emit("cashout", {
      roundId: this.round!.roundId,
      betId: bet.betId,
      playerId: bet.playerId,
      stake: bet.stake,
      multiplier,
    });
  }

  private emitPhase(phase: Phase): void {
    this.events.emit("phase", { phase, roundId: this.round?.roundId ?? "" });
  }
}

export class EngineError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "EngineError"; }
}

/** Money-facing multipliers are 2dp, matching the displayed/derived crash point. */
function round2(m: number): number { return Math.floor(m * 100) / 100; }
