# Clutch Studios — Certification & Licensing Action Plan

*The two external gates between "built" and "earning." Code can't clear these —
this is the operational checklist. Costs/timelines are industry-typical ESTIMATES
to size the effort; get real quotes. Not legal advice.*

---

## TL;DR sequencing (run in parallel where you can)
1. **Register a B2B entity** (jurisdiction drives everything downstream). — weeks
2. **Engage an accredited test lab** for the RNG/RGS + per-game certification. — 2–4 months
3. **Apply for a B2B supplier license** (start with Curaçao). — 1–3 months
4. **Aggregator onboarding + demos in parallel** (doesn't need cert to *start*).
5. Go live on cert + license; pursue tier-1 licenses (MGA/UKGC) later for premium markets.

Realistic first-to-market window: **~4–6 months** and roughly **~$40k–$120k** all-in
for entity + one lab cert (engine + 2 games) + a Curaçao supplier license. Wide range —
nail it down with quotes.

---

## Gate 1 — Certification (the #1 blocker for real-money listing)

**What it is.** An accredited lab audits your RNG, RTP, game rules, and the RGS
system controls, then issues a certificate operators/aggregators require.

**Who.** GLI (Gaming Laboratories International), iTech Labs, BMM Testlabs are the
big three. GLI-19 is the relevant standard for **online gaming systems / RNG**;
each game also gets math/RTP certification.

**What they inspect — and what you ALREADY have built for it:**
| Lab requirement | Status in the RGS |
|---|---|
| Server-authoritative RNG seeded from a CSPRNG | ✅ built |
| Outcome reproducible from logged seeds | ✅ built (seed chain + reveal) |
| No outcome/balance logic on the client | ✅ built |
| Immutable, append-only tx + round audit logs | ✅ built (in-memory; move to Postgres for prod) |
| Configured RTP == realized RTP over large samples | ✅ `npm run rtp` + analytic proof |
| Deterministic replay of any round from logs | ✅ built |
| Provably-fair method documented | ✅ `docs/provably-fair.md` |

So the **technical submission pack is ~80% done.** What's missing is the *engagement*
(and Postgres-backed durable logs for a production deployment).

**Estimated cost / time.** ~$10k–$40k for the RNG/RGS cert + the engine; per-game math
cert often bundled or a few $k each. ~2–4 months. (Bundling Ascent + Ascent Cross on
one engine cert is cheaper than two separate efforts — a real argument for the
"one engine, many games" architecture.)

**Action steps:**
1. Email GLI **and** iTech Labs for a scope + quote (RNG/RGS GLI-19 + 2 crash/instant games).
2. Prepare the submission pack: source access, RNG description, the RTP harness output,
   the provably-fair spec, audit-log schema, deterministic-replay demo. *(Most exists.)*
3. Stand up a production deployment with **Postgres-backed** tx/audit logs (interfaces
   already exist; it's a swap, not a rewrite).
4. Pick the lab whose markets match your target operators (GLI is broadest).

---

## Gate 2 — B2B Supplier License + Entity

Most aggregators require the game **supplier** to be licensed (or to supply under
the aggregator's license in some setups — confirm per partner).

**Entity first.** Register a company in a gaming-friendly jurisdiction — the choice
shapes which licenses you can hold and your tax/banking. Common: **Curaçao**, Malta,
Isle of Man, Estonia. Cheapest/fastest path to market = Curaçao.

**Licensing ladder:**
- **Curaçao (entry):** under the new CGA regime, a B2B/supplier license is the cheapest,
  fastest route. ~weeks–3 months; lower five-figures to set up + ongoing fees. Good
  enough to onboard with many aggregators and crypto-forward operators.
- **MGA (Malta) / UKGC / Isle of Man (premium):** required for tier-1 regulated
  markets (UK, much of EU). Slower (6–12 months), more expensive, more compliance.
  Pursue *after* you're live and earning on Curaçao.

**Action steps:**
1. Pick a jurisdiction (Curaçao to start) + a corporate-services/igaming-law firm.
2. Register the entity; open banking (the hard part for igaming — budget time).
3. File the B2B supplier license application (the lab cert supports this).
4. Decide tier-1 (MGA/UKGC) timing based on which operators your aggregator unlocks.

---

## What you can do TODAY (no cert/license needed)
- **Aggregator BD outreach + demos** — start now with the live demo + data sheet +
  one-pager; align integration and commercials *while* cert/license run in parallel.
- **Get the quotes** (labs + a Curaçao firm) — these have lead time; requesting them
  is free and starts the clock.
- **Productionize persistence** (Postgres swap) so the system the lab audits is the
  system you'll run.

## Honest framing
The build is done and built-to-certify. The remaining unlocks are **money + time +
paperwork**, not engineering. The single highest-leverage next action is to **request
lab + Curaçao quotes this week** — everything else sequences off those numbers.
