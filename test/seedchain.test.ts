import { describe, it, expect } from "vitest";
import { SeedChain, verifyChainLink } from "../src/engine/seedchain";
import { sha256hex } from "../src/engine/provablyfair";

/** Deterministic byte source for reproducible chains. */
function seededBytes(seed: number): (n: number) => Uint8Array {
  let s = seed >>> 0;
  return (n: number) => {
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; b[i] = s & 0xff; }
    return b;
  };
}

describe("SeedChain (pre-committed, anti-grind)", () => {
  it("each drawn seed hashes to the previous one, and the first hashes to the terminal", () => {
    const chain = new SeedChain(64, seededBytes(1));
    const terminal = chain.terminal;

    let prev = terminal; // round 0 must link to the terminal
    for (let k = 0; k < 64; k++) {
      const { index, serverSeed } = chain.next();
      expect(index).toBe(k);
      // SHA256(thisSeed) === previous reveal (or terminal for k=0)
      expect(sha256hex(serverSeed)).toBe(prev);
      expect(verifyChainLink(serverSeed, prev)).toBe(true);
      prev = serverSeed;
    }
  });

  it("is fully reproducible from the same byte source (auditable / replayable)", () => {
    const a = new SeedChain(32, seededBytes(7));
    const b = new SeedChain(32, seededBytes(7));
    expect(a.terminal).toBe(b.terminal);
    for (let k = 0; k < 32; k++) expect(a.next().serverSeed).toBe(b.next().serverSeed);
  });

  it("rejects a tampered seed and exhausts cleanly", () => {
    const chain = new SeedChain(4, seededBytes(3));
    const first = chain.next().serverSeed;
    expect(verifyChainLink("deadbeef" + first.slice(8), chain.terminal)).toBe(false);
    chain.next(); chain.next(); chain.next(); // consume the rest (4 total)
    expect(() => chain.next()).toThrow(/exhausted/);
  });

  it("terminal = SHA256(seed_0)", () => {
    const chain = new SeedChain(8, seededBytes(9));
    const terminal = chain.terminal;
    const seed0 = chain.next().serverSeed;
    expect(sha256hex(seed0)).toBe(terminal);
  });
});
