/**
 * stepcross-rtp.ts — proves the crossing game's realized RTP matches its
 * configured (1 - edge) across difficulties and cash-out strategies, and prints
 * the multiplier ladder + clear-the-board odds per tier. Run: `npm run rtp:cross`.
 */
import { webcrypto } from "node:crypto";
import { DIFFICULTIES, configFor, stepMultiplier, failLane, settleRun, bytesToHex, DEFAULT_EDGE, type RoundSeeds } from "../src/engine/index.js";

const N = Number(process.env.N ?? 2_000_000);
const rnd = () => bytesToHex(webcrypto.getRandomValues(new Uint8Array(16)));

console.log(`\nAscent — Step-Cross RTP harness   rounds/cell=${N.toLocaleString()}  edge=${DEFAULT_EDGE}  target RTP=${((1 - DEFAULT_EDGE) * 100).toFixed(2)}%\n`);

for (const d of Object.keys(DIFFICULTIES) as (keyof typeof DIFFICULTIES)[]) {
  const cfg = configFor(d);
  const step1 = stepMultiplier(1, cfg);
  const max = stepMultiplier(cfg.lanes, cfg);
  const clearOdds = Math.pow(cfg.survival, cfg.lanes);
  console.log(`${d.toUpperCase().padEnd(9)} lanes=${cfg.lanes}  s=${cfg.survival}  step1=${step1}x  max=${max.toLocaleString()}x  clear≈1 in ${Math.round(1 / clearOdds).toLocaleString()}`);

  for (const target of [1, 2, 5, cfg.lanes]) {
    if (target > cfg.lanes) continue;
    let wagered = 0, returned = 0;
    for (let i = 0; i < N; i++) {
      const seeds: RoundSeeds = { serverSeed: rnd(), clientSeed: "x", nonce: i };
      const fail = failLane(seeds, cfg);
      wagered += 1;
      returned += settleRun(fail, target, cfg);
    }
    console.log(`   cash@lane ${String(target).padStart(2)}:  realized RTP ${((returned / wagered) * 100).toFixed(3)}%`);
  }
  console.log("");
}
