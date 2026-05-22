# Deploying the full live version (Azure)

The demo at GitHub Pages runs "on-device" (per-phone picks, simulated race). To get
**shared picks across everyone's phones** and the **real auto-updating race**, run the
app on a small server. These steps deploy it to **Azure App Service** as a container
(the container includes the headless browser the live scraper needs).

## Why there's a server at all

There's no free public live-timing feed for the Indy 500 — IndyCar's timing runs over
a private protocol into a websocket app, and the commercial APIs only publish results
*after* a session ends. So the server uses a real headless Chromium browser to read
IndyCar's public leaderboard server-side (where there are no cross-origin limits) and
relays it to every phone. **Caveat:** that scrape targets a live web page that can't be
tested until race day, so Manual mode exists as a guaranteed fallback.

## Run it on your own computer first (optional)

Needs [Node.js 20+](https://nodejs.org).

```bash
npm install     # installs Express + downloads Chromium for Playwright
npm start       # http://localhost:8080
```

Starts in Sim mode. Race Control PIN defaults to **1911**.

## Deploy to Azure

You need the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) and
to be logged in (`az login`). Run these one block at a time, changing the names where shown.

```bash
# 0) names — APP and ACR must be globally unique (lowercase, no spaces)
RG=indy500-rg
LOC=eastus
ACR=indy500acr$RANDOM
APP=gilberts-indy500-$RANDOM   # becomes https://APP.azurewebsites.net

# 1) resource group
az group create -n $RG -l $LOC

# 2) build the container in the cloud (no local Docker needed)
az acr create -n $ACR -g $RG --sku Basic --admin-enabled true
az acr build -t indy500:latest -r $ACR .

# 3) app service plan (B1 stays "always on")
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

# 6) settings: port, persistent storage (picks survive restarts), and YOUR admin PIN
az webapp config appsettings set -g $RG -n $APP --settings \
  WEBSITES_PORT=8080 \
  WEBSITES_ENABLE_APP_SERVICE_STORAGE=true \
  DATA_DIR=/home/data \
  ADMIN_PIN=2026          # <-- change to your own secret PIN

# 7) keep it warm so the live poller never sleeps
az webapp config set -g $RG -n $APP --always-on true

echo "Your app: https://$APP.azurewebsites.net"
```

Give it 1–2 minutes, then open the URL and share it with the family.

**To update later:** re-run step 2 (`az acr build ...`), then `az webapp restart -g $RG -n $APP`.

## Settings (Azure → Configuration → App settings)

| Setting | Default | Purpose |
|---------|---------|---------|
| `ADMIN_PIN` | `1911` | PIN to open Race Control. **Change this.** |
| `POLL_MS` | `20000` | How often the server refreshes the race (ms) |
| `LEADERBOARD_URL` | `https://leaderboard.indycar.com/` | Source the auto-scraper loads |
| `ROW_SELECTOR` | (sensible default) | CSS selector for leaderboard rows, if it needs tweaking |
| `DATA_DIR` | `/home/data` | Where picks are saved (persistent on App Service) |

## If Auto can't read positions on race day

The leaderboard's HTML is the one thing that can't be tested until the race is live. If
Auto consistently fails, just use **Manual** mode (it's quick and 100% reliable).
Advanced: open `leaderboard.indycar.com` in Chrome during the race, press F12 → Network,
and if you spot a request returning JSON with car numbers + positions, set its URL as
`LEADERBOARD_URL`.

## Project files

| File | What it does |
|------|--------------|
| `server.js` | Express app: serves the site, the JSON API, runs the live poller |
| `scraper.js` | Headless-browser leaderboard scraper + the simulation engine |
| `state.js` | Shared picks + race state, saved to disk; enforces the picks rules |
| `public/index.html` | The whole front-end (works with the server, or on-device without it) |
| `index.html` (root) | Redirect so the GitHub Pages URL is clean |
| `Dockerfile` | Microsoft Playwright base image so the browser works on Azure |
