/**
 * cross-smoke.ts — reference client for the Crossing game.
 *
 * Spins up the Crossing RGS in-process, plays a full run over the canonical
 * protocol, and verifies it was provably fair and server-authoritative:
 *   - the client never received the hazard lane until the run ended,
 *   - SHA-256(revealed serverSeed) === the pre-run commitment,
 *   - the hazard lane is reproducible from the revealed seeds,
 *   - the reveal chains back to the pre-published terminal (anti-grind),
 *   - the player's entropy determined the client seed (anti-genesis-grind).
 */

import { webcrypto } from "node:crypto";
import { WebSocket } from "ws";
import { CrossEngine } from "../src/games/crossing/engine.js";
import { CrossOrchestrator, startCrossWsServer } from "../src/games/crossing/server.js";
import { DemoWallet } from "../src/wallet/demo-wallet.js";
import { MemoryTxLog } from "../src/persistence/store.js";
import { demoOperatorConfig } from "../src/config/operator.js";
import { minor, MixedEntropySource, commit, sha256hex, configFor, failLane as deriveFailLane } from "../src/engine/index.js";
import type { CrossServerMessage } from "../src/games/crossing/protocol.js";

const PORT = 8098;
const GENESIS = "cross-smoke-genesis";
const PLAYER_ENTROPY = "cross-player-entropy-99";
const CASH_AT = 3; // cash out once we've safely crossed this many lanes

const operator = demoOperatorConfig();
const entropy = new MixedEntropySource();
const engine = new CrossEngine({ randomBytes: (n) => webcrypto.getRandomValues(new Uint8Array(n)), chainLength: 2000, entropy, edge: operator.edge, genesis: GENESIS });
const chainTerminal = engine.fairness.serverSeedChainTerminal;
const wallet = new DemoWallet(minor(100_000));
const orchestrator = new CrossOrchestrator({ engine, wallet, operator, txLog: new MemoryTxLog(), ensureDemoSession: (sid) => wallet.ensureSession(sid) });
const server = startCrossWsServer({ port: PORT, orchestrator });

function done(code: number) { try { ws.terminate(); } catch { /* */ } void server.close(); setTimeout(() => process.exit(code), 50); }
setTimeout(() => { console.error("✗ timed out"); done(1); }, 15000);

const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
const log = (...a: unknown[]) => console.log(...a);
let commitment = "", runId = "", difficulty = "easy";

ws.on("open", () => ws.send(JSON.stringify({ type: "hello", sessionToken: "cross-smoke", mode: "demo" })));

ws.on("message", (data) => {
  const m = JSON.parse(String(data)) as CrossServerMessage;
  switch (m.type) {
    case "welcome":
      log(`→ welcome  balance=${m.balance}  edge=${m.edge}`);
      ws.send(JSON.stringify({ type: "open_run", stake: 1000, difficulty: "easy", clientEntropy: PLAYER_ENTROPY }));
      break;
    case "run_open":
      commitment = m.run.commitment; runId = m.run.runId; difficulty = m.run.difficulty;
      // server-authority: run_open must NOT contain a server seed or hazard lane
      if ("serverSeed" in (m.run as object) || "failLane" in (m.run as object)) { log("✗ FAIL — server leaked the hazard"); return done(1); }
      log(`→ run_open ${runId}  difficulty=${difficulty}  commitment=${commitment.slice(0, 16)}…  lanes=${m.run.lanes}`);
      ws.send(JSON.stringify({ type: "hop", runId }));
      break;
    case "hop":
      log(`   hop → lane ${m.lane}  @ ${m.multiplier}x`);
      if (m.lane >= CASH_AT) ws.send(JSON.stringify({ type: "cash_out", runId }));
      else ws.send(JSON.stringify({ type: "hop", runId }));
      break;
    case "run_over": {
      const r = m.reveal;
      const cfg = configFor(difficulty as "easy");
      const hashOk = commit(r.serverSeed) === commitment;
      const failOk = deriveFailLane({ serverSeed: r.serverSeed, clientSeed: r.clientSeed, nonce: r.nonce }, cfg) === r.failLane;
      const chainOk = sha256hex(r.serverSeed) === chainTerminal;
      const expClient = entropy.clientSeedFor({ nonce: r.nonce, prevServerSeed: GENESIS, playerEntropy: [PLAYER_ENTROPY] });
      const entropyOk = r.clientSeed === expClient;
      log(`→ run_over: ${m.status.toUpperCase()} @ lane ${m.lane} (${m.multiplier}x)  payout=${m.payout}  hazard=lane ${r.failLane}`);
      log(`\nprovably-fair verification:`);
      log(`  SHA-256(serverSeed) === run commitment                  : ${hashOk ? "✓" : "✗"}`);
      log(`  hazard lane reproducible from revealed seeds            : ${failOk ? "✓" : "✗"}`);
      log(`  reveal chains to pre-published terminal (anti-grind)    : ${chainOk ? "✓" : "✗"}`);
      log(`  player entropy determined the client seed (anti-genesis): ${entropyOk ? "✓" : "✗"}`);
      const ok = hashOk && failOk && chainOk && entropyOk;
      log(ok ? "\n✓ PASS — crossing run server-authoritative, chain-committed, player-entropy-bound." : "\n✗ FAIL");
      done(ok ? 0 : 1);
      break;
    }
    case "error": log(`→ error ${m.code}: ${m.message}`); done(1); break;
  }
});

ws.on("error", (e) => { console.error("ws error", e); done(1); });
