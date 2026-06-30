# Ascent RGS — Remote Gaming Server

Server-authoritative Remote Gaming Server for the **Ascent** crash game. Built to
be **GLI/iTech certifiable** and integrated by iGaming aggregators via one
canonical contract + per-aggregator adapters.

> **Not certified.** This codebase makes Ascent *certifiable and integrable*; it
> does not make it certified. No "RNG Tested / certified" claim appears anywhere
> until a real certificate exists. (Build brief §0, §12.)

## The one architectural rule
**The server is the only authority for outcomes, balances, and timing. The client
is a renderer.** The crash point is generated and held server-side; players only
see what the server streams. (The original Vite/Pixi demo computed outcomes in the
browser — disqualifying for real money; this RGS fixes that.)

## Architecture (brief §2)
```
RGS CORE
  engine/        pure, certifiable math (provably-fair SHA-256/HMAC, crash, moonpool, money)
  core/          RoundEngine — shared-round state machine + tick loop (outcome+timing authority)
  wallet/        WalletGateway contract + DemoWallet (idempotent; adapters implement this)
  persistence/   append-only TxLog + AuditLog + RoundStore (in-memory now, Postgres later)
  protocol/      canonical WebSocket messages (client <-> RGS)
  server/        orchestrator (money + books) + ws transport + main entrypoint
  config/        per-operator config (RTP/edge, limits, currencies, features)
  adapters/      one per aggregator (Phase 2) — translate their protocol to ours
```
Money never lives in the engine; the orchestrator moves it on engine events. No
aggregator protocol leaks into the core.

## Round lifecycle (shared, multiplayer — brief §3)
`BETTING_OPEN` → `IN_FLIGHT` (sub-50ms ticks) → `CRASH` → `SETTLEMENT` (reveal) →
intermission → next. Every player shares one curve and one crash point. Cash-out
uses the **server clock**; the client cannot supply a multiplier.

## Run it
```bash
npm install
npm test          # provably-fair vectors, RTP convergence, full round lifecycle, wallet idempotency
npm run rtp       # RTP harness: realized RTP vs configured (default 2M rounds)
npm run start     # demo RGS on ws://localhost:8080/ws
npm run smoke     # reference WS client: plays a full round and verifies the reveal
```

## Money rules (brief §5, §12)
- All amounts are **integer minor units** (`Minor`). Never floats.
- Every money call is **idempotent** by `txId`; replays are no-ops.
- Debit precedes engine-accept; a rejected bet **rolls back** the debit.
- Failed credits go to a **reconciliation queue** and retry — a win is never dropped.

## Provably fair (brief §4) — and an honest limitation
Per round: a random server seed is committed (`SHA-256(serverSeed)`) before betting
closes; the crash point is `crashFromFloat(HMAC-SHA256(serverSeed, "clientSeed:nonce:crash"), edge)`;
the seed is revealed at settlement so anyone re-hashes and recomputes. The public
client seed **chains** to the previous round's revealed seed.

⚠️ **Phase-1 limitation (tracked in `docs/provably-fair.md`):** because the server
generates each seed knowing the (chained) client seed, a fully adversarial operator
could in principle *grind* seeds. Production must adopt a **pre-committed seed chain
+ external client-seed entropy** (e.g. a future block hash) to remove that vector.
Player-side verifiability is already complete; this hardens against the operator.

## Build phases
- **Phase 1 (this):** RGS core — shared rounds, server authority, provably-fair
  commit/reveal, demo mode, WS protocol, RTP harness, tests. *Pending:* repoint the
  Pixi client at the RGS (replace `rugged/src/rgs-adapter/rgs.mock.ts` with a
  WebSocket adapter implementing the same `Rgs` seam).
- **Phase 2:** real wallet adapter for the first aggregator + sandbox; token launch.
- **Phase 3:** per-operator config UI, RG hooks, deterministic replay, Postgres,
  admin/reporting.

## Status: Phase 1 core — engine, orchestrator, WS server, demo mode, tests. ✅
