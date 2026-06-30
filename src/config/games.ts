/**
 * games.ts — the studio's game registry.
 *
 * One RGS, many titles. Each crash-family game is a CONFIG over the same
 * server-authoritative engine (brief: "adding the next game is a config change,
 * not a project"). A game id routes a player's session to that game's engine.
 *
 * (Vault — a mines-style instant game — is a different genre with its own engine;
 * it is registered separately once built, not as a crash config.)
 */

export type GameType = "crash";

export interface CrashTuning {
  /** BETTING_OPEN window (ms). */
  bettingMs: number;
  /** Pause between crash and next betting window (ms). */
  intermissionMs: number;
  /** Broadcast cadence (ms). */
  tickMs: number;
  /** Multiplier pacing: multiplier = e^(growth * seconds). */
  growth: number;
  /** Moon Pool seed/reset value, MINOR units. */
  moonPoolBase: number;
}

export interface GameDef {
  id: string;
  name: string;
  type: GameType;
  /** Player-facing one-liner. */
  blurb: string;
  /** Client UX flags (server is identical; these drive the front-end). */
  ux: { dualBet?: boolean; turbo?: boolean };
  tuning: CrashTuning;
}

export const GAMES: GameDef[] = [
  {
    id: "ascent",
    name: "Ascent",
    type: "crash",
    blurb: "The pure crash experience — ride the pump, cash out before the rug.",
    ux: {},
    tuning: { bettingMs: 5000, intermissionMs: 3000, tickMs: 40, growth: 0.17, moonPoolBase: 250_000 },
  },
  {
    id: "comet",
    name: "Comet",
    type: "crash",
    blurb: "Dual-multiplier crash — hedge a safe exit against a moonshot in one round.",
    ux: { dualBet: true },
    tuning: { bettingMs: 5000, intermissionMs: 3000, tickMs: 40, growth: 0.17, moonPoolBase: 150_000 },
  },
  {
    id: "pulse",
    name: "Pulse",
    type: "crash",
    blurb: "Turbo crash — ~10-second rounds for high-frequency, stream-friendly play.",
    ux: { turbo: true },
    tuning: { bettingMs: 2500, intermissionMs: 1500, tickMs: 40, growth: 0.34, moonPoolBase: 100_000 },
  },
];

export function getGame(id: string): GameDef | undefined {
  return GAMES.find((g) => g.id === id);
}

export const DEFAULT_GAME_ID = "ascent";
