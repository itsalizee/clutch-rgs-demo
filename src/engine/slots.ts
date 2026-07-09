/**
 * slots.ts — provably-fair 3-reel slot ("Fortune Reels"). PURE. A 3×3 grid is
 * drawn from a weighted symbol strip; the CENTER row is the single payline.
 * Wild substitutes to complete a line. Because the reels are independent and the
 * outcome space is finite (symbols³ on the payline), the exact RTP is computed by
 * enumeration and every paytable value is AUTO-SCALED so RTP == (1 - edge):
 *   RTP = Σ P(line) · payout(line) == (1 - edge)
 * Each cell is one HMAC draw bound to the round's committed seeds (tag per reel/row),
 * so the whole grid is independently verifiable; only the center line decides money.
 */

import { floatFor, type RoundSeeds } from "./provablyfair";
import { DEFAULT_EDGE } from "./crash";

export const TAG_SLOTS = "slots";

// Symbol indices (0-based). WILD substitutes for any symbol on the payline.
export const SLOTS_SYMBOLS = ["🍒", "🍋", "🔔", "⭐", "💎", "7️⃣", "🃏"] as const;
export const CHERRY = 0, LEMON = 1, BELL = 2, STAR = 3, GEM = 4, SEVEN = 5, WILD = 6;
export const SLOTS_LABELS = ["Cherry", "Lemon", "Bell", "Star", "Gem", "Seven", "Wild"] as const;

// Reel strip weights (identical on all three reels). Rarer symbol ⇒ bigger pay.
export const SLOTS_WEIGHTS = [30, 26, 20, 12, 8, 4, 6] as const;
const TOTAL = SLOTS_WEIGHTS.reduce((a, b) => a + b, 0);

// Base (un-scaled) 3-of-a-kind payouts by symbol, and 2-of-a-kind for low symbols.
const BASE_THREE = [5, 8, 15, 30, 60, 120, 200]; // index 6 (WILD) = three wilds jackpot
const BASE_TWO: Record<number, number> = { [CHERRY]: 2, [LEMON]: 2 };

/** Un-scaled multiplier for a center line of three symbol indices. */
function baseLineMultiplier(line: number[]): number {
  const nonWild = line.filter((s) => s !== WILD);
  if (nonWild.length === 0) return BASE_THREE[WILD]; // three wilds
  const sym = nonWild[0]!;
  if (nonWild.every((s) => s === sym)) return BASE_THREE[sym]!; // 3-of-a-kind (wilds fill)
  for (const low of [CHERRY, LEMON]) {
    if (line.filter((s) => s === low || s === WILD).length >= 2) return BASE_TWO[low]!;
  }
  return 0;
}

function symbolProb(i: number): number { return SLOTS_WEIGHTS[i]! / TOTAL; }

/** Raw (un-scaled) RTP by exact enumeration of the payline outcome space. */
function rawRtp(): number {
  const n = SLOTS_SYMBOLS.length;
  let rtp = 0;
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) for (let c = 0; c < n; c++) {
    rtp += symbolProb(a) * symbolProb(b) * symbolProb(c) * baseLineMultiplier([a, b, c]);
  }
  return rtp;
}

/** Floored RTP for a given scale factor (what players actually receive). */
function flooredRtp(scale: number): number {
  const n = SLOTS_SYMBOLS.length;
  let rtp = 0;
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) for (let c = 0; c < n; c++) {
    const m = Math.floor(baseLineMultiplier([a, b, c]) * scale * 100) / 100;
    rtp += symbolProb(a) * symbolProb(b) * symbolProb(c) * m;
  }
  return rtp;
}

// Per-outcome floor-to-2dp on small multipliers loses RTP, so we calibrate the
// scale upward to the largest value whose FLOORED RTP stays ≤ (1 - edge)
// (house-favourable, approached from below). Memoized per edge.
const _scaleCache = new Map<number, number>();
function scaleFor(edge: number): number {
  const hit = _scaleCache.get(edge); if (hit !== undefined) return hit;
  const target = 1 - edge;
  let lo = target / rawRtp(), hi = lo * 1.25;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (flooredRtp(mid) <= target) lo = mid; else hi = mid; }
  _scaleCache.set(edge, lo);
  return lo;
}

/** Scaled paytable (for datasheets/config): { three:[...], two:{...}, scale }. */
export function slotsPaytable(edge: number = DEFAULT_EDGE) {
  const s = scaleFor(edge);
  const round = (x: number) => Math.floor(x * s * 100) / 100;
  return {
    three: BASE_THREE.map(round),
    two: { [CHERRY]: round(BASE_TWO[CHERRY]!), [LEMON]: round(BASE_TWO[LEMON]!) },
  };
}

/** Exact RTP of the scaled table (matches (1 - edge) up to floor rounding). */
export function slotsRtp(edge: number = DEFAULT_EDGE): number {
  const s = scaleFor(edge);
  const n = SLOTS_SYMBOLS.length;
  let rtp = 0;
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) for (let c = 0; c < n; c++) {
    const m = Math.floor(baseLineMultiplier([a, b, c]) * s * 100) / 100;
    rtp += symbolProb(a) * symbolProb(b) * symbolProb(c) * m;
  }
  return rtp;
}

/** Draw one symbol index from the weighted strip using a uniform float in [0,1). */
function drawSymbol(f: number): number {
  let x = f * TOTAL;
  for (let i = 0; i < SLOTS_WEIGHTS.length; i++) { x -= SLOTS_WEIGHTS[i]!; if (x < 0) return i; }
  return SLOTS_WEIGHTS.length - 1;
}

export interface SlotsOutcome {
  grid: number[][];    // 3 reels × 3 rows of symbol indices; grid[reel][row]
  line: number[];      // the center payline (grid[0..2][1])
  multiplier: number;  // scaled, floored to 2dp
  won: boolean;
  tier: string;        // human label of the win, or ""
}

export function slotsOutcome(seeds: RoundSeeds, edge: number = DEFAULT_EDGE): SlotsOutcome {
  const grid: number[][] = [];
  for (let r = 0; r < 3; r++) {
    const reel: number[] = [];
    for (let row = 0; row < 3; row++) reel.push(drawSymbol(floatFor(seeds, `${TAG_SLOTS}:${r}:${row}`)));
    grid.push(reel);
  }
  const line = [grid[0]![1]!, grid[1]![1]!, grid[2]![1]!];
  const base = baseLineMultiplier(line);
  const multiplier = base > 0 ? Math.floor(base * scaleFor(edge) * 100) / 100 : 0;
  let tier = "";
  if (multiplier > 0) {
    const nonWild = line.filter((s) => s !== WILD);
    if (nonWild.length === 0) tier = "3× Wild";
    else if (nonWild.every((s) => s === nonWild[0])) tier = `3× ${SLOTS_LABELS[nonWild[0]!]}`;
    else tier = `2× ${SLOTS_LABELS[line.filter((s) => s === CHERRY || s === WILD).length >= 2 ? CHERRY : LEMON]}`;
  }
  return { grid, line, multiplier, won: multiplier > 0, tier };
}
