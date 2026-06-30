/**
 * messages.ts — canonical WebSocket protocol (client <-> RGS).
 *
 * This is OUR contract. Per-aggregator adapters translate their protocol to it;
 * it never leaks an aggregator's shape (brief §12). The player client is a thin
 * renderer: it sends intents and renders server truth.
 */

import type { Minor } from "../engine/index.js";

// ---- client -> server ----
export type ClientMessage =
  | { type: "hello"; sessionToken: string; mode: "real" | "demo"; gameId?: string }
  | { type: "place_bet"; stake: Minor; autoCashOut?: number; clientEntropy?: string }
  | { type: "cash_out"; betId: string }
  | { type: "ping" };

// ---- server -> client ----
export interface PublicRound {
  roundId: string;
  roundNumber: number;
  commitment: string; // SHA-256(serverSeed), published before the round
  nonce: number;
  bettingEndsAt: number;
  // client seed is published at betting close (after player entropy is mixed in)
}

export interface RevealedRound {
  roundId: string;
  roundNumber: number;
  crashPoint: number;
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  jackpotTriggered: boolean;
}

export type ServerMessage =
  | { type: "welcome"; sessionId: string; currency: string; balance: Minor; edge: number; moonPool: Minor }
  | { type: "round_open"; round: PublicRound; moonPool: Minor }
  | { type: "betting_closed"; roundId: string; clientSeed: string; externalEntropy?: string; externalSource?: string }
  | { type: "tick"; roundId: string; multiplier: number }
  | { type: "bet_accepted"; betId: string; stake: Minor; balance: Minor }
  | { type: "cash_out"; betId: string; multiplier: number; payout: Minor; balance: Minor }
  | { type: "cash_out_failed"; betId: string; reason: string }
  | { type: "jackpot"; betId: string; award: Minor; balance: Minor }
  | { type: "crash"; round: RevealedRound; moonPool: Minor }
  | { type: "balance"; balance: Minor }
  | { type: "pong" }
  | { type: "error"; code: string; message: string };
