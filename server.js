// ============================================================
// server.js — single Azure App Service app
//   • serves the frontend (public/index.html) to every phone
//   • JSON API for picks + race state (CORS enabled)
//   • background poller that auto-updates the race:
//        mode 'auto'   -> Playwright scrape of IndyCar leaderboard
//        mode 'sim'    -> built-in simulation (great for testing)
//        mode 'manual' -> whatever the scorekeeper last entered
//   • admin endpoints (mode switch + manual scoring) gated by a PIN
// ============================================================
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './state.js';
import { scrapeLive, simStep, simReset, closeBrowser } from './scraper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;
const ADMIN_PIN = process.env.ADMIN_PIN || '1911'; // change in Azure config!
const POLL_MS = Number(process.env.POLL_MS || 20000);

store.load();

const app = express();
app.use(express.json({ limit: '256kb' }));

// --- CORS: family opens this from phones; allow all origins (read/write of
//     a low-stakes family game). Same-origin in practice when served here. ---
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Pin');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function requireAdmin(req, res, next) {
  const pin = req.get('X-Admin-Pin') || req.body?.pin;
  if (String(pin) !== String(ADMIN_PIN)) return res.status(403).json({ error: 'Bad admin PIN' });
  next();
}

// ---------------- public API ----------------
app.get('/api/state', (req, res) => {
  const s = store.get();
  res.json({ members: s.members, race: s.race, rev: s.rev });
});

app.post('/api/members', (req, res) => {
  const r = store.addMember(req.body?.name);
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

app.post('/api/members/:id/remove', (req, res) => {
  res.json(store.removeMember(req.params.id));
});

app.post('/api/members/:id/picks', (req, res) => {
  const r = store.setPicks(req.params.id, req.body?.picks || []);
  if (r.error) return res.status(409).json(r); // 409 = the "identical set" clash
  res.json(r);
});

// ---------------- admin / scorekeeper ----------------
app.post('/api/admin/mode', requireAdmin, (req, res) => {
  const mode = req.body?.mode;
  if (mode === 'sim') simReset();
  const r = store.setMode(mode);
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

// Manual scoring: scorekeeper sends the running order as an array of car numbers
// (index 0 = P1). Also accepts lap / status / flag.
app.post('/api/admin/race', requireAdmin, (req, res) => {
  const { order, lap, status, flag, note } = req.body || {};
  let positions;
  if (Array.isArray(order)) {
    positions = order.map((num, i) => ({ num: String(num), pos: i + 1 }));
  }
  const race = store.applyRaceUpdate({ positions, lap, status, flag, source: 'manual', note });
  res.json({ race });
});

app.post('/api/admin/reset', requireAdmin, (req, res) => {
  res.json(store.resetAll());
});

// ---------------- static frontend ----------------
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---------------- background poller ----------------
let scraperHealthy = true;
async function tick() {
  const race = store.get().race;
  try {
    if (race.mode === 'sim') {
      store.applyRaceUpdate(simStep());
    } else if (race.mode === 'auto') {
      const data = await scrapeLive();
      scraperHealthy = true;
      store.applyRaceUpdate({
        positions: data.positions,
        lap: data.lap ?? undefined,
        status: 'in',
        source: 'scraper',
        note: `Live from IndyCar leaderboard · ${new Date().toLocaleTimeString()}`
      });
    }
    // mode 'manual' -> do nothing; scorekeeper drives it.
  } catch (e) {
    if (race.mode === 'auto') {
      scraperHealthy = false;
      store.applyRaceUpdate({
        note: `⚠ Auto feed hiccup (${e.message.slice(0, 80)}). Keeping last data — flip to Manual if it persists.`
      });
      console.error('[poll] scrape failed:', e.message);
    }
  } finally {
    setTimeout(tick, POLL_MS);
  }
}

app.listen(PORT, () => {
  console.log(`Brickyard tracker on :${PORT} (mode=${store.get().race.mode}, poll=${POLL_MS}ms)`);
  setTimeout(tick, 1500);
});

process.on('SIGTERM', async () => { await closeBrowser(); process.exit(0); });
process.on('SIGINT', async () => { await closeBrowser(); process.exit(0); });
