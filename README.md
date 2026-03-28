# 🎰 Lottery Intel

A minimal GDELT-powered lottery news dashboard.  
**Railway** runs the seeder every 6 hours → writes to **Upstash Redis** → **Vercel** serves the API and frontend.

---

## Architecture

```
GDELT API (free, no key)
     ↓  scripts/seed.mjs  (Railway cron, every 6h)
Upstash Redis  (free tier)
     ↓  api/topics.js + api/timeline.js  (Vercel serverless)
public/index.html  (static frontend on Vercel)
```

---

## Deployment — Step by Step

### Step 1 — Upstash Redis (2 min)

1. Go to [upstash.com](https://upstash.com) → **Create account** (free)
2. Click **Create Database** → choose a region close to you → **Create**
3. Open the database → **REST API** tab
4. Copy **UPSTASH_REDIS_REST_URL** and **UPSTASH_REDIS_REST_TOKEN** — you'll need both below

---

### Step 2 — GitHub (1 min)

```bash
git init
git add .
git commit -m "init"
gh repo create lottery-intel --public --push --source=.
```

Or on GitHub.com: **New repository** → upload this folder.

---

### Step 3 — Vercel (3 min)

1. Go to [vercel.com](https://vercel.com) → **Add New Project**
2. Import your GitHub repo
3. Framework Preset: **Other** (leave defaults)
4. Open **Environment Variables** and add:
   - `UPSTASH_REDIS_REST_URL` → paste from Step 1
   - `UPSTASH_REDIS_REST_TOKEN` → paste from Step 1
5. Click **Deploy**

Your frontend will be live at `https://lottery-intel-xxx.vercel.app`.  
The API endpoints will be at `/api/topics`, `/api/timeline`, `/api/health`.

> **Note:** The dashboard will show "Seed not yet available" until the Railway seeder runs in Step 4.

---

### Step 4 — Railway (5 min)

Railway runs the seed script on a schedule so GDELT data stays fresh.

1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. Select your `lottery-intel` repo
3. Railway will detect `nixpacks.toml` automatically
4. Click your service → **Variables** tab → add:
   - `UPSTASH_REDIS_REST_URL` → same value as Vercel
   - `UPSTASH_REDIS_REST_TOKEN` → same value as Vercel
5. Click **Deploy** — this runs the seeder **once immediately**
6. Go to **Settings** → **Cron Schedule** → enter: `0 */6 * * *` (every 6 hours)
7. Save

After the first deploy finishes (~3 min including GDELT delays), go back to your Vercel URL and reload — you should see articles.

---

## Local Development

```bash
cp .env.example .env.local
# fill in your Upstash credentials

npm install

# Run the seeder once (populates Redis)
npm run seed

# Start the API server locally (port 3000)
npm run dev
```

Then open `public/index.html` directly in your browser, or serve it with any static server.

---

## API Reference

| Endpoint | Description |
|---|---|
| `GET /api/topics` | All 6 topics with their articles |
| `GET /api/timeline?topic=jackpot` | 14-day tone + volume timeline for a topic |
| `GET /api/health` | Seed status check |

Valid topic IDs: `jackpot`, `winners`, `draws`, `regulation`, `scams`, `fundraising`

---

## Cost

| Service | Cost |
|---|---|
| GDELT API | Free, no key needed |
| Upstash Redis | Free tier (10K cmd/day) |
| Vercel | Free tier (Hobby) |
| Railway | ~$5/month Hobby plan |

Total: **~$5/month** (Railway only), everything else is free.
