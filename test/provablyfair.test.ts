import { describe, it, expect } from "vitest";
import { sha256hex, hmacSha256hex, commit, verifyCommit, floatFor, crashPoint, crashFromFloat } from "../src/engine/index.js";

describe("provably-fair primitives", () => {
  it("SHA-256 matches known vectors", () => {
    expect(sha256hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("HMAC-SHA256 matches RFC 4231 test case 2", () => {
    // key="Jefe", data="what do ya want for nothing?"
    expect(hmacSha256hex("Jefe", "what do ya want for nothing?")).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });

  it("commit/verify round-trips", () => {
    const seed = "deadbeefcafebabe";
    expect(verifyCommit(seed, commit(seed))).toBe(true);
    expect(verifyCommit("other", commit(seed))).toBe(false);
  });

  it("crash derivation is deterministic and reproducible from seeds", () => {
    const seeds = { serverSeed: "a1b2c3", clientSeed: "client-x", nonce: 7 };
    const a = crashPoint(seeds, 0.03);
    const b = crashFromFloat(floatFor(seeds, "crash"), 0.03);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(1);
  });

  it("a higher edge never increases the crash point for the same float", () => {
    const r = 0.5;
    expect(crashFromFloat(r, 0.01)).toBeGreaterThanOrEqual(crashFromFloat(r, 0.1));
  });
});
