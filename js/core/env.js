// Environmental tells: footprints in snow, and sweeping searchlights.
// Both are deterministic: prints live in world.s.tracks, beams are a function of world.s.t.
import { F } from './constants.js';
import { hasLOS } from './los.js';

// ---------------- footprints ----------------

const TRACK_STEP = 0.7;      // tiles between prints
const MAX_TRACKS = 360;

// How long prints stay readable: falling snow fills them in.
export function trackLife(world) {
  const w = world.weather || world.def.weather;
  return w === 'blizzard' ? 45 : w === 'snow' ? 100 : 200;
}

// Heroes and the people they lead leave prints on snow tiles (enemies' own boots are ignored).
export function leaveTracks(world, u, moved) {
  if ((u.kind !== 'hero' && u.kind !== 'npc') || u.inVehicle || moved <= 0) return;
  const f = world.grid.get(Math.floor(u.x), Math.floor(u.y));
  if (!(f & F.SNOW) || (f & (F.WATER | F.DEEP | F.INDOOR))) { u.trackD = 0; return; }
  u.trackD = (u.trackD || 0) + moved;
  if (u.trackD < TRACK_STEP) return;
  u.trackD = 0;
  const s = world.s;
  const list = s.tracks || (s.tracks = []);
  s.trackN = (s.trackN || 0) + 1;
  list.push({ n: s.trackN, x: u.x, y: u.y, a: u.a, t: s.t, by: u.id, prone: u.stance === 'prone' });
  if (list.length > MAX_TRACKS) list.splice(0, list.length - MAX_TRACKS);
}

export function pruneTracks(world) {
  const list = world.s.tracks;
  if (!list || !list.length) return;
  const cut = world.s.t - trackLife(world);
  let i = 0;
  while (i < list.length && list[i].t < cut) i++;
  if (i) list.splice(0, i);
}

// The next print along a trail: the furthest-along print close to where the follower stands.
export function nextTrack(world, n, at) {
  const list = world.s.tracks || [];
  let best = null;
  for (const tr of list) {
    if (tr.n <= n || Math.hypot(tr.x - at.x, tr.y - at.y) > 2.6) continue;
    if (!best || tr.n > best.n) best = tr;
  }
  return best;
}

// Mark a whole stretch of trail as read, so one guard does not loop back over it.
export function readTrail(world, tr) {
  for (const o of world.s.tracks || []) if (o.by === tr.by && Math.hypot(o.x - tr.x, o.y - tr.y) < 10) o.seen = true;
}

// ---------------- searchlights ----------------

// Current beam: origin, angle and whether it is burning. Angles are radians (0 = east, y grows south).
export function beamOf(world, sl) {
  const st = world.s.objs[sl.id] || {};
  const on = !st.lightOff && !st.destroyed;
  const crew = sl.crew ? world.byTag(sl.crew).find((c) => c.state === 'ok') : null;
  const ls = (world.s.lights || {})[sl.id];
  let a;
  if (crew && crew.ai && crew.ai.mode === 'alert' && crew.ai.last) a = Math.atan2(crew.ai.last.y - sl.y, crew.ai.last.x - sl.x);
  else if (sl.crew && !crew) a = ls && ls.frozen != null ? ls.frozen : sl.a0;      // nobody turning it: it stays put
  else {
    const k = 0.5 - 0.5 * Math.cos((world.s.t / sl.period + sl.phase) * Math.PI * 2);
    a = sl.a0 + (sl.a1 - sl.a0) * k;
  }
  return { x: sl.x, y: sl.y, a, on, range: sl.range, width: sl.width };
}

// Is a point inside this light's burning beam (and not behind a wall)?
export function inBeamOf(world, sl, x, y) {
  const b = beamOf(world, sl);
  if (!b.on) return false;
  const dx = x - b.x, dy = y - b.y, d = Math.hypot(dx, dy);
  if (d > b.range || d < 0.5) return false;
  const along = dx * Math.cos(b.a) + dy * Math.sin(b.a);
  if (along <= 0) return false;
  const across = Math.abs(-dx * Math.sin(b.a) + dy * Math.cos(b.a));
  if (across > Math.max(1.1, along * Math.tan(b.width / 2))) return false;
  return hasLOS(world.grid, b.x, b.y, x, y);
}

// Is a point inside any burning beam?
export function inBeam(world, x, y) {
  const lights = world.searchlights;
  if (!lights || !lights.length) return false;
  for (const sl of lights) if (inBeamOf(world, sl, x, y)) return true;
  return false;
}

// Crews spot whoever stands in their beam for half a second, and then track them with it.
export function updateSearchlights(world, dt, becomeAlert) {
  const lights = world.searchlights;
  if (!lights || !lights.length) return;
  const ls = world.s.lights || (world.s.lights = {});
  for (const sl of lights) {
    const rec = ls[sl.id] || (ls[sl.id] = { expose: 0, frozen: null });
    const crew = sl.crew ? world.byTag(sl.crew).find((c) => c.state === 'ok') : null;
    if (sl.crew && !crew) { if (rec.frozen == null) rec.frozen = rec.lastA ?? sl.a0; continue; }
    const b = beamOf(world, sl);
    rec.lastA = b.a;
    if (!b.on || !crew || crew.ai.mode === 'alert') { rec.expose = 0; continue; }
    let caught = null;
    for (const h of world.heroes()) {
      if (h.state !== 'ok' || (h.hidden && (h.hidden.startsWith('b:') || h.hidden === 'water' || h.hidden === 'bush'))) continue;
      if (inBeamOf(world, sl, h.x, h.y)) { caught = h; break; }   // only this crew's own beam
    }
    rec.expose = caught ? rec.expose + dt : Math.max(0, rec.expose - dt);
    if (caught && rec.expose >= 0.5) { rec.expose = 0; becomeAlert(world, crew, caught); }
  }
}
