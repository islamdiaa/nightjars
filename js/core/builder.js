import { F, T, DIFF_RANK } from './constants.js';
import { Grid } from './grid.js';
import { mulberry32, makeNoise2D } from './rng.js';
import { makeEnemy, makeNpc, makeHero, makeVehicle } from './world.js';

// Map-building DSL used by every mission file. Coordinates are tiles; angles are degrees
// with 0 = east (+x) and 90 = south (+y), matching the top-down map as authored.
//
//   export default { id, size: [w, h], build(M) { M.fill(T.GRASS); M.road([[0,10],[40,10]], 3); … } }
//
// Areas are either rects {x, y, w, h} or polygons [[x, y], …].

const D2R = Math.PI / 180;

export class MapBuilder {
  constructor(def, heroData, difficulty = 'normal') {
    this.def = def;
    this.W = def.size[0]; this.H = def.size[1];
    this.grid = new Grid(this.W, this.H, def.ground ?? T.GRASS);
    // Opt in after the mission's routes/golden paths have been clearance-audited.
    this.grid.preciseMovement = !!def.preciseMovement;
    this.rnd = mulberry32(def.seed || 1);
    this.noise = makeNoise2D(def.seed || 1);
    this.things = []; this.zones = {}; this.spawns = []; this.ents = []; this.decor = []; this.lights = []; this.searchlights = [];
    this.heroData = heroData;
    this.difficulty = difficulty;
    this.rank = DIFF_RANK[difficulty];
    this.nextThing = 1;
    this.faction = def.enemyFaction || 'wehrmacht';
  }

  // ---------- area helpers ----------
  forTiles(area, fn) {
    if (Array.isArray(area)) {
      const xs = area.map((p) => p[0]), ys = area.map((p) => p[1]);
      const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(this.W - 1, Math.ceil(Math.max(...xs)));
      const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(this.H - 1, Math.ceil(Math.max(...ys)));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (pointInPoly(x + 0.5, y + 0.5, area)) fn(x, y);
    } else {
      const { x, y, w, h } = area;
      for (let j = Math.max(0, y); j < Math.min(this.H, y + h); j++) for (let i = Math.max(0, x); i < Math.min(this.W, x + w); i++) fn(i, j);
    }
  }
  r() { return this.rnd(); }
  rint(a, b) { return a + Math.floor(this.rnd() * (b - a + 1)); }

  // ---------- terrain ----------
  fill(t) { this.grid.terrain.fill(t); return this; }
  paint(area, t, flags = 0) {
    this.forTiles(area, (x, y) => { this.grid.setTerrain(x, y, t); if (flags) this.grid.addBase(x, y, flags); });
    return this;
  }
  rect(x, y, w, h, t, flags = 0) { return this.paint({ x, y, w, h }, t, flags); }
  circle(cx, cy, r, t, flags = 0) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r && this.grid.inside(x, y)) { this.grid.setTerrain(x, y, t); if (flags) this.grid.addBase(x, y, flags); }
    }
    return this;
  }
  // Thick polyline: roads, tracks, rivers, trenches. Width in tiles. Wobble adds organic edges.
  line(pts, width, t, flags = 0, wobble = 0) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const L = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(1, Math.ceil(L * 2));
      for (let s = 0; s <= n; s++) {
        const px = x0 + (x1 - x0) * s / n, py = y0 + (y1 - y0) * s / n;
        const r = width / 2 + (wobble ? (this.noise(px * 0.3, py * 0.3) - 0.5) * wobble : 0);
        this.circle(px, py, Math.max(0.5, r), t, flags);
      }
    }
    return this;
  }
  road(pts, width = 3, t = T.ROAD) { return this.line(pts, width, t, F.ROAD); }
  track(pts, width = 2, t = T.DIRT) { return this.line(pts, width, t, 0, 0.8); }
  river(pts, width = 5, bank = 1) {
    this.line(pts, width + bank * 2, T.MUD, 0, 1.2);
    this.line(pts, width, T.WATER, F.WATER, 1);
    if (width > 2.5) this.line(pts, width - 2, T.DEEP, F.DEEP, 0.8);
    return this;
  }
  water(area, deep = true) {
    this.paint(area, deep ? T.DEEP : T.WATER, deep ? F.DEEP : F.WATER);
    return this;
  }
  // Organic patches driven by noise: scatter(area, T.DIRT, 0.55, 0.15)
  scatter(area, t, threshold = 0.55, scale = 0.12, flags = 0) {
    this.forTiles(area, (x, y) => {
      if (this.noise(x * scale + 31, y * scale + 17) > threshold) { this.grid.setTerrain(x, y, t); if (flags) this.grid.addBase(x, y, flags); }
    });
    return this;
  }
  flags(area, f) { this.forTiles(area, (x, y) => this.grid.addBase(x, y, f)); return this; }
  unflag(area, f) { this.forTiles(area, (x, y) => this.grid.clearBase(x, y, f)); return this; }
  height(area, h) { this.forTiles(area, (x, y) => { this.grid.height[this.grid.idx(x, y)] = h; }); return this; }
  // A raised plateau whose edge tiles are a climbable cliff face.
  plateau(area, h, opts = {}) {
    const inside = new Set();
    this.forTiles(area, (x, y) => { inside.add(y * this.W + x); this.grid.height[this.grid.idx(x, y)] = h; });
    if (opts.cliffs !== false) {
      const cliffTiles = [];
      for (const k of inside) {
        const x = k % this.W, y = (k - x) / this.W;
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !inside.has((y + dy) * this.W + x + dx) && this.grid.inside(x + dx, y + dy));
        if (edge) { this.grid.addBase(x, y, F.CLIMB); this.grid.setTerrain(x, y, T.ROCK); cliffTiles.push([x, y]); }
      }
      for (const [x, y] of opts.ramps || []) this.grid.clearBase(x, y, F.CLIMB);
      if (opts.id) this.addThing({ id: opts.id, type: 'cliff', x: 0, y: 0, w: 0, h: 0, tiles: cliffTiles, render: false, state: {} });
    }
    return this;
  }

  // ---------- things ----------
  addThing(t) {
    t.id = t.id || ('t' + this.nextThing++);
    t.w = t.w ?? 1; t.h = t.h ?? 1;
    if (!t.tiles) { t.tiles = []; for (let j = 0; j < t.h; j++) for (let i = 0; i < t.w; i++) t.tiles.push([t.x + i, t.y + j]); }
    const idx = this.things.length;
    if (t.flags) for (const [x, y] of t.tiles) { this.grid.addBase(x, y, t.flags); if (this.grid.inside(x, y)) this.grid.owner[this.grid.idx(x, y)] = idx; }
    else for (const [x, y] of t.tiles) if (this.grid.inside(x, y) && this.grid.owner[this.grid.idx(x, y)] < 0) this.grid.owner[this.grid.idx(x, y)] = idx;
    this.things.push(t);
    return t;
  }
  blocked(x, y) { return (this.grid.base[this.grid.idx(x, y)] & (F.BLOCK | F.DEEP)) !== 0; }

  // Buildings. side = which wall has the door: 'n'|'s'|'e'|'w'. kind selects the model.
  building(x, y, w, h, opts = {}) {
    const side = opts.door || 's';
    const dx = opts.doorAt ?? Math.floor((side === 'n' || side === 's' ? w : h) / 2);
    const door = side === 's' ? [x + dx, y + h] : side === 'n' ? [x + dx, y - 1] : side === 'e' ? [x + w, y + dx] : [x - 1, y + dx];
    const t = this.addThing({
      id: opts.id, type: 'building', kind: opts.kind || 'house', x, y, w, h, flags: F.BLOCK | F.SIGHT | F.INDOOR,
      door, side, roof: opts.roof || 'gable', floors: opts.floors || 1, color: opts.color, roofColor: opts.roofColor,
      label: opts.label, destructible: !!opts.destructible, volatile: opts.volatile, ruined: !!opts.ruined,
      interact: opts.enter === false ? null : { kind: 'door', verb: 'Enter', at: door, reach: 0.9, dur: 0.4, repeat: true, ...(opts.interact || {}) },
      state: opts.state,
    });
    if (opts.enter !== false && this.grid.inside(door[0], door[1])) { this.grid.addBase(door[0], door[1], F.DOOR); this.grid.clearBase(door[0], door[1], F.BLOCK | F.SIGHT); }
    // A second way in (`door2: 'n', door2At`): its own clickable door that leads into the same
    // building. Heroes leave by whichever door is nearer where they are going.
    if (opts.door2 && opts.enter !== false) {
      const s2 = opts.door2, d2 = opts.door2At ?? Math.floor((s2 === 'n' || s2 === 's' ? w : h) / 2);
      const door2 = s2 === 's' ? [x + d2, y + h] : s2 === 'n' ? [x + d2, y - 1] : s2 === 'e' ? [x + w, y + d2] : [x - 1, y + d2];
      t.doors = [door, door2];
      if (this.grid.inside(door2[0], door2[1])) { this.grid.addBase(door2[0], door2[1], F.DOOR); this.grid.clearBase(door2[0], door2[1], F.BLOCK | F.SIGHT); }
      this.addThing({ id: (t.id) + ':door2', type: 'door', kind: 'door', building: t.id, side: s2, x: door2[0], y: door2[1], w: 1, h: 1, tiles: [], flags: 0, label: t.label,
        interact: { ...t.interact, at: door2 } });
    }
    return t;
  }

  tree(x, y, kind = 'pine', scale = 1) {
    if (!this.grid.inside(x, y) || this.blocked(x, y)) return null;
    return this.addThing({ type: 'tree', kind, x, y, scale, flags: scale >= 0.8 ? F.BLOCK | F.SIGHT : F.BLOCK, rot: this.r() * 6.28 });
  }
  // Forest: density 0..1, kinds picks models. Keeps tiles listed in `clear` (and roads/water) open.
  forest(area, density = 0.3, kinds = ['pine'], opts = {}) {
    const keep = new Set((opts.clear || []).map(([x, y]) => y * this.W + x));
    this.forTiles(area, (x, y) => {
      if (keep.has(y * this.W + x)) return;
      const f = this.grid.base[this.grid.idx(x, y)];
      if (f & (F.ROAD | F.WATER | F.DEEP | F.BLOCK | F.DOOR | F.INDOOR)) return;
      const n = this.noise(x * 0.17 + 5, y * 0.17 + 9);
      const p = density * (0.55 + n);
      if (this.r() < p) this.tree(x, y, kinds[Math.floor(this.r() * kinds.length)], 0.75 + this.r() * 0.5);
      else if (opts.under !== false && this.r() < density * 0.6) this.bush(x, y);
      if (opts.floor !== undefined && !(f & F.ROAD)) this.grid.setTerrain(x, y, opts.floor);
    });
    return this;
  }
  bush(x, y, kind = 'bush') {
    if (!this.grid.inside(x, y) || this.blocked(x, y)) return null;
    if (this.grid.base[this.grid.idx(x, y)] & (F.ROAD | F.WATER | F.DOOR)) return null;
    this.grid.addBase(x, y, F.BUSH);
    return this.addThing({ type: 'bush', kind, x, y, rot: this.r() * 6.28, scale: 0.8 + this.r() * 0.5 });
  }
  bushes(area, density = 0.3, kind = 'bush') {
    this.forTiles(area, (x, y) => { if (this.r() < density * (0.4 + this.noise(x * 0.2, y * 0.2))) this.bush(x, y, kind); });
    return this;
  }
  // Tall crops (wheat, maize, cane, elephant grass): a field that hides anyone inside it,
  // standing or not, beyond arm's length. Drawn as tall stalks.
  crops(area, kind = 'crop', opts = {}) {
    this.forTiles(area, (x, y) => {
      const f = this.grid.base[this.grid.idx(x, y)];
      if (f & (F.BLOCK | F.ROAD | F.WATER | F.DEEP | F.DOOR)) return;
      this.grid.addBase(x, y, F.TALL);
      if (opts.ground !== false) this.grid.setTerrain(x, y, opts.ground ?? T.FIELD);
      this.addThing({ type: 'bush', kind, x, y, rot: this.r() * 6.28, scale: 0.9 + this.r() * 0.25 });
    });
    return this;
  }
  hedge(pts, kind = 'hedge') {
    for (const [x, y] of rasterPolyline(pts)) if (this.grid.inside(x, y) && !this.blocked(x, y)) {
      this.grid.addBase(x, y, F.BUSH | F.LOW);
      this.addThing({ type: 'bush', kind, x, y, rot: 0, scale: 1 });
    }
    return this;
  }

  // Linear barriers: fences, walls, sandbags, wire. Gaps listed in opts.gaps stay open.
  barrier(pts, kind, flags, opts = {}) {
    const gaps = new Set((opts.gaps || []).map(([x, y]) => y * this.W + x));
    const tiles = rasterPolyline(pts).filter(([x, y]) => this.grid.inside(x, y) && !gaps.has(y * this.W + x));
    return this.addThing({ id: opts.id, type: opts.type || 'barrier', kind, x: tiles[0]?.[0] ?? 0, y: tiles[0]?.[1] ?? 0, w: 1, h: 1, tiles, flags, pts, cuttable: !!opts.cuttable, state: opts.cuttable || opts.destructible ? {} : undefined, height: opts.height, destructible: !!opts.destructible, label: opts.label });
  }
  wall(pts, opts = {}) { return this.barrier(pts, opts.kind || 'stone', opts.low ? F.BLOCK | F.LOW : F.BLOCK | F.SIGHT, opts); }
  fence(pts, opts = {}) { return this.barrier(pts, opts.kind || 'wood', F.BLOCK | (opts.low !== false ? F.LOW : 0), opts); }
  wire(pts, opts = {}) { return this.barrier(pts, opts.kind || 'wire', F.BLOCK | F.FENCE, { ...opts, type: 'fence', cuttable: opts.cuttable !== false }); }
  sandbags(pts, opts = {}) { return this.barrier(pts, 'sandbags', F.BLOCK | F.LOW, opts); }

  // A gate that can be opened by interaction.
  gate(x, y, w, h, opts = {}) {
    return this.addThing({ id: opts.id, type: 'gate', kind: opts.kind || 'gate', x, y, w, h, flags: F.BLOCK | (opts.solid ? F.SIGHT : 0), state: { open: !!opts.open }, destructible: !!opts.destructible, label: opts.label,
      interact: { kind: 'gate', verb: 'Open / close', dur: 0.8, repeat: true, ...(opts.interact || {}) } });
  }

  // Props: crates, barrels, vehicles, guns, tents, towers... `block` decides the footprint flags.
  prop(kind, x, y, opts = {}) {
    const def = PROPS[kind] || { w: 1, h: 1, flags: F.BLOCK | F.LOW };
    const rot = opts.rot || 0;
    const w = opts.w ?? (rot % 2 ? def.h : def.w), h = opts.h ?? (rot % 2 ? def.w : def.h);
    const flags = opts.flags ?? def.flags;
    return this.addThing({ id: opts.id, type: opts.type || 'prop', kind, x, y, w, h, rot, flags, label: opts.label || def.label,
      destructible: opts.destructible ?? def.destructible, volatile: opts.volatile ?? def.volatile, interact: opts.interact, limpet: opts.limpet, limpetFuse: opts.limpetFuse,
      color: opts.color, state: opts.state, light: opts.light, height: opts.height });
  }
  // Decorative only: rubble, craters, signposts, grass tufts. No collision.
  deco(kind, x, y, opts = {}) { this.decor.push({ kind, x, y, rot: opts.rot ?? this.r() * 6.28, scale: opts.scale ?? 1, color: opts.color }); return this; }

  // Light sources make the area around them LIT at night (vision at full range) and the rest DARK.
  lamp(x, y, r = 4, opts = {}) {
    const lit = [];
    for (let j = Math.floor(y - r); j <= Math.ceil(y + r); j++) for (let i = Math.floor(x - r); i <= Math.ceil(x + r); i++) {
      if (this.grid.inside(i, j) && Math.hypot(i + 0.5 - x, j + 0.5 - y) <= r) { this.grid.addBase(i, j, F.LIT); lit.push([i, j]); }
    }
    this.lights.push({ x, y, r, color: opts.color || 0xffd28a, kind: opts.kind || 'lamp', id: opts.id });
    let holder = null;
    if (opts.post !== false) holder = this.prop(opts.kind === 'fire' ? 'campfire' : opts.kind === 'searchlight' ? 'searchlight' : 'lamppost', Math.floor(x), Math.floor(y), { id: opts.id, flags: opts.kind === 'fire' ? F.BLOCK : F.BLOCK, light: true, state: opts.id ? {} : undefined });
    // A lamp without a post (on a wall, in a window) still needs a thing to carry its switch.
    else if (opts.id) holder = this.addThing({ id: opts.id, type: 'light', kind: opts.kind || 'lamp', x: Math.floor(x), y: Math.floor(y), w: 1, h: 1, tiles: [], light: true, state: {}, render: false });
    if (holder && opts.id) holder.litTiles = lit;
    return this;
  }

  // ---------- gameplay ----------
  zone(name, x, y, w, h, opts = {}) { this.zones[name] = { x, y, w, h, ...opts }; return this; }

  item(id, x, y, opts = {}) {
    return this.addThing({ id, type: 'item', kind: opts.kind || 'satchel', x, y, label: opts.label || 'the satchel', flags: 0,
      interact: { kind: 'pickup', verb: opts.verb || 'Take', dur: opts.dur ?? 0.8, item: id, name: opts.label, ...(opts.interact || {}) } });
  }
  target(id, kind, x, y, opts = {}) {
    return this.prop(kind, x, y, { ...opts, id, destructible: true, type: 'target' });
  }

  enemy(def) {
    if (def.min && DIFF_RANK[def.min] > this.rank) return null;
    const d = { faction: this.faction, ...def, a: (def.a || 0) * D2R };
    const e = makeEnemy(d, null);
    if (def.lang) e.lang = def.lang;
    this.ents.push(e);
    return e;
  }
  // A group of identical enemies at several points.
  enemies(list, common = {}) { for (const d of list) this.enemy({ ...common, ...d }); return this; }
  npc(def) { const n = makeNpc({ ...def, a: (def.a || 0) * D2R }); if (def.side) n.side = def.side; this.ents.push(n); return n; }
  // Boardable vehicles and boats: vtype jeep | kubel | truck | motorcycle | canoe | rubberboat | boat | fishingboat.
  vehicle(def) { const v = makeVehicle({ ...def, a: (def.a || 0) * D2R }); this.ents.push(v); return v; }
  hero(def, diff, inventory) {
    const data = this.heroData[def.hid];
    const h = makeHero({ ...def, a: (def.a || 0) * D2R }, data, diff, inventory || (this.def.inventory || {})[def.hid] || {});
    h.id = 'h_' + def.hid;
    // A hero who starts in uniform wears the garrison's (or the one the mission names).
    if (def.disguised) h.disguiseFaction = def.disguiseFaction || this.faction;
    // Missions that want prisoners (`capture: true`) let every hero who can knock a man down take one.
    if (this.def.capture && !h.abilities.includes('capture')) h.abilities.push('capture');
    // ...and anyone with a firearm can make an unsuspecting guard put his hands up.
    if (this.def.capture && !h.abilities.includes('surrender') && ['pistol', 'welrod', 'rifle', 'silentrifle', 'bren'].some((a) => h.abilities.includes(a))) h.abilities.push('surrender');
    this.ents.push(h);
    return h;
  }
  spawn(x, y, template = {}) { this.spawns.push({ x: x + 0.5, y: y + 0.5, template: { faction: this.faction, type: 'soldier', ...template } }); return this; }

  // A searchlight sweeping between two bearings (degrees). Its beam lights whatever it touches; with a
  // `crew` tag, that crew spots anyone held in the beam for half a second and then tracks them with it.
  // Knock the crew out and the beam freezes where it was. Switch it off with thingState(id).lightOff,
  // or destroy it with an explosion.
  searchlight(x, y, opts = {}) {
    const id = opts.id || `searchlight${this.things.length}`;
    const [s0, s1] = opts.sweep || [0, 90];
    this.prop('searchlight', Math.floor(x), Math.floor(y), { id, light: true, state: {}, flags: F.BLOCK | F.LOW });
    this.searchlights.push({ id, x, y, a0: s0 * Math.PI / 180, a1: s1 * Math.PI / 180, period: opts.period || 14,
      phase: opts.phase || 0, range: opts.range || 18, width: (opts.width || 12) * Math.PI / 180, crew: opts.crew || null });
    return this;
  }

  result() { return { grid: this.grid, things: this.things, zones: this.zones, spawns: this.spawns, ents: this.ents, decor: this.decor, lights: this.lights, searchlights: this.searchlights }; }
}

// Footprints and collision for prop kinds. Models live in render/models.js under the same names.
export const PROPS = {
  crate: { w: 1, h: 1, flags: F.BLOCK | F.LOW },
  crates: { w: 2, h: 1, flags: F.BLOCK | F.LOW },
  barrel: { w: 1, h: 1, flags: F.BLOCK | F.LOW },
  fuel: { w: 2, h: 2, flags: F.BLOCK | F.LOW, destructible: true, volatile: 3.2, label: 'fuel drums' },
  fueltank: { w: 3, h: 3, flags: F.BLOCK | F.SIGHT, destructible: true, volatile: 4, label: 'fuel tank' },
  ammo: { w: 2, h: 1, flags: F.BLOCK | F.LOW, destructible: true, volatile: 3, label: 'ammunition' },
  truck: { w: 2, h: 4, flags: F.BLOCK | F.SIGHT, destructible: true, volatile: 2.4, label: 'truck' },
  car: { w: 2, h: 3, flags: F.BLOCK | F.LOW, destructible: true, label: 'car' },
  wreck: { w: 2, h: 3, flags: F.BLOCK | F.LOW, label: 'wrecked car' },
  kubel: { w: 2, h: 3, flags: F.BLOCK | F.LOW, destructible: true, label: 'Kübelwagen' },
  motorcycle: { w: 1, h: 2, flags: F.BLOCK | F.LOW, destructible: true },
  tank: { w: 3, h: 4, flags: F.BLOCK | F.SIGHT, destructible: true, volatile: 2.5, label: 'tank' },
  halftrack: { w: 2, h: 4, flags: F.BLOCK | F.SIGHT, destructible: true, label: 'half-track' },
  gun: { w: 2, h: 2, flags: F.BLOCK | F.LOW, destructible: true, label: 'field gun' },
  coastgun: { w: 3, h: 3, flags: F.BLOCK | F.SIGHT, destructible: true, volatile: 2, label: 'coastal gun' },
  aagun: { w: 2, h: 2, flags: F.BLOCK | F.LOW, destructible: true, label: 'flak gun' },
  mgnest: { w: 2, h: 2, flags: F.BLOCK | F.LOW, label: 'machine-gun nest' },
  tent: { w: 3, h: 2, flags: F.BLOCK | F.SIGHT, label: 'tent' },
  tower: { w: 2, h: 2, flags: F.BLOCK, label: 'watchtower' },
  lamppost: { w: 1, h: 1, flags: F.BLOCK },
  campfire: { w: 1, h: 1, flags: F.BLOCK },
  searchlight: { w: 1, h: 1, flags: F.BLOCK | F.LOW, destructible: true },
  haystack: { w: 2, h: 2, flags: F.BLOCK | F.SIGHT },
  cart: { w: 1, h: 2, flags: F.BLOCK | F.LOW },
  well: { w: 1, h: 1, flags: F.BLOCK | F.LOW },
  rocks: { w: 2, h: 2, flags: F.BLOCK | F.SIGHT },
  rock: { w: 1, h: 1, flags: F.BLOCK | F.LOW },
  log: { w: 3, h: 1, flags: F.BLOCK | F.LOW },
  stump: { w: 1, h: 1, flags: F.BLOCK | F.LOW },
  plane: { w: 5, h: 4, flags: F.BLOCK | F.LOW, destructible: true, volatile: 2.2, label: 'aircraft' },
  bomber: { w: 7, h: 5, flags: F.BLOCK | F.LOW, destructible: true, volatile: 2.6, label: 'bomber' },
  boat: { w: 2, h: 4, flags: F.BLOCK | F.LOW, destructible: true, label: 'boat' },
  barge: { w: 3, h: 7, flags: F.BLOCK | F.LOW, destructible: true, label: 'invasion barge' },
  ship: { w: 6, h: 22, flags: F.BLOCK | F.SIGHT, destructible: true, label: 'ship' },
  warship: { w: 8, h: 34, flags: F.BLOCK | F.SIGHT, destructible: true, label: 'warship' },
  crane: { w: 3, h: 3, flags: F.BLOCK | F.SIGHT, destructible: true, label: 'crane' },
  radar: { w: 3, h: 3, flags: F.BLOCK | F.LOW, destructible: true, label: 'Würzburg radar' },
  radiomast: { w: 1, h: 1, flags: F.BLOCK, destructible: true, label: 'radio mast' },
  telegraph: { w: 1, h: 1, flags: F.BLOCK, label: 'telegraph pole' },
  pillbox: { w: 3, h: 3, flags: F.BLOCK | F.SIGHT, label: 'pillbox' },
  bunker: { w: 4, h: 3, flags: F.BLOCK | F.SIGHT, label: 'bunker' },
  rail: { w: 1, h: 1, flags: 0 },
  wagon: { w: 2, h: 5, flags: F.BLOCK | F.SIGHT, destructible: true, label: 'goods wagon' },
  locomotive: { w: 2, h: 6, flags: F.BLOCK | F.SIGHT, destructible: true, volatile: 2.5, label: 'locomotive' },
  watertower: { w: 2, h: 2, flags: F.BLOCK | F.SIGHT, destructible: true, label: 'water tower' },
  table: { w: 2, h: 1, flags: F.BLOCK | F.LOW },
  bench: { w: 2, h: 1, flags: F.BLOCK | F.LOW },
  sign: { w: 1, h: 1, flags: F.BLOCK },
  roadblock: { w: 3, h: 1, flags: F.BLOCK | F.LOW, label: 'roadblock' },
  horse: { w: 1, h: 2, flags: F.BLOCK | F.LOW },
  hedgehog: { w: 1, h: 1, flags: F.BLOCK | F.LOW, label: 'beach obstacle' },
  statue: { w: 2, h: 2, flags: F.BLOCK | F.SIGHT },
  fountain: { w: 3, h: 3, flags: F.BLOCK | F.LOW },
  pier: { w: 1, h: 1, flags: 0 },
  bollard: { w: 1, h: 1, flags: F.BLOCK | F.LOW },
  dummytank: { w: 3, h: 4, flags: F.BLOCK | F.LOW, destructible: true, label: 'dummy tank' },
  uboat: { w: 3, h: 18, flags: F.BLOCK | F.SIGHT, label: 'U-boat' },
  rubberboat: { w: 2, h: 3, flags: F.LOW, label: 'rubber boat' },
  woodpile: { w: 2, h: 1, flags: F.BLOCK | F.LOW },
  coal: { w: 3, h: 3, flags: F.BLOCK | F.SIGHT, label: 'coal heap' },
  railtrack: { w: 1, h: 4, flags: 0 },
  pylon: { w: 2, h: 2, flags: F.BLOCK, destructible: true, label: 'pylon' },
  bridge: { w: 3, h: 8, flags: 0, destructible: true, label: 'bridge' },
};

export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Tiles along a polyline (4-connected so walls have no diagonal gaps).
export function rasterPolyline(pts) {
  const out = [];
  const seen = new Set();
  const add = (x, y) => { const k = x + ',' + y; if (!seen.has(k)) { seen.add(k); out.push([x, y]); } };
  for (let i = 0; i < pts.length - 1; i++) {
    let [x0, y0] = pts[i].map(Math.floor);
    const [x1, y1] = pts[i + 1].map(Math.floor);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    add(x0, y0);
    while (x0 !== x1 || y0 !== y1) {
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; add(x0, y0); }
      else if (e2 <= dx) { err += dx; y0 += sy; add(x0, y0); }
    }
  }
  return out;
}

export function buildMission(def, heroData, difficulty) {
  const M = new MapBuilder(def, heroData, difficulty);
  def.build(M, T, F);
  return M;
}
