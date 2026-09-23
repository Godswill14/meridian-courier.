# Meridian Courier

A courier tracking website:
- **Track** — anyone, anywhere, can look up a shipment by tracking number. No login required.
- **Admin** — password-protected panel to register shipments (generates the tracking number) and log status updates.

It's a small Node.js + Express app that serves both the frontend and a JSON API, backed by a simple file-based datastore (`data/store.json`), so there's nothing else to install or configure to get it running.

## 1. Run it locally

Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
cd meridian-courier
npm install
cp .env.example .env
```

Open `.env` and set `ADMIN_PASSWORD` to something long and random — this is the only thing protecting your admin panel.

```bash
npm start
```

Visit `http://localhost:3000`. Click **Admin**, sign in with the password you set, and create a test shipment. Then go to **Track** and look it up with the tracking number it gives you.

## 2. Host it so anyone on the internet can use it

This is a normal Node.js web app, so it runs on almost any host. Three easy, low-cost/free options:

### Option A — Render (easiest, free tier available)
1. Push this folder to a GitHub repository.
2. Go to [render.com](https://render.com) → New → Web Service → connect your repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Under **Environment**, add `ADMIN_PASSWORD` with your chosen password.
5. Deploy. Render gives you a public `https://your-app.onrender.com` URL immediately — that's your live, publicly accessible site.
6. **Important:** Render's free tier has an ephemeral filesystem, so `data/store.json` will reset on redeploys/restarts. Fine for testing; see "Growing beyond the file store" below before relying on it for real shipments.

### Option B — Railway
1. Push to GitHub, then [railway.app](https://railway.app) → New Project → Deploy from GitHub repo.
2. Railway auto-detects Node and runs `npm start`.
3. Add the `ADMIN_PASSWORD` environment variable in the Railway dashboard.
4. Attach a **Railway Volume** mounted at `/app/data` so `store.json` persists across deploys (Settings → Volumes).
5. Railway gives you a public URL under Settings → Networking → Generate Domain.

### Option C — Your own VPS (DigitalOcean, Hetzner, EC2, etc.)
1. SSH in, install Node.js 18+.
2. Copy this folder to the server (`scp` or `git clone`).
3. `npm install --production`, set up `.env` with your `ADMIN_PASSWORD`.
4. Run it under a process manager so it survives reboots/crashes:
   ```bash
   npm install -g pm2
   pm2 start server.js --name meridian-courier
   pm2 save && pm2 startup
   ```
5. Put [Caddy](https://caddyserver.com) or Nginx in front for HTTPS and your domain name. Caddy is the simplest — a two-line Caddyfile gets you automatic free HTTPS:
   ```
   yourdomain.com {
     reverse_proxy localhost:3000
   }
   ```

Any of these gets you a real `https://` URL that works for anyone in the world, on any device, with no login required to track a package — exactly what you asked for. Point your domain's DNS at whichever host you pick, or use the free subdomain they give you.

## 3. The database

Shipment data lives in `data/store.json`, a single JSON file the server reads and writes. It's simple, requires zero setup, and is genuinely fine for a small operation (dozens to low hundreds of shipments). Back it up like any file (a cron job that copies it somewhere, or your host's volume snapshots).

### Growing beyond the file store
If you start handling real volume, want multiple admins working concurrently without any risk of write conflicts, or need to query/report on shipments, swap `readStore()`/`writeStore()` in `server.js` for a real database. The path of least resistance:
- **Postgres** — Railway, Render, Supabase, and Neon all offer a free/cheap managed Postgres instance. Use an ORM like [Prisma](https://www.prisma.io) or [Drizzle](https://orm.drizzle.team) to replace the two datastore functions with real queries; the rest of the API (`server.js` routes) doesn't need to change shape.
- **SQLite** (via `better-sqlite3`) — a good middle ground if you want a real embedded database without running a separate server, on a host with a persistent disk.

## 4. Security notes
- Change `ADMIN_PASSWORD` from the example before deploying — never ship the default.
- The admin panel is protected by a single shared password sent as a header on each request. That's fine for one or a few trusted staff. If you need individual staff logins, audit trails, or role-based access, that's a bigger step up (e.g. adding proper user accounts) — happy to help build that if you need it.
- Always deploy behind HTTPS (all three hosting options above give you this automatically or with one config line) so the admin password isn't sent in the clear.

## Project structure
```
meridian-courier/
├── server.js          # Express API + serves the frontend
├── package.json
├── .env.example        # copy to .env and fill in ADMIN_PASSWORD
├── public/
│   └── index.html      # the whole frontend (track + admin UI)
└── data/
    └── store.json       # created automatically on first run
```
