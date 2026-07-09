/**
 * protocol.ts — canonical WebSocket contract for the Originals pack (Dice, Limbo,
 * Wheel). Money crosses the wire as integer MINOR units. Single-shot per play.
 */

import type { Minor } from "../../engine/index.js";
import type { DiceDir } from "../../engine/dice.js";
import type { WheelRisk } from "../../engine/wheel.js";
import type { OriginalGame, Reveal } from "./engine.js";

export type OriginalsClientMessage =
  | { type: "hello"; sessionToken: string; mode: "real" | "demo" }
  | { type: "play"; game: "dice"; stake: Minor; target: number; dir: DiceDir; clientEntropy?: string }
  | { type: "play"; game: "limbo"; stake: Minor; target: number; clientEntropy?: string }
  | { type: "play"; game: "wheel"; stake: Minor; segments: number; risk: WheelRisk; clientEntropy?: string }
  | { type: "play"; game: "slots"; stake: Minor; clientEntropy?: string }
  | { type: "ping" };

export type OriginalsServerMessage =
  | { type: "welcome"; sessionId: string; currency: string; balance: Minor; edge: number; config: ReturnType<import("./engine.js").OriginalsEngine["config"]> }
  | { type: "result"; playId: string; game: OriginalGame; commitment: string; clientSeed: string; nonce: number;
      multiplier: number; detail: Record<string, unknown>; payout: Minor; balance: Minor; reveal: Reveal }
  | { type: "balance"; balance: Minor }
  | { type: "pong" }
  | { type: "error"; code: string; message: string };
