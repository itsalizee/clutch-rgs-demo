# Hosted demo — one shareable link, both games

A single web service serves **everything on one port**: the landing page, both
game clients, and both WebSocket game servers. That's the whole point — an
aggregator BD contact clicks one link and plays Ascent (crash) and Ascent Cross
(astronaut step-climb) with no setup.

```
GET  /              landing page (links to both games)
GET  /ascent/       Ascent crash client      ──ws──>  /ws        (place_bet/cash_out)
GET  /cross/        Ascent Cross client      ──ws──>  /ws/cross  (open_run/hop/cash_out)
GET  /health        liveness {ok:true}
GET  /games         crash catalogue (ascent, comet, pulse)
GET  /fairness      Ascent provably-fair disclosure (?game=ID)
GET  /fairness/cross Ascent Cross provably-fair disclosure
```

> **Why not Vercel?** Vercel (where clutchstudios.co lives) is serverless — it
> can't hold an open WebSocket, which is why the live `/play` currently shows
> "RGS offline". This service must run on an **always-on host**. Once deployed,
> you can point `clutchstudios.co/play` at it.

---

## Run it locally
```bash
cd ascent-rgs
npm install
npm run start:hosted          # serves on http://localhost:8080
# open http://localhost:8080
```
Override the port with `PORT=8097 npm run start:hosted`.

---

## Deploy — pick one host (both free to start)

### Option A — Render (recommended; `render.yaml` is included)
1. Push this repo to GitHub (see below).
2. Render dashboard → **New → Blueprint** → connect the repo.
3. Render reads `render.yaml`, builds the `Dockerfile`, deploys.
4. You get `https://clutch-rgs-demo.onrender.com` → **that's the link.**

Free tier sleeps after ~15 min idle (first hit takes ~30s to wake). For a demo
you're actively sharing, bump the plan to **Starter (~$7/mo)** for always-on.

### Option B — Railway
1. Push to GitHub.
2. railway.app → **New Project → Deploy from GitHub repo**.
3. Railway auto-detects the `Dockerfile` and builds. It injects `$PORT`.
4. **Settings → Networking → Generate Domain** → that's the link.

### Option C — Fly.io (CLI)
```bash
fly launch --no-deploy      # accept the Dockerfile; sets internal_port=8080
fly deploy
```

All three use the same `Dockerfile`. No host-specific code.

---

## Push to GitHub (one-time)
```bash
cd ascent-rgs
git init && git add -A && git commit -m "hosted RGS demo: both games, one port"
gh repo create clutch-rgs-demo --private --source=. --push
```

---

## Point clutchstudios.co/play at the live demo (optional, after deploy)
The marketing site can iframe or link to the hosted client. Two ways:
- **Simplest:** make `/play` link to `https://<your-host>/ascent/` (and add a
  second button to `/cross/`).
- **Embedded:** iframe `https://<your-host>/ascent/` — it connects to its own
  origin's `/ws`, so it works regardless of where it's embedded.

You can also override the socket per-embed with `?rgs=wss://host/ws`.

---

## What aggregators should look at
- Play both games back-to-back — same wallet balance, same look, **one socket**.
- Hit `/fairness` and `/fairness/cross` — the commit/reveal + seed-chain scheme.
- Note: outcomes/balances/timing are all server-side; the client renders only.

This is **play-money** mode (balances reset, no real funds, no cert/license yet —
see `docs/CERT-AND-LICENSE-PLAN.md`). Don't claim "certified/RNG-tested."

---

## Rebuilding the Ascent crash client (only if you change the game)
`public/ascent/` is a prebuilt static bundle from the `rugged` repo. To refresh:
```bash
cd ../rugged
VITE_RGS_PATH=/ws npx vite build --base=/ascent/
rm -rf ../ascent-rgs/public/ascent && cp -R dist ../ascent-rgs/public/ascent
```
`VITE_RGS_PATH=/ws` makes the built client connect to a **same-origin** socket
(so it works on any host); `--base=/ascent/` makes asset URLs resolve under
`/ascent/`. The Cross client in `public/cross/` is hand-written static HTML —
edit it directly.
