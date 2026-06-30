# Ascent — Game Data Sheet

**Studio:** Clutch Studios  **Game:** Ascent  **Type:** Crash / instant
**Theme:** Memecoin "pump & rug" with a Moon Pool progressive
**Engine:** Server-authoritative RGS (Node/TS, WebSocket), provably fair

*All math figures below are generated from the production engine over 20,000,000
simulated rounds and are reproducible (`npm run datasheet`). Ascent is built to be
GLI/iTech certifiable; it is not yet certified.*

---

## At a glance
| Spec | Value |
|---|---|
| **RTP** | **97.00%** (operator-configurable edge; default 3%) |
| **Volatility** | **Very High** (median 1.93×, mean 16.7×, heavy tail) |
| **Max win** | Operator-configurable exposure cap (recommended 5,000×–10,000×) |
| **Bet range** | Operator-configurable per currency (min/max) |
| **Round cadence** | ~4–6 rounds/min (configurable betting + intermission) |
| **Hit frequency** | 96.0% of rounds reach ≥1.01×; 48.5% reach ≥2× |
| **Instant rug (1.00×)** | 3.96% |
| **Players per round** | Shared multiplayer (one curve, one crash for all) |
| **Currencies** | 140+ fiat & crypto (minor-unit accounting) |
| **Devices** | Mobile-first, desktop, drop-in iframe or SDK |
| **Provably fair** | Yes — commit/reveal + pre-committed seed chain + player & block-hash entropy |

## Math model — crash distribution
The crash point maps a uniform value `r` via
`crash = floor((1 − edge) / (1 − r) × 100) / 100`, giving the defining property
**P(crash ≥ x) ≈ RTP / x** at every target — i.e. RTP is identical no matter where
a player cashes out. Verified:

| Cash-out target | P(reach) | Realized RTP |
|---|---|---|
| 1.01× | 96.04% | 97.00% |
| 1.5× | 64.66% | 96.98% |
| 2× | 48.50% | 97.00% |
| 3× | 32.33% | 96.99% |
| 5× | 19.40% | 96.99% |
| 10× | 9.70% | 97.01% |
| 50× | 1.94% | 97.00% |
| 100× | 0.97% | 96.73% |
| 1,000× | 0.097% | 96.81% |

Distribution: instant-rug 3.96% · median 1.93× · 90th pct 9.68× · 99th pct 94.5× ·
mean 16.7× · max observed 10,865,308× (theoretical tail bounded per round by the
operator's max-win cap).

## Features
- **Provably fair, three anti-grind layers:** pre-committed server-seed hash chain
  (published terminal), per-bet player entropy, and a public Bitcoin block-hash for
  player-less rounds. Every round independently verifiable.
- **Moon Pool progressive:** ~1-in-55 independent provably-fair trigger funded by a
  disclosed 1.5% skim; pays the full pool to a random holder that round, win or
  lose. Sits *on top* of the 97% base RTP — does not change it.
- **Player tools:** auto-cash-out, one-tap rebet, live bet feed + chat, per-round
  history.
- **Responsible gaming built in:** session/loss/deposit limits, reality checks,
  self-exclusion hooks (enforced from operator-supplied limits), clear odds.

## Operator configuration (per brand)
RTP/edge (e.g. 90–99%), min/max bet per currency, max-win/exposure cap, allowed
currencies and jurisdictions, and feature flags (auto-cashout, rebet, feed, chat).

## Technical / integration
- **One integration:** canonical REST launch + WebSocket play + seamless wallet.
- **Seamless wallet:** idempotent `debit / credit / rollback` by `txId`, integer
  minor units, auto-rollback on round abort, reconciliation retry queue.
- **Per-aggregator adapter** maps your protocol to our contract — no aggregator
  shape leaks into the core.
- **Demo / fun mode:** play-money, same engine + fairness, for sandboxes.
- **Audit:** append-only tx + round-history logs; deterministic replay from seeds.

## Status (honest)
Production-grade, server-authoritative, provably-fair engine — verified by test
suite + RTP harness + reference client. **Pending before real-money listing:**
accredited-lab certification (GLI/iTech), a B2B supplier license + entity, and an
aggregator-specific wallet adapter (built to spec, finalized against your sandbox).

*Contact: team@clutchstudios.co*
