/**
 * main.ts — compose the Crossing game in DEMO mode on its own port.
 *
 * Reuses the crash RGS building blocks unchanged: pre-committed seed chain,
 * MixedEntropySource, DemoWallet, in-memory tx log, operator config. Every run
 * carries player entropy (single-player), so commit-reveal alone is
 * genesis-grind-proof — no external feed required here.
 */

import { webcrypto } from "node:crypto";
import { CrossEngine } from "./engine.js";
import { CrossOrchestrator, startCrossWsServer } from "./server.js";
import { DemoWallet } from "../../wallet/demo-wallet.js";
import { MemoryTxLog } from "../../persistence/store.js";
import { demoOperatorConfig } from "../../config/operator.js";
import { minor, MixedEntropySource } from "../../engine/index.js";

const PORT = Number(process.env.CROSS_PORT ?? 8090);
const operator = demoOperatorConfig();

const engine = new CrossEngine({
  randomBytes: (n) => webcrypto.getRandomValues(new Uint8Array(n)),
  chainLength: Number(process.env.CHAIN_LENGTH ?? 50_000),
  entropy: new MixedEntropySource(),
  edge: operator.edge,
});

const wallet = new DemoWallet(minor(100_000));
const orchestrator = new CrossOrchestrator({ engine, wallet, operator, txLog: new MemoryTxLog(), ensureDemoSession: (sid) => wallet.ensureSession(sid) });

const server = startCrossWsServer({ port: PORT, orchestrator, fairness: () => engine.fairness });

// eslint-disable-next-line no-console
console.log(`Ascent Cross (demo) listening on ws://localhost:${PORT}/ws  (health: http://localhost:${PORT}/health, fairness: /fairness)`);

function shutdown() { void server.close().then(() => process.exit(0)); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
