/**
 * datasheet.ts — generate the real game-math numbers for the Ascent data sheet.
 *
 * Characterises the crash distribution by sampling the EXACT engine mapping
 * (crashFromFloat) over a 48-bit uniform source — identical in distribution to the
 * provably-fair HMAC float used live. Every figure here is reproducible.
 *
 *   npm run datasheet            # default 20M rounds, edge from config
 */

import { crashFromFloat, DEFAULT_EDGE, MOONPOOL_ODDS, MOONPOOL_CONTRIB } from "../src/engine/index.js";
import { demoOperatorConfig } from "../src/config/operator.js";

const N = Number(process.env.N ?? 20_000_000);
const edge = Number(process.env.EDGE ?? DEFAULT_EDGE);
const TWO48 = 281474976710656; // 2^48 — matches floatFor's 48-bit precision

const targets = [1.01, 1.2, 1.5, 2, 3, 5, 10, 20, 50, 100, 500, 1000, 10000];
const atOrAbove = new Map<number, number>(targets.map((t) => [t, 0]));

let instantRug = 0;
let sum = 0;
let max = 0;
const samples: number[] = [];
const sampleEvery = Math.max(1, Math.floor(N / 200000)); // keep ~200k for percentiles

for (let i = 0; i < N; i++) {
  const r = Math.floor(Math.random() * TWO48) / TWO48;
  const c = crashFromFloat(r, edge);
  if (c === 1) instantRug++;
  sum += c;
  if (c > max) max = c;
  for (const t of targets) if (c >= t) atOrAbove.set(t, atOrAbove.get(t)! + 1);
  if (i % sampleEvery === 0) samples.push(c);
}

samples.sort((a, b) => a - b);
const pct = (p: number) => samples[Math.min(samples.length - 1, Math.floor((p / 100) * samples.length))]!;

const fmt = (x: number) => x.toLocaleString("en-US");
const pctStr = (n: number) => ((n / N) * 100).toFixed(3) + "%";

console.log(`\nAscent — crash-game math data sheet`);
console.log(`rounds sampled: ${fmt(N)}   house edge: ${(edge * 100).toFixed(1)}%   theoretical RTP: ${((1 - edge) * 100).toFixed(2)}%\n`);

console.log(`distribution`);
console.log(`  instant rug (1.00x)   : ${pctStr(instantRug)}`);
console.log(`  mean crash multiplier : ${(sum / N).toFixed(4)}x`);
console.log(`  median crash          : ${pct(50).toFixed(2)}x`);
console.log(`  90th percentile       : ${pct(90).toFixed(2)}x`);
console.log(`  99th percentile       : ${pct(99).toFixed(2)}x`);
console.log(`  max observed          : ${fmt(Math.round(max))}x\n`);

console.log(`hit frequency  P(crash >= target)   |  fair auto-cashout RTP = target x P`);
console.log(`  target      P(>=)        realized-RTP`);
for (const t of targets) {
  const p = atOrAbove.get(t)! / N;
  const realized = t * p; // pay target x stake with prob p, else lose => RTP
  console.log(`  ${(t + "x").padEnd(9)} ${(p * 100).toFixed(3).padStart(8)}%   ${(realized * 100).toFixed(2)}%`);
}

const op = demoOperatorConfig();
const lim = op.limits[op.allowedCurrencies[0]!]!;
console.log(`\noperator-configurable`);
console.log(`  RTP / edge       : edge configurable (default ${(edge * 100).toFixed(0)}% => ${((1 - edge) * 100).toFixed(0)}% RTP); P(crash>=x) ~= RTP/x at every target`);
console.log(`  bet limits       : ${lim.min / 100}–${lim.max / 100} (minor units ${lim.min}–${lim.max})`);
console.log(`  max win / exposure cap : ${op.maxWin > 0 ? fmt(op.maxWin / 100) + " (minor " + fmt(op.maxWin) + ")" : "uncapped (configurable)"}`);
console.log(`  Moon Pool        : ~1 in ${MOONPOOL_ODDS} rounds, funded by ${(MOONPOOL_CONTRIB * 100).toFixed(1)}% disclosed skim, independent provably-fair roll`);
console.log("");
