# Provably Fair — method, verification, and status

## Method (per round)
1. **Commit.** The round's `serverSeed` is the next link of a **pre-committed hash
   chain** (see below) — *not* freshly random. The server publishes the per-round
   `commitment = SHA-256(serverSeed)` before betting closes.
2. **Inputs.** A public `clientSeed` and a `nonce` (= round number) bind the round.
   By default the client seed **chains** to the previous round's revealed server
   seed: `clientSeed = SHA-256(prevServerSeed)` (`ChainedEntropySource`).
3. **Derive.** The crash point is
   `crashFromFloat( float( HMAC-SHA256(serverSeed, "clientSeed:nonce:crash") ), edge )`.
   The Moon Pool trigger uses a different tag (`...:moonpool`), so the two outcomes
   are independent. `edge` is the operator's configured house edge.
4. **Reveal.** At settlement the server publishes `serverSeed`. Anyone checks
   `SHA-256(serverSeed) === commitment`, recomputes the crash point, **and** checks
   the chain link (below).

The exact functions live in `src/engine/provablyfair.ts`, `crash.ts`, and
`seedchain.ts` — the *same code* the client/verifier import. No hidden second
implementation.

## Server-seed chain (anti-grind) — IMPLEMENTED
The whole sequence of server seeds is fixed before round 0 by a single published
value, so the operator cannot grind per-round seeds:

```
chain[len-1] = random tip
chain[i]     = SHA-256(chain[i+1])      // built backward
terminal     = SHA-256(chain[0])        // PUBLISHED before round 0 (GET /fairness)
```

Rounds consume the chain forward (round k uses `chain[k]`), so for every reveal:

```
SHA-256(seed_k) === seed_{k-1}          // links to the previous reveal
SHA-256(seed_0) === terminal            // links to the public commitment
```

A verifier walks any reveal back to the terminal that was public before the
operator saw a single bet. Code: `src/engine/seedchain.ts` (`SeedChain`,
`verifyChainLink`). Exposed at `GET /fairness` (`serverSeedChainTerminal`).
Tested in `test/seedchain.test.ts` and `test/round-engine.test.ts`; the reference
client (`npm run smoke`) verifies a live reveal chains to the terminal.

## Client-seed entropy (anti-genesis-grind) — ACTIVATED
The chain stops per-round grinding. A maximally-adversarial operator could still
grind the **genesis** (try many tips, keep one whose whole run is house-favourable)
*iff* the client seed is fully determined by the chain. So the client seed mixes in
inputs the operator could NOT predict when it built the chain. Both are live:

`MixedEntropySource` (`src/engine/entropy.ts`):
```
clientSeed = SHA-256( prevServerSeed | sorted player entropy | external entropy | nonce )
```
finalised at **betting close** (after all inputs are in), then the crash point is
derived. Two independent non-operator inputs feed it:

1. **Player commit–reveal (live).** Every bet carries a random `clientEntropy`
   (client → `place_bet.clientEntropy` → engine, collected per round). Any round
   with ≥1 bet is genesis-grind-proof: its outcome depends on players' randomness
   that didn't exist at chain-build time.
2. **External block hash (live, resilient).** `BlockHashEntropyProvider`
   (`src/engine/external-entropy.ts`) fetches the Bitcoin tip hash during the
   betting window and mixes it in — covering **player-less rounds** too. If the
   feed is unreachable the round falls back gracefully (never stalls). Disable with
   `EXTERNAL_ENTROPY=0`.

Both the finalised `clientSeed` and the `externalEntropy` value are published in the
`betting_closed` message, so anyone can re-fetch the block, re-mix, and confirm the
client seed — then recompute the crash from `(serverSeed, clientSeed, nonce)` after
reveal. Verified end-to-end by `npm run smoke` (player + external bound) and
`test/external-entropy.test.ts`.

## What this guarantees today
- **Players cannot precompute** outcomes (server seed secret until reveal).
- **Players can fully verify** every settled round (commit matches, crash
  reproduces, **and the reveal chains to a pre-published terminal**).
- **Per-round operator grinding is eliminated** by the pre-committed chain.
- The configured **RTP is provable** over large samples (`npm run rtp`).

## Honest status
All three anti-grind layers are **live**: the pre-committed server-seed chain,
player commit–reveal entropy, and external block-hash entropy for player-less
rounds. The scheme is engineered to be auditable and independently verifiable.

It is **not certified and not licensed** — those are external processes. No
"certified / RNG-tested" claim is made anywhere in code or UI until an accredited
lab (GLI / iTech) has issued a report.
