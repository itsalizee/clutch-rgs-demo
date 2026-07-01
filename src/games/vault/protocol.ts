/**
 * protocol.ts — canonical WebSocket contract for the Vault (mines) game.
 * Money crosses the wire as integer MINOR units. The client sends intents and
 * renders server truth; it never learns the mine layout until the run ends.
 */

import type { Minor } from "../../engine/index.js";
import type { Reveal } from "./engine.js";

export type VaultClientMessage =
  | { type: "hello"; sessionToken: string; mode: "real" | "demo" }
  | { type: "open_run"; stake: Minor; mines: number; clientEntropy?: string }
  | { type: "reveal"; runId: string; tile: number }
  | { type: "cash_out"; runId: string }
  | { type: "ping" };

export interface PublicRunOpen {
  runId: string;
  commitment: string;
  clientSeed: string;
  nonce: number;
  tiles: number;
  mines: number;
  ladder: number[];
}

export type VaultServerMessage =
  | { type: "welcome"; sessionId: string; currency: string; balance: Minor; edge: number; tiles: number; minesRange: { min: number; max: number }; defaultMines: number }
  | { type: "run_open"; run: PublicRunOpen; balance: Minor }
  | { type: "reveal"; runId: string; tile: number; safe: number; multiplier: number }
  | { type: "run_over"; runId: string; status: "boom" | "cashed"; tile: number; safe: number; multiplier: number; payout: Minor; balance: Minor; reveal: Reveal }
  | { type: "balance"; balance: Minor }
  | { type: "pong" }
  | { type: "error"; code: string; message: string };
