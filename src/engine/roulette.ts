/**
 * roulette.ts — provably-fair European (single-zero) roulette. PURE.
 *
 * 37 pockets (0–36). The winning number is ONE uniform HMAC draw bound to the
 * round's committed seeds. Payouts are the standard European table, so the house
 * edge is structural — the single green zero — at exactly 1/37 ≈ 2.70% (RTP
 * 36/37 ≈ 97.30%) across every bet type; nothing here is sampled or scaled.
 *
 * The server owns a canonical CATALOG of every legal inside + outside bet, keyed
 * by a stable string. Clients place bets by KEY only — the server re-derives the
 * covered numbers and the multiplier from the catalog, so a client can never
 * fabricate coverage (e.g. claim a "split" that spans non-adjacent numbers).
 */

import { intFor, type RoundSeeds } from "./provablyfair";

export const ROULETTE_POCKETS = 37; // European single zero
export const TAG_ROULETTE = "roulette";

/** Physical pocket order on the European wheel (clockwise from 0). */
export const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23,
  10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
] as const;

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const RED_NUMBERS: number[] = [...RED].sort((a, b) => a - b);

export type RColor = "red" | "black" | "green";
export function rouletteColor(n: number): RColor {
  if (n === 0) return "green";
  return RED.has(n) ? "red" : "black";
}

/** True (structural) house edge of single-zero European roulette. */
export const ROULETTE_EDGE = 1 / 37;

export class RouletteError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "RouletteError"; }
}

export interface BetDef { key: string; nums: number[]; mult: number; label: string; }

/** Grid number at row r (0 = top … 2 = bottom) and column c (1…12): 3c − r. */
function numAt(r: number, c: number): number { return 3 * c - r; }
function range(a: number, b: number): number[] { const o: number[] = []; for (let i = a; i <= b; i++) o.push(i); return o; }
function sortNums(a: number[]): number[] { return [...a].sort((x, y) => x - y); }
function nkey(a: number[]): string { return sortNums(a).join("-"); }

let CATALOG: Map<string, BetDef> | null = null;

/** The canonical catalog of every legal European bet, keyed by a stable string. */
export function rouletteCatalog(): Map<string, BetDef> {
  if (CATALOG) return CATALOG;
  const cat = new Map<string, BetDef>();
  const add = (d: BetDef) => cat.set(d.key, d);

  // Straight-up (35:1) — every pocket 0–36.
  for (let n = 0; n <= 36; n++) add({ key: `s:${n}`, nums: [n], mult: 35, label: `Straight ${n}` });

  // Splits (17:1) — adjacent pairs (horizontal + vertical) + the three zero-splits.
  for (let c = 1; c <= 12; c++) for (let r = 0; r <= 2; r++) {
    if (c < 12) { const p = [numAt(r, c), numAt(r, c + 1)]; add({ key: `sp:${nkey(p)}`, nums: sortNums(p), mult: 17, label: `Split ${nkey(p)}` }); }
    if (r < 2) { const p = [numAt(r, c), numAt(r + 1, c)]; add({ key: `sp:${nkey(p)}`, nums: sortNums(p), mult: 17, label: `Split ${nkey(p)}` }); }
  }
  for (const n of [1, 2, 3]) add({ key: `sp:${nkey([0, n])}`, nums: sortNums([0, n]), mult: 17, label: `Split 0/${n}` });

  // Corners (8:1) — 2×2 squares, plus the 0-1-2-3 basket.
  for (let c = 1; c < 12; c++) for (let r = 0; r < 2; r++) {
    const q = [numAt(r, c), numAt(r, c + 1), numAt(r + 1, c), numAt(r + 1, c + 1)];
    add({ key: `co:${nkey(q)}`, nums: sortNums(q), mult: 8, label: `Corner ${nkey(q)}` });
  }
  add({ key: `co:${nkey([0, 1, 2, 3])}`, nums: [0, 1, 2, 3], mult: 8, label: `Basket 0-1-2-3` });

  // Streets (11:1) — a column of three, plus the two zero-trios.
  for (let c = 1; c <= 12; c++) { const st = [numAt(0, c), numAt(1, c), numAt(2, c)]; add({ key: `st:${c}`, nums: sortNums(st), mult: 11, label: `Street ${nkey(st)}` }); }
  add({ key: `st:0a`, nums: [0, 1, 2], mult: 11, label: `Trio 0-1-2` });
  add({ key: `st:0b`, nums: [0, 2, 3], mult: 11, label: `Trio 0-2-3` });

  // Six-lines (5:1) — two adjacent streets.
  for (let c = 1; c < 12; c++) {
    const l = [numAt(0, c), numAt(1, c), numAt(2, c), numAt(0, c + 1), numAt(1, c + 1), numAt(2, c + 1)];
    add({ key: `ln:${c}`, nums: sortNums(l), mult: 5, label: `Six-line ${c}` });
  }

  // Columns (2:1).
  const cols: Record<1 | 2 | 3, number[]> = { 1: [], 2: [], 3: [] };
  for (let k = 1; k <= 36; k++) cols[(((k - 1) % 3) + 1) as 1 | 2 | 3].push(k);
  add({ key: `col:1`, nums: cols[1], mult: 2, label: `Column 1` });
  add({ key: `col:2`, nums: cols[2], mult: 2, label: `Column 2` });
  add({ key: `col:3`, nums: cols[3], mult: 2, label: `Column 3` });

  // Dozens (2:1).
  add({ key: `dz:1`, nums: range(1, 12), mult: 2, label: `1st 12` });
  add({ key: `dz:2`, nums: range(13, 24), mult: 2, label: `2nd 12` });
  add({ key: `dz:3`, nums: range(25, 36), mult: 2, label: `3rd 12` });

  // Even-money (1:1).
  add({ key: `em:red`, nums: RED_NUMBERS, mult: 1, label: `Red` });
  add({ key: `em:black`, nums: range(1, 36).filter((n) => rouletteColor(n) === "black"), mult: 1, label: `Black` });
  add({ key: `em:odd`, nums: range(1, 36).filter((n) => n % 2 === 1), mult: 1, label: `Odd` });
  add({ key: `em:even`, nums: range(1, 36).filter((n) => n % 2 === 0), mult: 1, label: `Even` });
  add({ key: `em:low`, nums: range(1, 18), mult: 1, label: `1-18` });
  add({ key: `em:high`, nums: range(19, 36), mult: 1, label: `19-36` });

  CATALOG = cat;
  return cat;
}

/** The winning number: one uniform HMAC draw in [0, 37). */
export function rouletteNumber(seeds: RoundSeeds): number {
  return intFor(seeds, TAG_ROULETTE, ROULETTE_POCKETS);
}

export interface BetInput { key: string; amount: number; }
export interface BetResult { key: string; amount: number; nums: number[]; mult: number; win: boolean; payout: number; }
export interface ResolveResult { results: BetResult[]; totalStake: number; totalReturn: number; }

/** Validate a bet list against the catalog; throws RouletteError on anything illegal. Returns total stake. */
export function validateBets(bets: BetInput[], cat: Map<string, BetDef> = rouletteCatalog()): number {
  if (!Array.isArray(bets) || bets.length === 0) throw new RouletteError("no_bets", "place at least one bet");
  if (bets.length > 200) throw new RouletteError("too_many_bets", "too many bets");
  let total = 0;
  for (const b of bets) {
    if (!cat.has(b.key)) throw new RouletteError("bad_bet", `unknown bet: ${b.key}`);
    if (!Number.isInteger(b.amount) || b.amount <= 0) throw new RouletteError("bad_amount", `bad amount for ${b.key}`);
    total += b.amount;
  }
  return total;
}

/** Resolve a validated bet list against a drawn number. Amounts are integer minor units. */
export function resolveBets(bets: BetInput[], num: number, cat: Map<string, BetDef> = rouletteCatalog()): ResolveResult {
  const results: BetResult[] = [];
  let totalStake = 0, totalReturn = 0;
  for (const b of bets) {
    const def = cat.get(b.key)!;
    const win = def.nums.includes(num);
    const payout = win ? Math.floor(b.amount * (def.mult + 1)) : 0; // returns stake + winnings
    totalStake += b.amount; totalReturn += payout;
    results.push({ key: b.key, amount: b.amount, nums: def.nums, mult: def.mult, win, payout });
  }
  return { results, totalStake, totalReturn };
}
