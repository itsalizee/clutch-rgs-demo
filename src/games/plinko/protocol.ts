/**
 * protocol.ts — canonical WebSocket contract for Prism (Plinko). Money crosses the
 * wire as integer MINOR units. Single-shot: the client sends a drop and renders the
 * server-computed path + payout.
 */

import type { Minor } from "../../engine/index.js";
import type { Risk } from "../../engine/plinko.js";
import type { Reveal } from "./engine.js";

export type PlinkoClientMessage =
  | { type: "hello"; sessionToken: string; mode: "real" | "demo" }
  | { type: "drop"; stake: Minor; rows: number; risk: Risk; clientEntropy?: string }
  | { type: "ping" };

export interface PlinkoConfig {
  rows: number[];
  risks: Risk[];
  defaultRows: number;
  defaultRisk: Risk;
  tables: Record<string, number[]>;
}

export type PlinkoServerMessage =
  | { type: "welcome"; sessionId: string; currency: string; balance: Minor; edge: number; config: PlinkoConfig }
  | { type: "drop_result"; dropId: string; commitment: string; clientSeed: string; nonce: number;
      rows: number; risk: Risk; path: boolean[]; bin: number; multiplier: number; payout: Minor; balance: Minor; reveal: Reveal }
  | { type: "balance"; balance: Minor }
  | { type: "pong" }
  | { type: "error"; code: string; message: string };
