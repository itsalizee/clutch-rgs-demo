/**
 * ws.ts — WebSocket transport. Thin: it wires a socket to an Orchestrator
 * session and shuttles canonical protocol messages. No game logic lives here.
 */

import { createServer, type IncomingMessage, type Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { Orchestrator } from "./orchestrator.js";
import type { ClientMessage, ServerMessage } from "../protocol/messages.js";
import { minor } from "../engine/index.js";

export interface GameHost {
  orchestrator: Orchestrator;
  /** Public provably-fair disclosure for this game (served at /fairness?game=ID). */
  fairness?: () => unknown;
}

export interface WsServerOptions {
  port: number;
  /** One host per gameId (each its own engine + orchestrator). */
  games: Map<string, GameHost>;
  defaultGameId: string;
  /** Catalogue listing for GET /games. */
  gamesList?: () => unknown;
}

/**
 * Attach the crash-game (place_bet/cash_out) protocol handler to an existing
 * WebSocketServer — lets the single hosted server share one HTTP server across
 * games by routing upgrades by path (see server/hosted.ts).
 */
export function attachCrashWs(wss: WebSocketServer, games: Map<string, GameHost>, defaultGameId: string): void {
  wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
    let sessionId: string | null = null;
    let host: GameHost | null = null;
    const send = (m: ServerMessage) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); };

    ws.on("message", async (data) => {
      let msg: ClientMessage;
      try { msg = JSON.parse(String(data)); } catch { return send({ type: "error", code: "bad_json", message: "invalid json" }); }
      try {
        switch (msg.type) {
          case "hello": {
            const gameId = msg.gameId ?? defaultGameId;
            host = games.get(gameId) ?? null;
            if (!host) return send({ type: "error", code: "unknown_game", message: `no game '${gameId}'` });
            const s = await host.orchestrator.openSession(msg.sessionToken, send);
            sessionId = s.sessionId;
            break;
          }
          case "place_bet": {
            if (!sessionId || !host) return send({ type: "error", code: "no_session", message: "say hello first" });
            await host.orchestrator.placeBet(sessionId, minor(msg.stake), msg.autoCashOut, msg.clientEntropy);
            break;
          }
          case "cash_out": {
            if (!sessionId || !host) return send({ type: "error", code: "no_session", message: "say hello first" });
            await host.orchestrator.cashOut(sessionId, msg.betId);
            break;
          }
          case "ping": send({ type: "pong" }); break;
          default: send({ type: "error", code: "unknown_type", message: "unknown message" });
        }
      } catch (e) { send({ type: "error", code: "server_error", message: (e as Error).message }); }
    });

    ws.on("close", () => { if (sessionId && host) host.orchestrator.closeSession(sessionId); });
  });
}

/** Build the shared HTTP request handler (health, games, fairness). */
export function crashHttpRoutes(games: Map<string, GameHost>, defaultGameId: string, gamesList?: () => unknown) {
  return (req: IncomingMessage, res: import("node:http").ServerResponse): boolean => {
    if (req.url === "/health") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true })); return true; }
    if (req.url === "/games") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(gamesList ? gamesList() : [...games.keys()], null, 2)); return true; }
    if (req.url?.startsWith("/fairness")) {
      const gameId = new URL(req.url, "http://x").searchParams.get("game") ?? defaultGameId;
      const host = games.get(gameId);
      const body = { gameId, scheme: "commit-reveal over a pre-committed server-seed hash chain (anti-grind)", ...(host?.fairness ? (host.fairness() as object) : {}) };
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(body, null, 2)); return true;
    }
    return false;
  };
}

export function startWsServer(opts: WsServerOptions): { http: Server; wss: WebSocketServer; close: () => Promise<void> } {
  const http = createServer((req, res) => {
    if (req.url === "/health") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true })); return; }
    if (req.url === "/games") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(opts.gamesList ? opts.gamesList() : [...opts.games.keys()], null, 2));
      return;
    }
    if (req.url?.startsWith("/fairness")) {
      const gameId = new URL(req.url, "http://x").searchParams.get("game") ?? opts.defaultGameId;
      const host = opts.games.get(gameId);
      const body = {
        gameId,
        scheme: "commit-reveal over a pre-committed server-seed hash chain (anti-grind)",
        verify: "For each round, SHA-256(revealed serverSeed) === the previous round's serverSeed; " +
          "the first links to serverSeedChainTerminal, published before round 0. " +
          "crashPoint = floor((1-edge)/(1-float)*100)/100 where float = first 48 bits of " +
          "HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}:crash`).",
        ...(host?.fairness ? (host.fairness() as object) : {}),
      };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body, null, 2));
      return;
    }
    res.writeHead(404); res.end();
  });

  const wss = new WebSocketServer({ server: http, path: "/ws" });

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
    let sessionId: string | null = null;
    let host: GameHost | null = null;
    const send = (m: ServerMessage) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); };

    ws.on("message", async (data) => {
      let msg: ClientMessage;
      try { msg = JSON.parse(String(data)); } catch { return send({ type: "error", code: "bad_json", message: "invalid json" }); }
      try {
        switch (msg.type) {
          case "hello": {
            const gameId = msg.gameId ?? opts.defaultGameId;
            host = opts.games.get(gameId) ?? null;
            if (!host) return send({ type: "error", code: "unknown_game", message: `no game '${gameId}'` });
            const s = await host.orchestrator.openSession(msg.sessionToken, send);
            sessionId = s.sessionId;
            break;
          }
          case "place_bet": {
            if (!sessionId || !host) return send({ type: "error", code: "no_session", message: "say hello first" });
            await host.orchestrator.placeBet(sessionId, minor(msg.stake), msg.autoCashOut, msg.clientEntropy);
            break;
          }
          case "cash_out": {
            if (!sessionId || !host) return send({ type: "error", code: "no_session", message: "say hello first" });
            await host.orchestrator.cashOut(sessionId, msg.betId);
            break;
          }
          case "ping":
            send({ type: "pong" });
            break;
          default:
            send({ type: "error", code: "unknown_type", message: "unknown message" });
        }
      } catch (e) {
        send({ type: "error", code: "server_error", message: (e as Error).message });
      }
    });

    ws.on("close", () => { if (sessionId && host) host.orchestrator.closeSession(sessionId); });
  });

  http.listen(opts.port);

  return {
    http,
    wss,
    close: () => new Promise<void>((resolve) => { wss.close(() => http.close(() => resolve())); }),
  };
}
