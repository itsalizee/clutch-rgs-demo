import { describe, it, expect } from "vitest";
import {
  DIFFICULTIES, configFor, stepMultiplier, ladder, failLane, settleRun,
  sha256hex, DEFAULT_EDGE, type RoundSeeds,
} from "../src/engine/index.js";

const seedsFor = (i: number): RoundSeeds => ({ serverSeed: sha256hex("ss:" + i), clientSeed: "cs", nonce: i });

describe("stepcross — discrete step-multiplier crossing math", () => {
  it("ladder is strictly increasing and starts near the tier's step-1", () => {
    const easy = ladder(configFor("easy"));
    for (let i = 1; i < easy.length; i++) expect(easy[i]!).toBeGreaterThan(easy[i - 1]!);
    expect(stepMultiplier(1, configFor("easy"))).toBeGreaterThan(1);      // a real win on lane 1
    expect(stepMultiplier(1, configFor("hardcore"))).toBeGreaterThan(1.8); // coin-flip tier
  });

  it("lane survival frequency matches the configured probability (provably fair)", () => {
    const cfg = configFor("medium"); // s = 0.78
    let survivedLane1 = 0;
    const N = 60000;
    for (let i = 0; i < N; i++) if (failLane(seedsFor(i), cfg) > 1) survivedLane1++;
    expect(survivedLane1 / N).toBeGreaterThan(cfg.survival - 0.01);
    expect(survivedLane1 / N).toBeLessThan(cfg.survival + 0.01);
  });

  it("EV at every lane equals the configured (1 - edge) up to 2dp truncation (analytic, exact)", () => {
    // RTP is provable ANALYTICALLY: cashing out at lane k pays multiplier(k) with
    // probability s^k, so EV = s^k · multiplier(k). With multiplier = (1-edge)/s^k
    // pre-truncation, EV = (1-edge) exactly; the 2dp floor removes at most 0.01·s^k.
    // This is exact and variance-free — the full Monte-Carlo sweep is the harness.
    for (const d of Object.keys(DIFFICULTIES) as (keyof typeof DIFFICULTIES)[]) {
      const cfg = configFor(d);
      for (let k = 1; k <= cfg.lanes; k++) {
        const ev = Math.pow(cfg.survival, k) * stepMultiplier(k, cfg);
        expect(ev).toBeLessThanOrEqual(1 - DEFAULT_EDGE + 1e-9);
        expect(ev).toBeGreaterThanOrEqual(1 - DEFAULT_EDGE - 0.01 * Math.pow(cfg.survival, k) - 1e-9);
      }
    }
  });

  it("settleRun: cashing before the hazard wins; walking into it loses", () => {
    const cfg = configFor("easy");
    // fail lane = 5 → cashing at 4 wins stepMultiplier(4); advancing to 5 loses.
    expect(settleRun(5, 4, cfg)).toBe(stepMultiplier(4, cfg));
    expect(settleRun(5, 5, cfg)).toBe(0);
    expect(settleRun(5, 0, cfg)).toBe(0); // never advanced
  });
});
