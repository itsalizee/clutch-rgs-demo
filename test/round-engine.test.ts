import { describe, it, expect, beforeEach } from "vitest";
import { RoundEngine, type RoundResult, type CashOut, type RoundOpen } from "../src/core/round-engine.js";
import { commit, crashPoint as deriveCrash, sha256hex, minor, DEFAULT_EDGE, SeedChain } from "../src/engine/index.js";

/** Deterministic virtual clock + scheduler so the engine is fully reproducible. */
class FakeClock {
  t = 0;
  private q: { due: number; fn: () => void; id: number; live: boolean }[] = [];
  private seq = 0;
  now = () => this.t;
  schedule = (fn: () => void, ms: number) => {
    const item = { due: this.t + ms, fn, id: this.seq++, live: true };
    this.q.push(item);
    return () => { item.live = false; };
  };
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      const next = this.q.filter((x) => x.live && x.due <= end).sort((a, b) => a.due - b.due || a.id - b.id)[0];
      if (!next) break;
      next.live = false;
      this.t = next.due;
      next.fn();
    }
    this.t = end;
  }
}

const GENESIS = "ascent-genesis-client-seed";

/** Find a server seed (hex) whose round-0 crash point lands in [lo, hi). */
function seedForCrash(lo: number, hi: number, edge = DEFAULT_EDGE): string {
  const clientSeed = commit(GENESIS);
  for (let i = 0; i < 100000; i++) {
    const serverSeed = sha256hex(String(i)).slice(0, 32); // 16 bytes
    const cp = deriveCrash({ serverSeed, clientSeed, nonce: 0 }, edge);
    if (cp >= lo && cp < hi) return serverSeed;
  }
  throw new Error("no seed found");
}

describe("RoundEngine — server-authoritative shared rounds", () => {
  let clock: FakeClock;
  let engine: RoundEngine;
  let serverSeedHex: string;
  let opens: RoundOpen[];
  let crashes: RoundResult[];
  let cashouts: CashOut[];

  beforeEach(() => {
    clock = new FakeClock();
    serverSeedHex = seedForCrash(4, 50); // comfortably high so we can cash out at 2x
    // Inject a chain whose ROUND 0 seed is the controlled high-crash seed, with
    // filler seeds after it so later rounds don't exhaust the chain.
    const filler = Array.from({ length: 64 }, (_, i) => sha256hex("filler:" + i));
    const seedChain = SeedChain.fromSeeds([serverSeedHex, ...filler]);
    engine = new RoundEngine(
      { bettingMs: 100, intermissionMs: 100, tickMs: 20, growth: 0.17, edge: DEFAULT_EDGE, moonPoolBase: minor(250000), genesisClientSeed: GENESIS },
      { now: clock.now, randomBytes: () => new Uint8Array(16), schedule: clock.schedule, seedChain },
    );
    opens = []; crashes = []; cashouts = [];
    engine.events.on("round_open", (r) => opens.push(r));
    engine.events.on("crash", (r) => crashes.push(r));
    engine.events.on("cashout", (c) => cashouts.push(c));
  });

  it("commits before the round and reveals a verifiable seed after the crash", () => {
    engine.start();
    expect(opens.length).toBe(1);
    const open = opens[0]!;
    expect(open.commitment).toBe(commit(serverSeedHex)); // committed BEFORE outcome

    engine.placeBet({ betId: "b1", playerId: "p1", sessionId: "s1", stake: minor(100) });
    clock.advance(100); // close betting -> inflight
    clock.advance(60000); // ride to the crash

    expect(crashes.length).toBeGreaterThanOrEqual(1);
    const res = crashes[0]!;
    // The revealed seed hashes to the pre-round commitment, and the crash point
    // is reproducible from the revealed seeds + edge.
    expect(commit(res.reveal.serverSeed)).toBe(open.commitment);
    expect(res.reveal.serverSeed).toBe(serverSeedHex);
    expect(res.crashPoint).toBe(deriveCrash(res.reveal, DEFAULT_EDGE));
    // An un-cashed bet rode to the crash and lost.
    expect(res.lostBetIds).toContain("b1");
  });

  it("cash-out uses the server clock, locks a multiplier, and is idempotent", () => {
    engine.start();
    const cp = deriveCrash({ serverSeed: serverSeedHex, clientSeed: commit(GENESIS), nonce: 0 }, DEFAULT_EDGE);
    engine.placeBet({ betId: "b1", playerId: "p1", sessionId: "s1", stake: minor(100) });
    clock.advance(100); // -> inflight, inflightStart = 100
    // advance to ~2x: seconds = ln(2)/0.17
    clock.advance((Math.log(2) / 0.17) * 1000);

    const r1 = engine.cashOut("b1");
    expect("multiplier" in r1).toBe(true);
    const m = (r1 as { multiplier: number }).multiplier;
    expect(m).toBeGreaterThan(1.8);
    expect(m).toBeLessThanOrEqual(cp);
    expect(cashouts.length).toBe(1);

    // idempotent: a second cash-out returns the same locked multiplier, no new event
    const r2 = engine.cashOut("b1");
    expect(r2).toEqual({ multiplier: m });
    expect(cashouts.length).toBe(1);
  });

  it("a cash-out after the crash loses the race", () => {
    engine.start();
    engine.placeBet({ betId: "b1", playerId: "p1", sessionId: "s1", stake: minor(100) });
    clock.advance(100); // -> inflight
    // step until THIS round crashes, but stop before the next round opens
    let guard = 0;
    while (crashes.length === 0 && guard++ < 2000) clock.advance(50);
    expect(crashes.length).toBe(1);
    const r = engine.cashOut("b1"); // same (now-settled) round still current during intermission
    expect(r).toEqual({ lost: true });
  });

  it("rejects bets once betting has closed", () => {
    engine.start();
    clock.advance(100); // betting closed
    expect(() => engine.placeBet({ betId: "late", playerId: "p1", sessionId: "s1", stake: minor(10) })).toThrow();
  });

  it("consumes the PRE-COMMITTED seed chain: consecutive reveals link back to the terminal (anti-grind)", () => {
    // a genuine random chain (deterministic bytes for reproducibility)
    let s = 12345 >>> 0;
    const rb = (n: number) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; b[i] = s & 0xff; } return b; };
    const chain = new SeedChain(40, rb);
    const terminal = chain.terminal; // published before round 0
    const e = new RoundEngine(
      { bettingMs: 50, intermissionMs: 50, tickMs: 20, growth: 0.17, edge: DEFAULT_EDGE, moonPoolBase: minor(250000) },
      { now: clock.now, randomBytes: () => new Uint8Array(16), schedule: clock.schedule, seedChain: chain },
    );
    const reveals: string[] = [];
    e.events.on("crash", (r) => reveals.push(r.reveal.serverSeed));
    e.start();
    let guard = 0;
    while (reveals.length < 5 && guard++ < 5000) clock.advance(50);
    e.stop();

    expect(reveals.length).toBeGreaterThanOrEqual(5);
    // round 0's seed hashes to the pre-published terminal; each later seed hashes to the prior reveal
    expect(sha256hex(reveals[0]!)).toBe(terminal);
    for (let k = 1; k < reveals.length; k++) expect(sha256hex(reveals[k]!)).toBe(reveals[k - 1]!);
  });
});
