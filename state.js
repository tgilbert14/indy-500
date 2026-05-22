// ============================================================
// state.js — shared race + picks store, persisted to disk
// Single source of truth for the whole family. Plain JSON file
// so it survives App Service restarts (/home is persistent).
// ============================================================
import fs from 'node:fs';
import path from 'node:path';

// Where to persist. On Azure App Service, /home is durable.
// Locally it falls back to ./data.
const DATA_DIR = process.env.DATA_DIR
  || (fs.existsSync('/home') ? '/home/data' : path.join(process.cwd(), 'data'));
const STATE_FILE = path.join(DATA_DIR, 'state.json');

// The 33-car starting grid car numbers (kept in sync with the
// STARTING_GRID in public/index.html). Used to validate picks.
export const VALID_CARS = [
  '10','20','12','60','14','5','8','23','3','9','76','75','33','06','21',
  '66','28','7','26','6','45','31','2','18','27','11','47','15','19','51',
  '77','4','24'
];
const VALID_SET = new Set(VALID_CARS);

const TOTAL_LAPS = 200;

function emptyState() {
  return {
    members: [],            // [{ id, name, picks:[carNum,...], createdAt }]
    race: {
      mode: 'sim',          // 'sim' | 'auto' | 'manual'
      status: 'pre',        // 'pre' | 'in' | 'post'
      flag: null,           // 'green'|'yellow'|'red'|'white'|'checkered'|null
      lap: 0,
      totalLaps: TOTAL_LAPS,
      source: 'none',       // 'scraper'|'manual'|'sim'|'none'
      updatedAt: null,
      // positions: { [carNum]: { pos, laps, gap, status } }
      positions: {},
      note: ''              // human-readable status line (e.g. scraper health)
    },
    rev: 0                  // bumps on every change so phones know to re-render
  };
}

let state = emptyState();

// ---------- persistence ----------
export function load() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      // Merge so new fields get defaults if loading an older file.
      state = { ...emptyState(), ...parsed, race: { ...emptyState().race, ...(parsed.race || {}) } };
    }
  } catch (e) {
    console.error('[state] load failed, starting fresh:', e.message);
    state = emptyState();
  }
  return state;
}

let saveTimer = null;
function save() {
  // Debounce writes a touch so a burst of updates doesn't thrash disk.
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (e) {
      console.error('[state] save failed:', e.message);
    }
  }, 250);
}

function bump() { state.rev++; save(); }

export function get() { return state; }

// ---------- members & picks ----------
function newId() { return Math.random().toString(36).slice(2, 9); }

function normalizePicks(picks) {
  // unique, valid, as strings, sorted for stable comparison
  const clean = [...new Set((picks || []).map(p => String(p)))].filter(p => VALID_SET.has(p));
  return clean;
}

function setKey(picks) {
  return [...picks].sort().join(',');
}

export function addMember(name) {
  name = String(name || '').trim().slice(0, 24);
  if (!name) return { error: 'Name required' };
  if (state.members.some(m => m.name.toLowerCase() === name.toLowerCase())) {
    return { error: 'That name already exists' };
  }
  const member = { id: newId(), name, picks: [], createdAt: Date.now() };
  state.members.push(member);
  bump();
  return { member };
}

export function removeMember(id) {
  const before = state.members.length;
  state.members = state.members.filter(m => m.id !== id);
  if (state.members.length !== before) bump();
  return { ok: true };
}

// The headline rule:
//   • each member must pick 3 or more drivers
//   • overlap between members is allowed
//   • but no two members may have the EXACT same full set
export function setPicks(id, picks) {
  const member = state.members.find(m => m.id === id);
  if (!member) return { error: 'Unknown family member' };

  const clean = normalizePicks(picks);

  // Allow saving an in-progress (under-3) selection so the UI can
  // build up gradually, but flag it so the client can warn.
  const complete = clean.length >= 3;

  if (complete) {
    const key = setKey(clean);
    const clash = state.members.find(m => m.id !== id && m.picks.length >= 3 && setKey(m.picks) === key);
    if (clash) {
      return { error: `Those are the exact same 3 as ${clash.name}. Swap at least one driver — overlap is fine, but no identical sets.` };
    }
  }

  member.picks = clean;
  bump();
  return { member, complete };
}

export function resetAll() {
  state = emptyState();
  bump();
  return { ok: true };
}

// ---------- race state (used by scraper / manual / sim) ----------
// positions: array of { num, pos, laps?, gap?, status? } OR object keyed by num
export function applyRaceUpdate({ positions, lap, status, flag, source, note }) {
  const r = state.race;
  if (positions) {
    const map = {};
    const arr = Array.isArray(positions) ? positions : Object.entries(positions).map(([num, v]) => ({ num, ...v }));
    arr.forEach(p => {
      const num = String(p.num);
      if (!VALID_SET.has(num)) return;
      map[num] = {
        pos: Number(p.pos),
        laps: p.laps != null ? Number(p.laps) : null,
        gap: p.gap != null ? String(p.gap) : null,
        status: p.status ? String(p.status) : 'on track'
      };
    });
    if (Object.keys(map).length) r.positions = map;
  }
  if (lap != null) r.lap = Number(lap);
  if (status) r.status = status;
  if (flag !== undefined) r.flag = flag;
  if (source) r.source = source;
  if (note !== undefined) r.note = note;
  r.updatedAt = Date.now();
  bump();
  return r;
}

export function setMode(mode) {
  if (!['sim', 'auto', 'manual'].includes(mode)) return { error: 'bad mode' };
  state.race.mode = mode;
  state.race.note = '';
  bump();
  return { race: state.race };
}
