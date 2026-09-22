/**
 * protocol.ts — canonical WebSocket contract for Roulette. Money crosses the wire
 * as integer MINOR units. Single-shot per spin; the client places bets by catalog
 * KEY only (the server owns coverage + payout).
 */

import type { Minor } from "../../engine/index.js";
import type { BetResult, RColor } from "../../engine/roulette.js";
import type { RouletteEngine } from "./engine.js";

export interface WireBet { key: string; amount: Minor; }

export type RouletteClientMessage =
  | { type: "hello"; sessionToken: string; mode: "real" | "demo" }
  | { type: "spin"; bets: WireBet[]; clientEntropy?: string }
  | { type: "ping" };

export type RouletteServerMessage =
  | { type: "welcome"; sessionId: string; currency: string; balance: Minor; edge: number; config: ReturnType<RouletteEngine["config"]> }
  | { type: "result"; playId: string; number: number; color: RColor; commitment: string; clientSeed: string; nonce: number;
      results: BetResult[]; totalStake: Minor; totalReturn: Minor; payout: Minor; balance: Minor;
      reveal: { serverSeed: string; clientSeed: string; nonce: number } }
  | { type: "balance"; balance: Minor }
  | { type: "pong" }
  | { type: "error"; code: string; message: string };
