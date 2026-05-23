# 🏁 Redeploy Guide — Gilberts at the Brickyard (next year)

This is the **proven, working** way to put the tracker back online for a future
Indy 500, using **Azure Container Instances (ACI)** with durable storage. It's the
path we actually landed on after hitting a couple of Azure walls (documented at the
bottom). Follow the blocks top to bottom in **Git Bash** on Windows.

> Why ACI and not App Service? Our Azure subscription has **0 dedicated-VM quota**, so
> App Service plans can't be created. ACI uses a different quota pool that works, and
> it lets us mount an Azure Files share so picks survive restarts.

---

## 0. Before you start (once)

- Install **Azure CLI**: https://learn.microsoft.com/cli/azure/install-azure-cli
- Install **Git** (gives you Git Bash).
- Sign in: open Git Bash and run `az login` (a browser window opens; pick your account).
- Confirm you're in: `az account show` should print JSON, not an error.

Keep **one Git Bash window open** for the whole process — the `VAR=...` names below
live in that window's memory.

---

## 1. Update the app for the new year (do this first)

In `public/index.html`, update the data near the top of the `<script>`:

- **`STARTING_GRID`** — the 33 drivers in qualifying order (start pos, car #, name, team, engine, flag, country, `indyWins`).
- **`SPONSORS`** — car # → primary sponsor.
- **`QUAL`** — car # → 4-lap qualifying speed (mph).
- **`TEAM_COLORS`** — add any new teams (primary + accent hex).
- **`RACE_START`** in the script (the green-flag time, used for the countdown).

PINs:
- **Team PIN** (add/edit teams) is `TEAM_PIN` in `public/index.html` — currently `2026`.
- **Race Control PIN** is the `ADMIN_PIN` env var, set at deploy time in step 4 — currently `1699`.

Commit your changes (optional but recommended): `git add -A && git commit -m "Update for <year> Indy 500" && git push`

---

## 2. Create the Azure foundations

```bash
cd "/d/Git/indy 500"          # adjust if your folder moved
RG=indy500-rg
LOC=eastus
ACR=indy500acr$RANDOM          # must be globally unique
APP=gilberts-indy500-$RANDOM   # becomes your web address label
echo "Registry: $ACR"
echo "App label: $APP"

# turn on the Azure features we use (one-time per subscription; safe to re-run)
az provider register --namespace Microsoft.ContainerRegistry --wait
az provider register --namespace Microsoft.ContainerInstance --wait
az provider register --namespace Microsoft.Storage --wait

# resource group + container registry
az group create -n $RG -l $LOC
az acr create -n $ACR -g $RG --sku Basic --admin-enabled true
```

**Write down the `Registry` and `App label` values it echoes** — if you ever reopen
the window you'll need to set them again (`ACR=...`, `APP=...`, plus `RG=indy500-rg`).

---

## 3. Build the app image (in the cloud — no local Docker needed)

```bash
az acr build -t indy500:latest -r $ACR .
```

Takes ~2–4 minutes (it pulls the Playwright base image and installs dependencies).
Finishes with `Run ID: ... was successful`.

---

## 4. Create durable storage + launch the container

```bash
export MSYS_NO_PATHCONV=1     # IMPORTANT: stops Git Bash from mangling /home/data

SA=indy500sa$RANDOM            # globally unique, lowercase, no dashes
echo "Storage: $SA"
az storage account create -n $SA -g $RG -l $LOC --sku Standard_LRS
SAKEY=$(az storage account keys list -n $SA -g $RG --query "[0].value" -o tsv)
az storage share-rm create -g $RG --storage-account $SA -n picks --quota 1

ACR_PWD=$(az acr credential show -n $ACR --query "passwords[0].value" -o tsv)
az container create -g $RG -n indy500app \
  --image $ACR.azurecr.io/indy500:latest \
  --registry-login-server $ACR.azurecr.io \
  --registry-username $ACR --registry-password "$ACR_PWD" \
  --os-type Linux --cpu 1 --memory 2 \
  --ports 80 --ip-address Public --dns-name-label $APP \
  --environment-variables ADMIN_PIN=1699 DATA_DIR=/home/data PORT=80 \
  --azure-file-volume-account-name $SA --azure-file-volume-account-key "$SAKEY" \
  --azure-file-volume-share-name picks --azure-file-volume-mount-path /home/data

az container show -g $RG -n indy500app --query "ipAddress.fqdn" -o tsv
```

The last line prints your address, e.g. `gilberts-indy500-12345.eastus.azurecontainer.io`.
Your app is at **http://that-address**. Give it ~1–2 minutes to boot, then share the link.

> Change `ADMIN_PIN=1699` to whatever Race Control PIN you want.

---

## 5. Redeploy after a code change (during the event)

Picks live on the storage share, so recreating the container keeps everyone's picks.

```bash
cd "/d/Git/indy 500"
RG=indy500-rg; ACR=<your-acr>; APP=<your-app-label>; SA=<your-storage>
export MSYS_NO_PATHCONV=1

az acr build -t indy500:latest -r $ACR .          # rebuild with new code

SAKEY=$(az storage account keys list -n $SA -g $RG --query "[0].value" -o tsv)
ACR_PWD=$(az acr credential show -n $ACR --query "passwords[0].value" -o tsv)
az container delete -g $RG -n indy500app --yes      # remove old (picks are safe on the share)
az container create -g $RG -n indy500app \
  --image $ACR.azurecr.io/indy500:latest \
  --registry-login-server $ACR.azurecr.io \
  --registry-username $ACR --registry-password "$ACR_PWD" \
  --os-type Linux --cpu 1 --memory 2 \
  --ports 80 --ip-address Public --dns-name-label $APP \
  --environment-variables ADMIN_PIN=1699 DATA_DIR=/home/data PORT=80 \
  --azure-file-volume-account-name $SA --azure-file-volume-account-key "$SAKEY" \
  --azure-file-volume-share-name picks --azure-file-volume-mount-path /home/data
```

After it's up, **hard-refresh** in the browser (close tab / reopen on phones) to get the new version.

---

## 6. Tear it all down (stops all charges)

When the race weekend is over:

```bash
az group delete -n indy500-rg --yes --no-wait
```

This deletes the container, registry, and storage. Next year, start again at step 1.
(While running, this setup costs only a few dollars total for a weekend.)

---

## Race-day operating notes

- **⚙️ → Race Control** (PIN `1699`): choose how the live race updates.
  - **Auto** = scrape IndyCar's leaderboard. **Manual** = you set the order from the TV. **Sim** = demo.
  - Switching modes resets to the pre-race countdown until real data arrives.
- **Auto is best-effort** — the live scrape can't be tested until the race is on. If it
  stalls (footer shows a ⚠), switch to **Manual** and keep the top ~10–15 accurate.
- **Team PIN** `2026` is needed to add/edit teams.

---

## Gotchas we hit (so you don't have to rediscover them)

| Symptom | Cause | Fix |
|---|---|---|
| `MissingSubscriptionRegistration` | Feature not enabled on the subscription | `az provider register --namespace <NS> --wait` (step 2) |
| `Operation cannot be completed without additional quota … Total VMs: 0` | No App Service VM quota on this subscription | Use **ACI** (this guide) instead of App Service |
| `containerapp` extension won't install (pip error) | CLI extension/pip glitch | Avoided entirely — ACI is built into the core CLI |
| `The volume mount path cannot contain ':'` | Git Bash rewrote `/home/data` into a Windows path | `export MSYS_NO_PATHCONV=1` before `az container create` |
| Page shows "Not secure" | ACI serves plain http (no TLS) | Fine for a family pool; for a padlock, front it with Azure Front Door or move to Container Apps ingress |
| Variables empty / "resource not found" | Reopened Git Bash lost the `VAR=` values | Re-set `RG`, `ACR`, `APP`, `SA` at the top of your block |

## Project files

| File | Role |
|---|---|
| `public/index.html` | The whole app (frontend); also where you update the yearly data + Team PIN |
| `server.js` | Express server: serves the app, the API, runs the live poller |
| `scraper.js` | Headless-browser leaderboard scraper + simulation engine |
| `state.js` | Shared picks + race state on disk; enforces the picks rules + Race Control PIN |
| `Dockerfile` | Microsoft Playwright base image so the headless browser works |
