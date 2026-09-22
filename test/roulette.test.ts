import { describe, it, expect } from "vitest";
import {
  rouletteCatalog, rouletteNumber, resolveBets, validateBets, rouletteColor, pocketLabel,
  ROULETTE_POCKETS, WHEEL_ORDER, RED_NUMBERS, DOUBLE_ZERO, RouletteError,
  sha256hex, type RoundSeeds,
} from "../src/engine/index.js";

const seedsFor = (i: number): RoundSeeds => ({ serverSeed: sha256hex("ss:" + i), clientSeed: "cs", nonce: i });

describe("Roulette — American double zero", () => {
  it("wheel has 38 unique pockets (0, 00 and 1..36) with correct colouring", () => {
    expect(WHEEL_ORDER.length).toBe(38);
    expect(new Set(WHEEL_ORDER).size).toBe(38);
    expect(ROULETTE_POCKETS).toBe(38);
    expect(rouletteColor(0)).toBe("green");
    expect(rouletteColor(DOUBLE_ZERO)).toBe("green");
    expect(pocketLabel(DOUBLE_ZERO)).toBe("00");
    expect(RED_NUMBERS.length).toBe(18);
    expect(RED_NUMBERS.every((n) => rouletteColor(n) === "red")).toBe(true);
  });

  it("EVERY catalog bet is fair to 36/38, except the top line (35/38)", () => {
    const cat = rouletteCatalog();
    for (const [key, def] of cat) {
      expect(def.nums.length).toBeGreaterThan(0);
      expect(new Set(def.nums).size).toBe(def.nums.length);
      expect(def.nums.every((n) => (n >= 0 && n <= 36) || n === DOUBLE_ZERO)).toBe(true);
      const ev = (def.nums.length / ROULETTE_POCKETS) * (def.mult + 1);
      const expected = key === "fl:top" ? 35 / 38 : 36 / 38;
      expect(ev).toBeCloseTo(expected, 12);
    }
  });

  it("catalog covers the expected bet families incl. 00 and the top line", () => {
    const cat = rouletteCatalog();
    const count = (p: string) => [...cat.keys()].filter((k) => k.startsWith(p)).length;
    expect(count("s:")).toBe(38);            // 0, 00, 1..36
    expect(cat.get("s:00")!.nums).toEqual([DOUBLE_ZERO]);
    expect(cat.get("sp:0-37")!.mult).toBe(17); // 0/00 split
    expect(cat.get("fl:top")!.nums).toEqual([0, DOUBLE_ZERO, 1, 2, 3]);
    expect(cat.get("fl:top")!.mult).toBe(6);
    expect(count("col:")).toBe(3);
    expect(count("dz:")).toBe(3);
    expect(count("em:")).toBe(6);
  });

  it("resolves winners and losers correctly, including 00", () => {
    const cat = rouletteCatalog();
    const bets = [
      { key: "s:00", amount: 100 }, // win 35:1 -> 3600 when 00 lands
      { key: "s:0", amount: 100 },  // lose
      { key: "em:red", amount: 100 }, // lose (00 is green)
      { key: "fl:top", amount: 100 }, // win 6:1 -> 700 (00 in top line)
    ];
    const { results, totalStake, totalReturn } = resolveBets(bets, DOUBLE_ZERO, cat);
    expect(totalStake).toBe(400);
    expect(totalReturn).toBe(3600 + 0 + 0 + 700);
    expect(results.find((r) => r.key === "s:00")!.win).toBe(true);
    expect(results.find((r) => r.key === "em:red")!.payout).toBe(0);
  });

  it("rejects illegal bets and bad amounts", () => {
    expect(() => validateBets([{ key: "sp:1-5", amount: 10 }])).toThrow(RouletteError);
    expect(() => validateBets([{ key: "s:37", amount: 10 }])).toThrow(RouletteError); // 37 must be keyed s:00
    expect(() => validateBets([{ key: "s:5", amount: 0 }])).toThrow(RouletteError);
    expect(() => validateBets([])).toThrow(RouletteError);
    expect(validateBets([{ key: "s:00", amount: 10 }, { key: "em:red", amount: 20 }])).toBe(30);
  });

  it("winning pocket is uniform over 38 and reproducible", () => {
    const counts = new Array(38).fill(0);
    const N = 38000;
    for (let i = 0; i < N; i++) counts[rouletteNumber(seedsFor(i))]++;
    for (const c of counts) { expect(c).toBeGreaterThan(800); expect(c).toBeLessThan(1200); }
    expect(rouletteNumber(seedsFor(42))).toBe(rouletteNumber(seedsFor(42)));
  });
});
