/**
 * hosted.ts — single-process, single-PORT deployment for a public demo.
 *
 * One HTTP server does three jobs so the whole thing fits on one port (what
 * Render/Railway/Fly give you):
 *   1. serves the static game clients + landing page from ./public
 *   2. answers /health, /games, /fairness, /fairness/cross
 *   3. routes WebSocket upgrades by path:
 *        /ws        -> crash catalogue (place_bet/cash_out)   [Ascent]
 *        /ws/cross  -> crossing (open_run/hop/cash_out)       [Ascent Cross]
 *
 * Game logic is untouched: we compose the same engines/orchestrators the two
 * standalone mains use, then attach their connection handlers to noServer
 * WebSocketServers that share this one http.Server.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import { WebSocketServer } from "ws";

import { RoundEngine } from "../core/round-engine.js";
import { DemoWallet } from "../wallet/demo-wallet.js";
import { MemoryAuditLog, MemoryRoundStore, MemoryTxLog } from "../persistence/store.js";
import { demoOperatorConfig } from "../config/operator.js";
import { GAMES, DEFAULT_GAME_ID } from "../config/games.js";
import { Orchestrator } from "./orchestrator.js";
import { attachCrashWs, crashHttpRoutes, type GameHost } from "./ws.js";
import { CrossEngine } from "../games/crossing/engine.js";
import { CrossOrchestrator, attachCrossWs, crossHttpRoutes } from "../games/crossing/server.js";
import { VaultEngine } from "../games/vault/engine.js";
import { VaultOrchestrator, attachVaultWs, vaultHttpRoutes } from "../games/vault/server.js";
import { minor, MixedEntropySource, BlockHashEntropyProvider } from "../engine/index.js";

const PORT = Number(process.env.PORT ?? 8080);
const PUBLIC_DIR = fileURLToPath(new URL("../../public", import.meta.url));
const operator = demoOperatorConfig();

// ---- Crash catalogue (mirrors src/server/main.ts) --------------------------
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

// ---- Crossing game (mirrors src/games/crossing/main.ts) --------------------
const crossEngine = new CrossEngine({
  randomBytes: (n) => webcrypto.getRandomValues(new Uint8Array(n)),
  chainLength: Number(process.env.CHAIN_LENGTH ?? 50_000),
  entropy: new MixedEntropySource(),
  edge: operator.edge,
});
// Crossing reuses the SAME wallet so a player's balance is shared across games.
const crossOrchestrator = new CrossOrchestrator({
  engine: crossEngine, wallet, operator, txLog: new MemoryTxLog(),
  ensureDemoSession: (sid) => wallet.ensureSession(sid),
});

// ---- Vault (mines) game (a genuinely new mechanic) ------------------------
const vaultEngine = new VaultEngine({
  randomBytes: (n) => webcrypto.getRandomValues(new Uint8Array(n)),
  chainLength: Number(process.env.CHAIN_LENGTH ?? 50_000),
  entropy: new MixedEntropySource(),
  edge: operator.edge,
});
const vaultOrchestrator = new VaultOrchestrator({
  engine: vaultEngine, wallet, operator, txLog: new MemoryTxLog(),
  ensureDemoSession: (sid) => wallet.ensureSession(sid),
});

// ---- Static file serving ---------------------------------------------------
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".webp": "image/webp", ".woff": "font/woff", ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json",
};

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]!);
  let rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  if (rel === "" ) rel = "index.html";
  let filePath = join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  try {
    let s = await stat(filePath);
    if (s.isDirectory()) { filePath = join(filePath, "index.html"); s = await stat(filePath); }
    const body = await readFile(filePath);
    res.writeHead(200, { "content-type": MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-cache" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }); res.end("not found");
  }
}

// ---- HTTP server (routes + static) -----------------------------------------
const crashRoutes = crashHttpRoutes(games, DEFAULT_GAME_ID, () =>
  GAMES.map((g) => ({ id: g.id, name: g.name, type: g.type, blurb: g.blurb, ux: g.ux })));
const crossRoutes = crossHttpRoutes(() => crossEngine.fairness);
const vaultRoutes = vaultHttpRoutes(() => vaultEngine.fairness);

const http = createServer((req, res) => {
  if (vaultRoutes(req, res)) return;     // /fairness/vault
  if (crossRoutes(req, res)) return;     // /fairness/cross
  if (crashRoutes(req, res)) return;     // /health, /games, /fairness
  void serveStatic(req, res);
});

// ---- WebSocket routing by path ---------------------------------------------
const crashWss = new WebSocketServer({ noServer: true });
const crossWss = new WebSocketServer({ noServer: true });
const vaultWss = new WebSocketServer({ noServer: true });
attachCrashWs(crashWss, games, DEFAULT_GAME_ID);
attachCrossWs(crossWss, crossOrchestrator);
attachVaultWs(vaultWss, vaultOrchestrator);

http.on("upgrade", (req, socket, head) => {
  const path = (req.url ?? "").split("?")[0]!;
  if (path === "/ws/cross") {
    crossWss.handleUpgrade(req, socket, head, (ws) => crossWss.emit("connection", ws, req));
  } else if (path === "/ws/vault") {
    vaultWss.handleUpgrade(req, socket, head, (ws) => vaultWss.emit("connection", ws, req));
  } else if (path === "/ws" || path === "/ws/ascent") {
    crashWss.handleUpgrade(req, socket, head, (ws) => crashWss.emit("connection", ws, req));
  } else {
    socket.destroy();
  }
});

const recon = setInterval(() => orchestrators.forEach((o) => void o.runReconciliation()), 2000);

http.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Ascent demo (hosted) on :${PORT}  — landing / · crash ws /ws (${GAMES.map((g) => g.id).join(",")}) · crossing ws /ws/cross · health /health · fairness /fairness, /fairness/cross`);
});

function shutdown() { clearInterval(recon); engines.forEach((e) => e.stop()); http.close(() => process.exit(0)); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
