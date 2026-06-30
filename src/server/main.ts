/**
 * main.ts — compose the RGS in DEMO mode and run it.
 *
 * One server hosts the whole crash catalogue: each game in the registry gets its
 * own engine + orchestrator (its own shared-round stream), all on the same code.
 * Players route to a game with `hello.gameId`. The wallet and the block-hash
 * entropy feed are SHARED (one balance per player; one cached tip across games).
 * Swapping in a real aggregator means replacing DemoWallet with that aggregator's
 * adapter and the in-memory stores with Postgres — engine/orchestrator unchanged.
 */

import { webcrypto } from "node:crypto";
import { RoundEngine } from "../core/round-engine.js";
import { DemoWallet } from "../wallet/demo-wallet.js";
import { MemoryAuditLog, MemoryRoundStore, MemoryTxLog } from "../persistence/store.js";
import { demoOperatorConfig } from "../config/operator.js";
import { GAMES, DEFAULT_GAME_ID } from "../config/games.js";
import { Orchestrator } from "./orchestrator.js";
import { startWsServer, type GameHost } from "./ws.js";
import { minor, MixedEntropySource, BlockHashEntropyProvider } from "../engine/index.js";

const PORT = Number(process.env.PORT ?? 8080);
const operator = demoOperatorConfig();

// Shared across all games: one balance per player; one cached external tip hash.
const wallet = new DemoWallet(minor(100_000));
const external = process.env.EXTERNAL_ENTROPY === "0" ? undefined : new BlockHashEntropyProvider();

const games = new Map<string, GameHost>();
const engines: RoundEngine[] = [];
const orchestrators: Orchestrator[] = [];

for (const g of GAMES) {
  const engine = new RoundEngine(
    {
      bettingMs: g.tuning.bettingMs,
      intermissionMs: g.tuning.intermissionMs,
      tickMs: g.tuning.tickMs,
      growth: g.tuning.growth,
      edge: operator.edge,
      moonPoolBase: minor(g.tuning.moonPoolBase),
      genesisClientSeed: `ascent-genesis-${g.id}`,
    },
    {
      now: () => performance.now(),
      randomBytes: (n) => webcrypto.getRandomValues(new Uint8Array(n)),
      chainLength: Number(process.env.CHAIN_LENGTH ?? 50_000),
      entropy: new MixedEntropySource(),
      ...(external ? { externalEntropy: external } : {}),
    },
  );
  const orchestrator = new Orchestrator({
    engine, wallet, operator,
    txLog: new MemoryTxLog(), auditLog: new MemoryAuditLog(), roundStore: new MemoryRoundStore(),
    ensureDemoSession: (sid) => wallet.ensureSession(sid),
  });
  engine.start();
  engines.push(engine);
  orchestrators.push(orchestrator);
  games.set(g.id, { orchestrator, fairness: () => engine.fairness });
}

const server = startWsServer({
  port: PORT,
  games,
  defaultGameId: DEFAULT_GAME_ID,
  gamesList: () => GAMES.map((g) => ({ id: g.id, name: g.name, type: g.type, blurb: g.blurb, ux: g.ux })),
});

const recon = setInterval(() => orchestrators.forEach((o) => void o.runReconciliation()), 2000);

// eslint-disable-next-line no-console
console.log(`Ascent RGS (demo) — ${GAMES.length} games [${GAMES.map((g) => g.id).join(", ")}] on ws://localhost:${PORT}/ws  (health: /health · catalogue: /games · fairness: /fairness?game=ID)`);

function shutdown() { clearInterval(recon); engines.forEach((e) => e.stop()); void server.close().then(() => process.exit(0)); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
