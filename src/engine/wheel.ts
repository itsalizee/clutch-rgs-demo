/**
 * wheel.ts — provably-fair Wheel of Fortune. PURE. A wheel of `segments` equal
 * slices, each with a multiplier; spin lands on one uniformly. Risk reshapes the
 * multiplier spread (low = many small wins; high = mostly 0 with rare big hits),
 * and each table is AUTO-SCALED so the exact RTP == (1 - edge):
 *   RTP = mean(multipliers) == (1 - edge)   (segments are uniform)
 * The landing segment is one HMAC draw bound to the round's committed seeds.
 */

import { intFor, type RoundSeeds } from "./provablyfair";
import { DEFAULT_EDGE } from "./crash";

export type WheelRisk = "low" | "medium" | "high";
export const WHEEL_SEGMENTS = [20, 30, 40] as const;
export const WHEEL_RISKS: WheelRisk[] = ["low", "medium", "high"];
export const DEFAULT_SEGMENTS = 30;
export const DEFAULT_WHEEL_RISK: WheelRisk = "medium";
export const TAG_WHEEL = "wheel";

/** Relative multiplier shape per segment (auto-scaled to RTP below). */
function shape(segments: number, risk: WheelRisk): number[] {
  const a = new Array(segments).fill(0);
  if (risk === "low") {
    for (let i = 0; i < segments; i++) { const m = i % 3; a[i] = m === 0 ? 1.5 : m === 1 ? 1.2 : 0; }
  } else if (risk === "medium") {
    for (let i = 0; i < segments; i++) { const m = i % 5; a[i] = m === 1 ? 1.7 : m === 3 ? 3 : m === 4 ? 5 : 0; }
  } else {
    // high: mostly zeros, a few large hits spread evenly
    const big = Math.max(2, Math.round(segments / 12));
    for (let j = 0; j < big; j++) a[Math.floor((j * segments) / big)] = segments;
  }
  return a;
}

/** The wheel's multiplier per segment, scaled so mean (= RTP) == (1 - edge), 2dp. */
export function wheelTable(segments: number, risk: WheelRisk, edge: number = DEFAULT_EDGE): number[] {
  if (!WHEEL_SEGMENTS.includes(segments as (typeof WHEEL_SEGMENTS)[number])) throw new RangeError(`unsupported segments ${segments}`);
  if (!WHEEL_RISKS.includes(risk)) throw new RangeError(`unknown risk ${risk}`);
  const sh = shape(segments, risk);
  const mean = sh.reduce((a, b) => a + b, 0) / segments;
  const scale = (1 - edge) / mean;
  return sh.map((m) => (m === 0 ? 0 : Math.floor(m * scale * 100) / 100));
}

/** Exact RTP of a wheel table (= mean, segments uniform). */
export function wheelRtp(segments: number, risk: WheelRisk, edge: number = DEFAULT_EDGE): number {
  const t = wheelTable(segments, risk, edge);
  return t.reduce((a, b) => a + b, 0) / segments;
}

export interface WheelOutcome { segment: number; multiplier: number; segments: number; risk: WheelRisk; }

export function wheelOutcome(seeds: RoundSeeds, segments: number, risk: WheelRisk, edge: number = DEFAULT_EDGE): WheelOutcome {
  const table = wheelTable(segments, risk, edge);
  const segment = intFor(seeds, TAG_WHEEL, segments);
  return { segment, multiplier: table[segment]!, segments, risk };
}
