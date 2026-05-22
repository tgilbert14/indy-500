# 🏁 Gilberts at the Brickyard — Indy 500 Family Tracker

A live Indy 500 tracker your whole family follows on their own phones. Everyone
picks 3+ drivers (no two people can pick the *exact* same set), and the
leaderboard, family standings, sounds, and confetti update live during the race.

## Why there's a backend (the important part)

There is **no free public live-timing feed** for the Indy 500. IndyCar's timing
runs over a private protocol into a websocket app, and the commercial APIs
(Sportradar) only publish results *after* a session ends. A plain web page on a
phone therefore can't pull live positions on its own.

So this app is a small server you host on **Azure**. The server:

- **Auto-updates the race** by running a real headless Chromium browser
  server-side, loading IndyCar's public leaderboard every ~20 seconds and reading
  the running order. (A server has no cross-origin restrictions, so it can do
  what a phone can't.)
- **Syncs picks + the race** to every family member's phone.
- Has a **Manual scorekeeper** fallback and a **Simulation** mode for testing.

> ⚠️ **Honest caveat:** the auto-scraper targets a live web page I cannot test
> against until race day. If IndyCar changes their page or blocks it mid-race, the
> auto feed can break. That's exactly why **Manual mode** exists — one tap and you
> drive the running order yourself from the TV broadcast. Plan to have a person
> ready to do that as a backstop.

---

## What's in here

| File | What it does |
|------|--------------|
| `server.js` | Express app: serves the site, the JSON API, and runs the live poller |
| `scraper.js` | Headless-browser leaderboard scraper + the simulation engine |
| `state.js` | Shared picks + race state, saved to disk; **enforces the picks rules** |
| `public/index.html` | The whole front-end (the app your family sees) |
| `Dockerfile` | Based on Microsoft's Playwright image so the browser "just works" on Azure |

---

## Try it on your own computer first (optional, ~2 min)

You need [Node.js 20+](https://nodejs.org).

```bash
npm install              # installs Express + downloads Chromium for Playwright
npm start                # starts on http://localhost:8080
```

Open http://localhost:8080. It starts in **Sim mode**, so you'll immediately see a
fake race moving — great for testing picks, sounds, and the standings before Sunday.

The Race Control PIN defaults to **1911** (the year of the first Indy 500).

---

## Deploy to Azure (the real thing)

This deploys as a container to **Azure App Service**, which gives us persistent
storage (so picks survive restarts). You only need the
[Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) installed and
to be logged in (`az login`).

Pick your own unique names where shown. Copy-paste these one block at a time:

```bash
# 0) names — change APP and ACR to something globally unique (lowercase, no spaces)
RG=indy500-rg
LOC=eastus
ACR=indy500acr$RANDOM        # must be globally unique
APP=gilberts-indy500-$RANDOM # becomes https://APP.azurewebsites.net

# 1) resource group
az group create -n $RG -l $LOC

# 2) build the container in the cloud (no local Docker needed)
az acr create -n $ACR -g $RG --sku Basic --admin-enabled true
az acr build -t indy500:latest -r $ACR .

# 3) app service plan (B1 is the cheapest tier that stays "always on")
az appservice plan create -n indy500-plan -g $RG --is-linux --sku B1

# 4) create the web app from your container
az webapp create -g $RG -p indy500-plan -n $APP \
  --deployment-container-image-name $ACR.azurecr.io/indy500:latest

# 5) let the web app pull from your registry
ACR_PWD=$(az acr credential show -n $ACR --query "passwords[0].value" -o tsv)
az webapp config container set -g $RG -n $APP \
  --docker-custom-image-name $ACR.azurecr.io/indy500:latest \
  --docker-registry-server-url https://$ACR.azurecr.io \
  --docker-registry-server-user $ACR \
  --docker-registry-server-password "$ACR_PWD"

# 6) settings: port, PERSISTENT storage (so picks survive), and YOUR admin PIN
az webapp config appsettings set -g $RG -n $APP --settings \
  WEBSITES_PORT=8080 \
  WEBSITES_ENABLE_APP_SERVICE_STORAGE=true \
  DATA_DIR=/home/data \
  ADMIN_PIN=2026          # <-- change this to your own secret PIN

# 7) (recommended) keep it warm so the poller never sleeps
az webapp config set -g $RG -n $APP --always-on true

echo "Your app: https://$APP.azurewebsites.net"
```

Give it 1–2 minutes after the last command, then open the URL. Share that link
with the family — that's all they need.

### Updating later

Re-run step 2 (`az acr build ...`) then restart: `az webapp restart -g $RG -n $APP`.

---

## Configuration (App Settings)

| Setting | Default | Purpose |
|---------|---------|---------|
| `ADMIN_PIN` | `1911` | PIN to open **Race Control**. **Change this.** |
| `POLL_MS` | `20000` | How often the server refreshes the race (ms) |
| `LEADERBOARD_URL` | `https://leaderboard.indycar.com/` | Source the auto-scraper loads |
| `ROW_SELECTOR` | (sensible default) | CSS selector for leaderboard rows — see race-day tips |
| `DATA_DIR` | `/home/data` | Where picks are saved (persistent on App Service) |

---

## 🏁 Race-day playbook (Sunday, May 24)

**A few days before:** open the app, tap ⚙️ → enter your PIN → **Sim** mode. Watch a
fake race run so everyone learns the app. Have each person add themselves on the
**Picks** tab and choose 3+ drivers.

**~30 min before the green flag:**
1. Tap ⚙️ → **Race Control** → switch to **Auto**.
2. Watch the **Leaderboard** tab. Within a minute or two you should see real
   positions appear and the footer should say *"Live from IndyCar leaderboard."*
3. **If it works** — you're done, just enjoy the race. 🍿
4. **If the footer shows a ⚠ warning** (the scrape couldn't read the page), switch
   to **Manual** and use the running-order panel: tap ▲/▼ to move drivers, set the
   lap and flag, then **Push to everyone**. You only need to keep roughly the top
   10–15 accurate. It syncs to all phones instantly.

**Advanced (only if Auto won't read positions):** the leaderboard's HTML structure
is the one thing I couldn't test live. If Auto consistently fails, open
`leaderboard.indycar.com` in Chrome during the race, press F12 → Network → look for
a request returning JSON with car numbers and positions. If you find a clean JSON
URL, set it as `LEADERBOARD_URL`. Otherwise just ride with Manual mode — it's
designed to be quick and is 100% reliable.

---

## The picks rules (enforced by the server)

- Each person picks **3 or more** drivers.
- **Overlap is fine** — two people can share drivers.
- **No two people may pick the exact same full set.** If you try, the app asks you
  to swap at least one driver. (Order doesn't matter; `{10, 9, 5}` equals
  `{5, 9, 10}`.)
- Standings rank each person by the **average finishing position** of their drivers
  (lower is better). The leader gets a 👑.
