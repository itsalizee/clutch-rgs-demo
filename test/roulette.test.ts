import { describe, it, expect } from "vitest";
import {
  rouletteCatalog, rouletteNumber, resolveBets, validateBets, rouletteColor,
  ROULETTE_POCKETS, WHEEL_ORDER, RED_NUMBERS, RouletteError,
  sha256hex, type RoundSeeds,
} from "../src/engine/index.js";

const seedsFor = (i: number): RoundSeeds => ({ serverSeed: sha256hex("ss:" + i), clientSeed: "cs", nonce: i });

describe("Roulette — European single zero", () => {
  it("wheel has 37 unique pockets 0..36 and correct colouring", () => {
    expect(WHEEL_ORDER.length).toBe(37);
    expect(new Set(WHEEL_ORDER).size).toBe(37);
    expect([...WHEEL_ORDER].sort((a, b) => a - b)).toEqual(Array.from({ length: 37 }, (_, i) => i));
    expect(rouletteColor(0)).toBe("green");
    expect(RED_NUMBERS.length).toBe(18);
    expect(RED_NUMBERS.every((n) => rouletteColor(n) === "red")).toBe(true);
  });

  it("EVERY catalog bet has EV == 36/37 (coverage × payout are self-consistent)", () => {
    const cat = rouletteCatalog();
    for (const [key, def] of cat) {
      // nums must be unique, in range, non-empty
      expect(def.nums.length).toBeGreaterThan(0);
      expect(new Set(def.nums).size).toBe(def.nums.length);
      expect(def.nums.every((n) => n >= 0 && n <= 36)).toBe(true);
      // EV = coverage/37 * (mult+1) must equal the structural 36/37 for a fair European table
      const ev = (def.nums.length / ROULETTE_POCKETS) * (def.mult + 1);
      expect(ev).toBeCloseTo(36 / 37, 12);
      expect(key).toBe(def.key);
    }
  });

  it("catalog covers the expected bet families", () => {
    const cat = rouletteCatalog();
    const count = (p: string) => [...cat.keys()].filter((k) => k.startsWith(p)).length;
    expect(count("s:")).toBe(37);            // straight 0..36
    expect(count("col:")).toBe(3);
    expect(count("dz:")).toBe(3);
    expect(count("em:")).toBe(6);
    expect(count("ln:")).toBe(11);           // six-lines
    expect(cat.get("s:0")!.mult).toBe(35);
    expect(cat.get("em:red")!.mult).toBe(1);
    expect(cat.get("co:0-1-2-3")!.mult).toBe(8);
  });

  it("resolves winners and losers correctly, in integer minor units", () => {
    const cat = rouletteCatalog();
    // number 17 is BLACK, odd, 1-18, column 2 (17 = (17-1)%3+1 = 2), street {16,17,18}
    const bets = [
      { key: "s:17", amount: 100 },     // win 35:1 -> 3600
      { key: "s:0", amount: 100 },      // lose
      { key: "em:black", amount: 100 }, // win 1:1 -> 200
      { key: "col:2", amount: 100 },    // win 2:1 -> 300
      { key: "st:6", amount: 100 },     // street col 6 = {16,17,18} win 11:1 -> 1200
    ];
    const { results, totalStake, totalReturn } = resolveBets(bets, 17, cat);
    expect(totalStake).toBe(500);
    expect(totalReturn).toBe(3600 + 0 + 200 + 300 + 1200);
    expect(results.find((r) => r.key === "s:17")!.win).toBe(true);
    expect(results.find((r) => r.key === "s:0")!.payout).toBe(0);
    expect(Number.isInteger(totalReturn)).toBe(true);
  });

  it("rejects illegal bets and bad amounts", () => {
    expect(() => validateBets([{ key: "sp:1-5", amount: 10 }])).toThrow(RouletteError); // 1 and 5 not adjacent
    expect(() => validateBets([{ key: "s:37", amount: 10 }])).toThrow(RouletteError);
    expect(() => validateBets([{ key: "s:5", amount: 0 }])).toThrow(RouletteError);
    expect(() => validateBets([{ key: "s:5", amount: 1.5 }])).toThrow(RouletteError);
    expect(() => validateBets([])).toThrow(RouletteError);
    expect(validateBets([{ key: "s:5", amount: 10 }, { key: "em:red", amount: 20 }])).toBe(30);
  });

  it("winning number is uniform over 37 pockets and reproducible", () => {
    const counts = new Array(37).fill(0);
    const N = 37000;
    for (let i = 0; i < N; i++) counts[rouletteNumber(seedsFor(i))]++;
    // every pocket hit, roughly uniform (~1000 each, generous band)
    for (const c of counts) { expect(c).toBeGreaterThan(800); expect(c).toBeLessThan(1200); }
    expect(rouletteNumber(seedsFor(42))).toBe(rouletteNumber(seedsFor(42))); // deterministic
  });
});
