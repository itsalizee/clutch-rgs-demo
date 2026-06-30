/**
 * rtp-harness.ts — proves realized RTP matches the configured RTP (brief §8).
 *
 * For a crash game with crash = floor((1-edge)/(1-r) * 100)/100, ANY fixed
 * auto-cash-out target t returns EV = RTP. We simulate N rounds across several
 * targets and report realized RTP; we also report the instant-rug rate, which
 * should approximate `edge`. Run: `npm run rtp -- [rounds] [edge]`.
 */

import { webcrypto } from "node:crypto";
import { crashFromFloat, rtpForEdge } from "../src/engine/index.js";

const rounds = Number(process.argv[2] ?? 2_000_000);
const edge = Number(process.argv[3] ?? 0.03);
const targets = [1.5, 2, 5, 10, 50];

function randFloat(): number {
  // 48-bit uniform in [0,1) from the CSPRNG, matching the engine's float width.
  const b = webcrypto.getRandomValues(new Uint8Array(6));
  let r = 0;
  for (let i = 0; i < 6; i++) r = r * 256 + b[i]!;
  return r / 0x1000000000000;
}

console.log(`\nAscent RGS — RTP harness`);
console.log(`rounds=${rounds.toLocaleString()}  edge=${edge}  target RTP=${(rtpForEdge(edge) * 100).toFixed(2)}%\n`);

const wagered = rounds;
const won: Record<number, number> = Object.fromEntries(targets.map((t) => [t, 0]));
let instantRugs = 0;

for (let i = 0; i < rounds; i++) {
  const crash = crashFromFloat(randFloat(), edge);
  if (crash === 1.0) instantRugs++;
  for (const t of targets) if (crash >= t) won[t]! += t; // 1-unit stake, auto-cash at t
}

console.log("target  realized RTP");
console.log("------  ------------");
for (const t of targets) {
  const rtp = (won[t]! / wagered) * 100;
  console.log(`${t.toString().padStart(5)}x   ${rtp.toFixed(3)}%`);
}
const target = rtpForEdge(edge) * 100;
const overall = (targets.reduce((s, t) => s + won[t]! / wagered, 0) / targets.length) * 100;
console.log(`\navg realized RTP across targets: ${overall.toFixed(3)}%  (target ${target.toFixed(2)}%)`);
console.log(`instant-rug rate: ${((instantRugs / rounds) * 100).toFixed(3)}%  (~edge ${(edge * 100).toFixed(2)}%)\n`);
