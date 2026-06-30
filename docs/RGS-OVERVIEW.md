# Ascent RGS — Status & Evaluation Overview

*A server-authoritative Remote Gaming Server for **Ascent**, a provably-fair crash
game by Clutch Studios. This is an honest engineering status — Ascent is built to
be **certifiable and aggregator-integrable**; it is **not yet certified or
licensed** (those are external processes). No "RNG-tested / certified" claim is
made anywhere in code or UI.*

---

## What it is
A Node.js + TypeScript RGS where **the server is the sole authority** for every
outcome, balance, and clock tick. The game client is a thin renderer over a
WebSocket — it sends intents (bet, cash-out) and displays server truth. It never
computes an outcome.

## Architecture (clean core, adapters at the edge)
```
Player client ──WS──┐
                    │   RGS CORE
Operator/aggregator │   ├─ Game engine (shared rounds, <50ms ticks, server clock)
   wallet  ──HTTP───┤   ├─ Provably-fair (commit/reveal + seed chain + entropy)
                    │   ├─ Wallet gateway (idempotent debit/credit/rollback)
                    │   └─ Persistence (append-only tx + audit + round logs)
                    └─ Adapters: one per aggregator (no aggregator protocol leaks into the core)
```

## Provably fair — three independent anti-grind layers (all live)
1. **Pre-committed server-seed chain.** The whole run of outcomes is sealed before
   round 0 by one published `terminal` hash. Each reveal hashes to the previous,
   back to the terminal — the operator cannot grind per-round seeds.
2. **Player commit-reveal entropy.** Every bet contributes random `clientEntropy`,
   mixed into the round's client seed at betting close. Any round with a player is
   genesis-grind-proof.
3. **Public block-hash entropy.** The Bitcoin tip hash is mixed in for
   player-less rounds. Resilient: a feed outage falls back gracefully.

All verifiable: `GET /fairness` publishes the chain terminal + schemes; each
`betting_closed` discloses the client seed + the block hash; each reveal exposes
the server seed. Math is pure SHA-256/HMAC, single source of truth, shared by
server and verifier.

## What a test lab (GLI-19 scope) will find in place
| Requirement | Status |
|---|---|
| Server-authoritative outcomes, CSPRNG-seeded | ✅ |
| No game logic / balance authority on the client | ✅ |
| Outcome reproducible from logged seeds | ✅ |
| Immutable, append-only transaction + round-history logs (full per-bet trail) | ✅ |
| Configured RTP is the realized RTP over large samples | ✅ `npm run rtp` (2M rounds → ~96.9% @ 97% target) |
| Deterministic replay of any round from logs | ✅ |
| Per-operator config: RTP/edge, bet limits, max win, currencies, features | ✅ |
| Responsible-gaming hooks (limits / reality checks passed from operator) | ✅ seam |
| Money as integer minor units; idempotent, reconciled wallet calls | ✅ |

## What an aggregator gets
- **One integration** to a canonical WebSocket + seamless-wallet contract; their
  protocol is mapped by a thin **per-aggregator adapter**, never baked into the core.
- **Seamless wallet**: idempotent `debit / credit / rollback` by `txId`, integer
  minor units, auto-rollback on round abort, retry/reconciliation queue (a valid
  win is never dropped).
- **Demo / fun mode** (play-money, same engine + fairness) for sandboxes.
- Token-based launch session model.

## Verified now
`npm test` 25/25 · `npm run rtp` realized≈configured · `npm run smoke` plays a full
server-driven round and verifies all five fairness properties · live WS probe
confirmed a real BTC tip hash mixed into a round.

## Honest gaps (external / next)
- **Not certified, not licensed.** Engage an accredited lab (GLI/iTech) and obtain
  a B2B supplier license + entity — months-long, external, paid.
- **Aggregator wallet adapter** is built to spec but needs a *specific* aggregator's
  sandbox/API docs to finalize.
- **Persistence** is in-memory behind Postgres-ready interfaces; admin/reporting UI
  pending.

## Evaluate it in 60 seconds
```bash
cd ascent-rgs && npm install && npm start      # RGS on ws://localhost:8080
curl localhost:8080/fairness                   # public fairness disclosure
npm run smoke                                   # one round, fully verified
npm run rtp                                     # RTP over millions of rounds
```
