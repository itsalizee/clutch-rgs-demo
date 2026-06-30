/**
 * rgs-types.ts — the canonical RGS contract.
 *
 * This is the SAME shape the Ascent client already speaks (`rgs.ts` in the game
 * repo). The server returns exactly these objects so the client's WS adapter is
 * a clean swap for the offline mock. Money crosses this boundary in display
 * units (credits, decimal) — internally the server keeps integer minor units and
 * converts only at this edge.
 *
 * Server-authority rules encoded by this shape (unchanged from the client seam):
 *  - crashPoint + serverSeed are absent while a round runs; present only once
 *    the round is terminal (settled).
 *  - cashOut() takes no multiplier — the server reads its own clock.
 *  - the displayed multiplier is whatever tick() returns.
 */

export interface Wallet {
  balance: number; // display units (credits)
  currency: string;
}

export interface OpenRoundRequest {
  betAmount: number; // display units (credits)
  autoCashOut?: number;
}

export interface RoundOpen {
  roundId: string;
  commitment: string; // SHA-256(serverSeed), committed BEFORE the round
  clientSeed: string;
  nonce: number;
  betAmount: number;
  autoCashOut?: number;
  wallet: Wallet;
  moonPool: number;
}

export type RoundStatus = "running" | "cashed" | "rugged";

export interface SeedReveal {
  serverSeed: string;
  clientSeed: string;
  nonce: number;
}

export interface RoundState {
  roundId: string;
  status: RoundStatus;
  multiplier: number;
  settled: boolean;
  crashPoint?: number;
  cashOutMultiplier?: number;
  payout?: number;
  jackpotTriggered?: boolean;
  jackpotAward?: number;
  reveal?: SeedReveal;
  wallet: Wallet;
  moonPool: number;
}

/** The methods the client invokes (here, as WS RPC). */
export interface Rgs {
  getWallet(): Promise<Wallet>;
  getMoonPool(): Promise<number>;
  setClientSeed(seed: string): Promise<void>;
  getClientSeed(): Promise<string>;
  openRound(req: OpenRoundRequest): Promise<RoundOpen>;
  tick(roundId: string): Promise<RoundState>;
  cashOut(roundId: string): Promise<RoundState>;
}
