/**
 * protocol.ts — canonical WebSocket contract for the Crossing game.
 * Money crosses the wire as integer MINOR units. The client sends intents and
 * renders server truth; it never learns the hazard lane until the run ends.
 */

import type { Minor } from "../../engine/index.js";
import type { Difficulty } from "../../engine/stepcross.js";
import type { Reveal } from "./engine.js";

export type CrossClientMessage =
  | { type: "hello"; sessionToken: string; mode: "real" | "demo" }
  | { type: "open_run"; stake: Minor; difficulty: Difficulty; clientEntropy?: string }
  | { type: "hop"; runId: string }
  | { type: "cash_out"; runId: string }
  | { type: "ping" };

export interface PublicRunOpen {
  runId: string;
  commitment: string;
  clientSeed: string;
  nonce: number;
  difficulty: Difficulty;
  lanes: number;
  ladder: number[];
}

export type CrossServerMessage =
  | { type: "welcome"; sessionId: string; currency: string; balance: Minor; edge: number; difficulties: Record<string, { lanes: number; survival: number }> }
  | { type: "run_open"; run: PublicRunOpen; balance: Minor }
  | { type: "hop"; runId: string; lane: number; multiplier: number }
  | { type: "run_over"; runId: string; status: "rugged" | "cashed"; lane: number; multiplier: number; payout: Minor; balance: Minor; reveal: Reveal }
  | { type: "balance"; balance: Minor }
  | { type: "pong" }
  | { type: "error"; code: string; message: string };
