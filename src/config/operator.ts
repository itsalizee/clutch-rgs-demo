/**
 * operator.ts — per-operator configuration (brief §7).
 *
 * Operators buy margin and control. These are config, NOT hardcoded. The
 * provably-fair math honours the configured edge exactly and stays verifiable.
 */

import { assertValidEdge } from "../engine/index.js";
import type { Minor } from "../engine/index.js";

export interface BetLimits {
  min: Minor;
  max: Minor;
}

export interface OperatorConfig {
  operatorId: string;
  /** House edge => RTP. e.g. 0.03 (97%). Surfaced in marketing as configured RTP. */
  edge: number;
  /** Per-currency min/max stake. */
  limits: Record<string, BetLimits>;
  /** Max payout per bet, minor units (cap exposure). 0 = uncapped. */
  maxWin: Minor;
  allowedCurrencies: string[];
  allowedJurisdictions: string[];
  features: {
    autoCashOut: boolean;
    oneTapRebet: boolean;
    livePlayerFeed: boolean;
    chat: boolean;
  };
}

export function assertOperatorConfig(c: OperatorConfig): void {
  assertValidEdge(c.edge);
  if (c.allowedCurrencies.length === 0) throw new Error("operator must allow >=1 currency");
}

/** A sensible default used by demo mode and tests. */
export function demoOperatorConfig(): OperatorConfig {
  return {
    operatorId: "demo",
    edge: 0.03,
    limits: { CREDITS: { min: 1 as Minor, max: 100_000 as Minor } },
    maxWin: 0 as Minor,
    allowedCurrencies: ["CREDITS"],
    allowedJurisdictions: ["DEMO"],
    features: { autoCashOut: true, oneTapRebet: true, livePlayerFeed: true, chat: false },
  };
}
