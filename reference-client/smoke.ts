/**
 * smoke.ts — reference WebSocket client.
 *
 * Spins up the RGS in-process (demo mode, short timings), connects over the
 * canonical protocol, plays ONE full round driven entirely by the server, and
 * verifies the round was provably fair: SHA-256(revealed serverSeed) === the
 * commitment published before the round, and the crash point is reproducible
 * from the revealed seeds. This is Phase 1's acceptance check.
 */

import { webcrypto } from "node:crypto";
import { WebSocket } from "ws";
import { RoundEngine } from "../src/core/round-engine.js";
import { DemoWallet } from "../src/wallet/demo-wallet.js";
import { MemoryAuditLog, MemoryRoundStore, MemoryTxLog } from "../src/persistence/store.js";
import { demoOperatorConfig } from "../src/config/operator.js";
import { Orchestrator } from "../src/server/orchestrator.js";
import { startWsServer } from "../src/server/ws.js";
import { commit, crashPoint as deriveCrash, sha256hex, minor, DEFAULT_EDGE, MixedEntropySource, BlockHashEntropyProvider } from "../src/engine/index.js";
import type { ServerMessage } from "../src/protocol/messages.js";

const PORT = 8099;
const GENESIS = "smoke-genesis";
const PLAYER_ENTROPY = "smoke-player-entropy-1234"; // fixed so we can recompute the client seed
const EXTERNAL_VALUE = "stub-block-hash-deadbeef";   // stand-in for a real Bitcoin tip hash

const operator = demoOperatorConfig();
const entropy = new MixedEntropySource();
const engine = new RoundEngine(
  { bettingMs: 1200, intermissionMs: 1200, tickMs: 50, growth: 0.45, edge: operator.edge, moonPoolBase: minor(250_000), genesisClientSeed: GENESIS },
  {
    now: () => performance.now(), randomBytes: (n) => webcrypto.getRandomValues(new Uint8Array(n)),
    chainLength: 2000, entropy,
    externalEntropy: new BlockHashEntropyProvider({ fetchTipHash: async () => EXTERNAL_VALUE, source: "stub" }),
  },
);
/** Published BEFORE round 0 — every reveal must chain back to this. */
const chainTerminal = engine.fairness.serverSeedChainTerminal;
const wallet = new DemoWallet(minor(100_000));
const orchestrator = new Orchestrator({
  engine, wallet, operator,
  txLog: new MemoryTxLog(), auditLog: new MemoryAuditLog(), roundStore: new MemoryRoundStore(),
  ensureDemoSession: (sid) => wallet.ensureSession(sid),
});
const server = startWsServer({
  port: PORT,
  games: new Map([["ascent", { orchestrator, fairness: () => engine.fairness }]]),
  defaultGameId: "ascent",
});

function done(code: number) { engine.stop(); try { ws.terminate(); } catch { /* noop */ } void server.close(); setTimeout(() => process.exit(code), 50); }
setTimeout(() => { console.error("✗ timed out"); done(1); }, 20000);

const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
let commitment = "";
let cashed = false;
let betPlaced = false;
let betRoundId = ""; // the round we actually opened+bet on (ignore stale mid-join rounds)
let externalUsed: string | undefined; // external entropy reported for our round

const log = (...a: unknown[]) => console.log(...a);

ws.on("open", () => ws.send(JSON.stringify({ type: "hello", sessionToken: "player-smoke", mode: "demo" })));

ws.on("message", (data) => {
  const m = JSON.parse(String(data)) as ServerMessage;
  switch (m.type) {
    case "welcome":
      log(`→ welcome  session=${m.sessionId}  balance=${m.balance}  edge=${m.edge}`);
      engine.start(); // start fresh now that the client is connected — catch round 0
      break;
    case "round_open":
      if (betPlaced) break; // only play one fresh round
      commitment = m.round.commitment;
      betRoundId = m.round.roundId;
      betPlaced = true;
      log(`→ round_open ${m.round.roundId}  commitment=${m.round.commitment.slice(0, 16)}…`);
      ws.send(JSON.stringify({ type: "place_bet", stake: 1000, clientEntropy: PLAYER_ENTROPY }));
      break;
    case "bet_accepted":
      log(`→ bet_accepted ${m.betId}  stake=${m.stake}  balance=${m.balance}`);
      (globalThis as Record<string, unknown>).__betId = m.betId;
      break;
    case "betting_closed":
      if (m.roundId === betRoundId) { externalUsed = m.externalEntropy; log(`→ betting_closed  external=${m.externalEntropy ?? "—"} (${m.externalSource ?? "none"})`); }
      break;
    case "tick":
      if (!cashed && m.multiplier >= 1.5) {
        cashed = true;
        const betId = (globalThis as Record<string, unknown>).__betId as string;
        ws.send(JSON.stringify({ type: "cash_out", betId }));
      }
      break;
    case "cash_out":
      log(`→ CASHED ${m.betId} @ ${m.multiplier}x  payout=${m.payout}  balance=${m.balance}`);
      break;
    case "cash_out_failed":
      log(`→ cash_out_failed (${m.reason}) — rugged before we cashed`);
      break;
    case "crash": {
      const r = m.round;
      if (r.roundId !== betRoundId) break; // ignore the stale round we joined mid-flight
      const hashOk = commit(r.serverSeed) === commitment;
      const cpOk = deriveCrash({ serverSeed: r.serverSeed, clientSeed: r.clientSeed, nonce: r.nonce }, DEFAULT_EDGE) === r.crashPoint;
      // round 0's seed must hash to the terminal published before any round (anti-grind).
      const chainOk = sha256hex(r.serverSeed) === chainTerminal;
      // the client seed must equal SHA256(genesis | OUR entropy | external | nonce) —
      // proving BOTH the player's contribution AND the external block hash determined
      // this round's outcome (anti-genesis-grind, with or without players).
      const expectedClientSeed = entropy.clientSeedFor({ nonce: r.nonce, prevServerSeed: GENESIS, playerEntropy: [PLAYER_ENTROPY], externalEntropy: externalUsed });
      const entropyOk = r.clientSeed === expectedClientSeed;
      const externalOk = externalUsed === EXTERNAL_VALUE;
      log(`→ CRASH @ ${r.crashPoint}x   reveal=${r.serverSeed.slice(0, 16)}…`);
      log(`\nprovably-fair verification:`);
      log(`  SHA-256(serverSeed) === pre-round commitment             : ${hashOk ? "✓" : "✗"}`);
      log(`  crashPoint reproducible from revealed seeds              : ${cpOk ? "✓" : "✗"}`);
      log(`  reveal chains to pre-published terminal (anti-grind)     : ${chainOk ? "✓" : "✗"}`);
      log(`  player + external entropy determined the client seed     : ${entropyOk ? "✓" : "✗"}`);
      log(`  external block hash mixed in (player-less-round-proof)   : ${externalOk ? "✓" : "✗"}`);
      const ok = hashOk && cpOk && chainOk && entropyOk && externalOk;
      log(ok ? "\n✓ PASS — server-authoritative, chain-committed, player + block-hash bound." : "\n✗ FAIL");
      done(ok ? 0 : 1);
      break;
    }
    case "error":
      log(`→ error ${m.code}: ${m.message}`);
      break;
  }
});

ws.on("error", (e) => { console.error("ws error", e); done(1); });
