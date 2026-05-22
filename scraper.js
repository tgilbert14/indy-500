// ============================================================
// scraper.js — best-effort live IndyCar leaderboard scraper
// + a simulation engine for testing / pre-race demo.
//
// WHY A HEADLESS BROWSER:
//   IndyCar's live timing has no public JSON feed. The leaderboard
//   at leaderboard.indycar.com is a single-page app fed over a
//   websocket / REST timing service. A plain server fetch() only
//   gets an empty HTML shell. Running real Chromium server-side
//   renders the app and lets us either (a) capture the JSON the
//   page itself requests, or (b) read the rendered rows.
//
//   Because we cannot test against a live race until race day, the
//   selectors and URL are configurable via env vars, and the whole
//   thing fails SOFT — if anything breaks, server.js keeps the last
//   good data and you flip to manual mode from the app.
// ============================================================
import { chromium } from 'playwright';
import { VALID_CARS } from './state.js';

const VALID_SET = new Set(VALID_CARS);

const LEADERBOARD_URL = process.env.LEADERBOARD_URL || 'https://leaderboard.indycar.com/';
// DOM fallback selectors — override via env if IndyCar's markup differs.
const ROW_SELECTOR = process.env.ROW_SELECTOR || '[class*="leaderboard"] [class*="row"], table tbody tr, [role="row"]';

let browser = null;
async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  return browser;
}

export async function closeBrowser() {
  try { if (browser) await browser.close(); } catch {}
  browser = null;
}

// Pull car number + position out of an arbitrary JSON blob the page fetched.
// IndyCar/timing feeds vary, so we probe common field names.
function harvestFromJson(obj, out) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) { obj.forEach(o => harvestFromJson(o, out)); return; }

  const num = obj.no ?? obj.number ?? obj.carNo ?? obj.car ?? obj.carNumber ?? obj.startNumber;
  const pos = obj.rank ?? obj.pos ?? obj.position ?? obj.runningPosition ?? obj.overallRank;
  if (num != null && pos != null) {
    const car = String(num).replace(/^#/, '').trim();
    const p = parseInt(pos, 10);
    if (VALID_SET.has(car) && !isNaN(p)) {
      const laps = obj.laps ?? obj.lapsComplete ?? obj.lapCount ?? null;
      const gap = obj.gap ?? obj.behind ?? obj.diff ?? obj.timeBehind ?? null;
      const status = obj.status ?? obj.runningStatus ?? obj.flag ?? null;
      out.set(car, {
        num: car, pos: p,
        laps: laps != null ? parseInt(laps, 10) : null,
        gap: gap != null ? String(gap) : null,
        status: status ? String(status).toLowerCase() : 'on track'
      });
    }
  }
  for (const k of Object.keys(obj)) {
    if (obj[k] && typeof obj[k] === 'object') harvestFromJson(obj[k], out);
  }
}

// Returns { positions:[...], lap, source } or throws.
export async function scrapeLive() {
  const b = await getBrowser();
  const ctx = await b.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
  });
  const page = await ctx.newPage();
  const harvested = new Map();
  let maxLap = 0;

  // (a) Capture JSON the page requests — the most reliable signal.
  page.on('response', async (res) => {
    try {
      const ct = res.headers()['content-type'] || '';
      if (!ct.includes('json')) return;
      const body = await res.json().catch(() => null);
      if (!body) return;
      harvestFromJson(body, harvested);
      // Try to find a lap count anywhere in the payload.
      const txt = JSON.stringify(body);
      const m = txt.match(/"(?:lap|currentLap|lapNumber)"\s*:\s*(\d{1,3})/i);
      if (m) maxLap = Math.max(maxLap, parseInt(m[1], 10));
    } catch {}
  });

  try {
    await page.goto(LEADERBOARD_URL, { waitUntil: 'networkidle', timeout: 45000 });
    // Give the websocket/timing app a moment to push a frame.
    await page.waitForTimeout(4000);

    let positions = [...harvested.values()];

    // (b) DOM fallback if JSON capture found nothing.
    if (positions.length < 3) {
      const rows = await page.$$eval(ROW_SELECTOR, (els) => {
        const out = [];
        els.forEach((el) => {
          const text = el.innerText || '';
          // crude: first standalone 1-2 digit token = position, find a #car token
          const cells = text.split(/\s+/).filter(Boolean);
          out.push(cells.slice(0, 8));
        });
        return out;
      }).catch(() => []);

      const tmp = new Map();
      rows.forEach((cells) => {
        // Heuristic: position is the first integer, car number is a token matching the grid.
        let pos = null, car = null;
        for (const c of cells) {
          const t = c.replace(/[^\dOo]/g, '');
          if (pos == null && /^\d{1,2}$/.test(c)) pos = parseInt(c, 10);
          const cand = c.replace(/^#/, '');
          if (!car && VALID_SET.has(cand)) car = cand;
          if (!car && VALID_SET.has(t)) car = t;
        }
        if (pos != null && car && !tmp.has(car)) {
          tmp.set(car, { num: car, pos, laps: null, gap: null, status: 'on track' });
        }
      });
      positions = [...tmp.values()];
    }

    await ctx.close();

    if (positions.length < 3) {
      throw new Error('leaderboard returned too few rows (page structure may have changed)');
    }

    // Re-rank densely 1..N by reported pos in case of gaps.
    positions.sort((a, b) => a.pos - b.pos);
    positions.forEach((p, i) => { p.pos = i + 1; });

    return { positions, lap: maxLap || null, source: 'scraper' };
  } catch (e) {
    try { await ctx.close(); } catch {}
    throw e;
  }
}

// ============================================================
// SIMULATION ENGINE — realistic-ish moving field for demo/testing
// and as a graceful "show something" mode before the green flag.
// ============================================================
let sim = null;
export function simReset() {
  // start in grid order
  sim = {
    order: [...VALID_CARS],
    lap: 0,
    laps: Object.fromEntries(VALID_CARS.map(c => [c, 0])),
    out: new Set(),
    pit: new Set()
  };
}
export function simStep() {
  if (!sim) simReset();
  sim.lap = Math.min(200, sim.lap + Math.ceil(Math.random() * 3));

  // shuffle a couple of adjacent pairs — cars trade spots
  for (let k = 0; k < 3; k++) {
    const i = Math.floor(Math.random() * (sim.order.length - 1));
    if (Math.random() < 0.5) { const t = sim.order[i]; sim.order[i] = sim.order[i + 1]; sim.order[i + 1] = t; }
  }
  // occasional bigger move for excitement
  if (Math.random() < 0.25) {
    const from = 3 + Math.floor(Math.random() * (sim.order.length - 4));
    const to = Math.max(0, from - (2 + Math.floor(Math.random() * 4)));
    const [car] = sim.order.splice(from, 1);
    sim.order.splice(to, 0, car);
  }
  // rare DNF
  if (Math.random() < 0.03 && sim.out.size < 5) {
    const car = sim.order[sim.order.length - 1 - sim.out.size];
    if (car) sim.out.add(car);
  }
  // pit churn
  sim.pit = new Set();
  if (Math.random() < 0.5) {
    const car = sim.order[Math.floor(Math.random() * sim.order.length)];
    sim.pit.add(car);
  }

  const positions = sim.order.map((num, idx) => {
    sim.laps[num] = Math.min(sim.lap, (sim.laps[num] || 0) + Math.ceil(Math.random() * 3));
    let status = 'on track';
    if (sim.out.has(num)) status = 'out';
    else if (sim.pit.has(num)) status = 'pit';
    return {
      num, pos: idx + 1,
      laps: sim.out.has(num) ? sim.laps[num] : sim.lap,
      gap: idx === 0 ? '—' : `+${(idx * 0.6 + Math.random()).toFixed(1)}`,
      status
    };
  });
  const status = sim.lap >= 200 ? 'post' : 'in';
  const flag = sim.lap >= 200 ? 'checkered' : (Math.random() < 0.08 ? 'yellow' : 'green');
  return { positions, lap: sim.lap, status, flag, source: 'sim' };
}
