import { TICK, F, DIFFICULTY, SPEED, ENEMY_TYPES, FACTIONS } from './constants.js';
import { Rng } from './rng.js';
import { CAP, ROPE } from './grid.js';
import { findPath, walkLine, nearestWalkable, pathLength } from './path.js';
import { hasClearance } from './clearance.js';
import { hasLOS } from './los.js';
import { ABILITIES, heroAbilities } from './abilities.js';
import { updateEnemy, perceive, onNoise, becomeAlert } from './ai.js';
import { leaveTracks, pruneTracks, updateSearchlights } from './env.js';
import { MissionRuntime } from './mission.js';

// The World owns all simulation state for one mission.
//
// Static data (grid, things, zones, the mission's script functions) is rebuilt from the
// mission definition on every load. Everything that changes during play lives in `this.s`,
// a plain JSON-safe object, so a save is just JSON.stringify(world.s).
export class World {
  constructor(def, built, difficulty = 'normal', saved = null) {
    this.def = def;
    this.grid = built.grid;
    this.things = built.things;          // static objects: buildings, props, targets, doors
    this.thingById = new Map(this.things.map((t) => [t.id, t]));
    this.zones = built.zones;            // named rectangles/polygons for triggers
    this.spawns = built.spawns;          // reinforcement spawn points
    this.searchlights = built.searchlights || [];   // sweeping beams (see env.js)
    this.diff = DIFFICULTY[difficulty];
    this.difficulty = difficulty;
    this.events = [];                    // transient per-frame events for renderer/audio/UI
    this.listeners = new Set();
    if (saved) {
      this.s = saved;
    } else {
      this.s = {
        v: 1, mission: def.id, difficulty, t: 0, tick: 0,
        rng: { s: (def.seed || 1) * 7919 },
        ents: {}, nextId: 1,
        objs: {},               // dynamic state of things: { destroyed, open, cut, rope, charges... }
        proj: [],               // projectiles in flight (stones, grenades)
        alarm: { on: false, t: 0, count: 0, last: null, pending: null },
        objectives: [], flags: {}, fired: {}, timers: [],
        stats: { kills: 0, kos: 0, alarms: 0, shots: 0, seen: 0, saves: 0, heroDowns: 0, civiliansHurt: 0 },
        result: null,           // 'won' | 'lost'
        failReason: null,
        log: [],
      };
      for (const e of built.ents) this.addEnt(e);
      for (const t of this.things) if (t.state) this.s.objs[t.id] = structuredClone(t.state);
    }
    this.rng = new Rng(this.s.rng);
    this.mission = new MissionRuntime(this, def);
    if (!saved) this.mission.start();
    this.rebuildFlags();
    // First Light's original southern patrol spawned in a tree. Migrate that exact
    // legacy spawn/waypoint too; otherwise a pre-fix arrival autosave recreates it.
    if (saved && def.id === 'm01' && this.grid.preciseMovement) {
      const e = this.byTag('southpatrol')[0], p = e?.ai?.route?.[0];
      if (p?.x === 30.5 && p.y === 44.5) {
        p.y = 43.5;
        if (e.state === 'ok' && Math.floor(e.x) === 30 && Math.floor(e.y) === 44) {
          e.x = 30.5; e.y = 43.5; e.path = null; e.pi = 0;
        }
      }
    }
    // Older First Light saves can contain a route made by the corner-cutting
    // smoother. Keep position/progress, but rebuild an unsafe pending hero route.
    if (saved && this.grid.preciseMovement) for (const h of this.heroes()) {
      if (!h.path?.length || h.inVehicle) continue;
      let from = [h.x,h.y], unsafe = false;
      for (const to of h.path.slice(h.pi)) {
        if (!hasClearance(this.grid,...from,...to,this.caps(h))) { unsafe = true; break; }
        from = to;
      }
      if (unsafe) this.routeTo(h,...h.path.at(-1));
    }
  }

  // ---------- entities ----------
  addEnt(e) {
    const id = e.id || ('e' + this.s.nextId++);
    e.id = id;
    this.s.ents[id] = e;
    this.emit({ type: 'spawn', id });
    return e;
  }
  removeEnt(id) { delete this.s.ents[id]; this.emit({ type: 'despawn', id }); }
  ent(id) { return id ? this.s.ents[id] : null; }
  get ents() { return Object.values(this.s.ents); }
  heroes() { return this.ents.filter((e) => e.kind === 'hero'); }
  enemies() { return this.ents.filter((e) => e.kind === 'enemy'); }
  liveEnemies() { return this.ents.filter((e) => e.kind === 'enemy' && e.state === 'ok'); }
  byTag(tag) { return this.ents.filter((e) => e.tag === tag); }

  emit(ev) { this.events.push(ev); for (const fn of this.listeners) fn(ev); }
  say(id, text, dur = 2.5) { this.emit({ type: 'say', id, text, dur }); }
  message(text, kind = 'info') { this.s.log.push({ t: this.s.t, text, kind }); this.emit({ type: 'message', text, kind }); }

  // ---------- grid state ----------
  // Re-derive dynamic tile flags from the static base plus current object state.
  rebuildFlags() {
    const g = this.grid;
    g.resetFlags();
    this.emit({ type: 'flags' });           // the renderer re-syncs gates, wire and lamps
    for (const t of this.things) {
      const st = this.s.objs[t.id];
      if (!st) continue;
      if (t.type === 'fence' && st.cut) for (const [x, y] of t.tiles) { g.clearFlag(x, y, F.BLOCK | F.FENCE); }
      if (t.type === 'gate' && st.open) for (const [x, y] of t.tiles) { g.clearFlag(x, y, F.BLOCK | F.SIGHT); }
      if (t.type === 'cliff' && st.rope) for (const [x, y] of t.tiles) { g.addFlag(x, y, ROPE); }
      if (t.blocksWhenIntact && st.destroyed) for (const [x, y] of t.tiles) { g.clearFlag(x, y, F.SIGHT); }
      // Blown wire, gates and walls leave a gap anyone can walk through.
      if (st.destroyed && (t.type === 'fence' || t.type === 'gate' || t.type === 'barrier')) for (const [x, y] of t.tiles) g.clearFlag(x, y, F.BLOCK | F.SIGHT | F.FENCE | F.LOW);
      if (st.lightOff && t.light) for (const [x, y] of t.litTiles || []) { g.clearFlag(x, y, F.LIT); g.addFlag(x, y, F.DARK); }
      // A model hidden by script with `passable: true` stops blocking too (api.thingVisual).
      if (st.visual && st.visual.hidden && st.visual.passable) for (const [x, y] of t.tiles) g.clearFlag(x, y, F.BLOCK | F.SIGHT | F.LOW);
      // A blown bridge drops into the gap: what was its deck is water again.
      if (t.kind === 'bridge' && st.destroyed) for (const [x, y] of t.tiles) g.addFlag(x, y, F.DEEP | F.WATER);
    }
    // Smoke and gas hang like a wall for the eye.
    for (const h of this.s.hazards || []) {
      if (!h.blocks) continue;
      for (let y = Math.floor(h.y - h.r); y <= Math.ceil(h.y + h.r); y++) for (let x = Math.floor(h.x - h.r); x <= Math.ceil(h.x + h.r); x++) {
        if (Math.hypot(x + 0.5 - h.x, y + 0.5 - h.y) <= h.r * 0.8) g.addFlag(x, y, F.SIGHT);
      }
    }
  }
  thingState(id) { return this.s.objs[id] || (this.s.objs[id] = {}); }

  // Weather and time of day can change mid-mission (api.weather, api.timeOfDay); the current ones
  // live in the save.
  get weather() { return this.s.weather || this.def.weather; }
  setWeather(kind) { this.s.weather = kind; this.emit({ type: 'weather', weather: kind }); }
  get time() { return this.s.tod || this.def.time; }
  // `seconds` > 0 blends: vision and lighting move from the old light to the new over that time.
  setTimeOfDay(tod, seconds = 0) {
    const from = this.time;
    this.s.tod = tod;
    this.s.todBlend = seconds > 0 && from !== tod ? { from, to: tod, t0: this.s.t, dur: seconds } : null;
    this.emit({ type: 'tod', time: tod, from, dur: seconds || 0 });
  }

  // ---------- noise ----------
  noise(x, y, r, kind = 'noise', src = null) {
    // Rain, storm and blizzard swallow sound (missions can opt out with noiseMuffle: false).
    if (this.def.noiseMuffle !== false) { const m = MUFFLE[this.weather]; if (m && kind !== 'explosion') r *= m; }
    this.emit({ type: 'noise', x, y, r, kind });
    this.mission.hook('onNoise', x, y, kind, r, src);
    for (const e of this.ents) {
      if (e.kind !== 'enemy' || e.state !== 'ok' || e.id === src) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      // Walls muffle sound: halve the radius when the listener has no line of sight to the source.
      const reach = hasLOS(this.grid, e.x, e.y, x, y) ? r : r * 0.55;
      if (d <= reach) onNoise(this, e, x, y, kind, src);
    }
  }

  // ---------- alarm ----------
  // An enemy who has seen or heard something serious becomes a "raiser": unless every raiser is
  // silenced before the countdown ends, the alarm sounds.
  queueAlarm(raiserId, delay, x, y) {
    const a = this.s.alarm;
    if (a.on) { a.t = Math.max(a.t, this.diff.alarmTime * 0.5); a.last = { x, y }; return; }
    if (!a.pending) { a.pending = { t: delay, raisers: [] }; this.emit({ type: 'alarm-pending' }); }
    a.pending.t = Math.min(a.pending.t, delay);
    if (!a.pending.raisers.includes(raiserId)) a.pending.raisers.push(raiserId);
    a.last = { x, y };
  }
  raiseAlarm(x, y) {
    const a = this.s.alarm;
    a.pending = null;
    if (x !== undefined) a.last = { x, y };
    if (a.on) { a.t = this.diff.alarmTime; return; }
    a.on = true; a.t = this.diff.alarmTime; a.count++;
    this.s.stats.alarms++;
    // Very lights: a garrison that has them (`veryLights: true`) puts a flare up over the trouble.
    if (this.def.veryLights && a.last && ['night', 'dusk'].includes(this.time)) this.addFlare(a.last.x + this.rng.range(-3, 3), a.last.y + this.rng.range(-3, 3), { r: 9, dur: 24 });
    this.emit({ type: 'alarm', on: true });
    this.message('ALARM! The garrison is roused.', 'alarm');
    this.mission.hook('onAlarm');
    if (!this.def.noReinforcements) this.spawnReinforcements();
    for (const e of this.liveEnemies()) {
      if (e.ai.mode === 'post' || e.ai.mode === 'patrol' || e.ai.mode === 'return') {
        if (!e.ai.holdPost && a.last && Math.hypot(e.x - a.last.x, e.y - a.last.y) < 18) {
          e.ai.mode = 'search'; e.ai.goal = { x: a.last.x + this.rng.range(-3, 3), y: a.last.y + this.rng.range(-3, 3) }; e.ai.path = null; e.ai.searchT = 10;
        }
      }
    }
  }
  spawnReinforcements() {
    if (!this.spawns.length) return;
    const n = this.diff.reinforcements;
    for (let i = 0; i < n; i++) {
      const sp = this.spawns[i % this.spawns.length];
      const e = makeEnemy({ ...sp.template, x: sp.x + (i % 3) * 0.6, y: sp.y + Math.floor(i / 3) * 0.6, a: sp.a || 0 }, this.diff);
      e.reinf = { x: sp.x, y: sp.y };
      e.ai.mode = 'search';
      const L = this.s.alarm.last || { x: sp.x, y: sp.y };
      e.ai.goal = { x: L.x + this.rng.range(-4, 4), y: L.y + this.rng.range(-4, 4) };
      e.ai.searchT = this.diff.alarmTime;
      this.addEnt(e);
    }
  }
  updateAlarm(dt) {
    const a = this.s.alarm;
    if (a.pending) {
      a.pending.raisers = a.pending.raisers.filter((id) => { const e = this.ent(id); return e && e.state === 'ok' && e.kind === 'enemy'; });
      if (!a.pending.raisers.length) { a.pending = null; this.emit({ type: 'alarm-cancel' }); }
      else if ((a.pending.t -= dt) <= 0) this.raiseAlarm();
    }
    if (a.on) {
      const anyAlert = this.liveEnemies().some((e) => e.ai.mode === 'alert');
      if (!anyAlert) a.t -= dt;
      if (a.t <= 0) {
        a.on = false; a.t = 0;
        this.emit({ type: 'alarm', on: false });
        this.message('The alarm dies away. The guards are still on edge.', 'info');
        for (const e of this.liveEnemies()) {
          e.ai.edge = Math.min(2, (e.ai.edge || 0) + 0.35); // permanently a little sharper
          if (e.reinf) { e.ai.mode = 'leave'; e.ai.path = null; }
        }
      }
    }
  }

  // ---------- combat helpers ----------
  damageHero(h, src) {
    if (h.state !== 'ok') return;
    h.hp -= 1;
    this.emit({ type: 'hit', id: h.id });
    if (h.hp <= 0) {
      h.hp = 0;
      this.s.stats.heroDowns++;
      if (this.diff.bleedOut > 0 && h.kind === 'hero') {
        h.state = 'down'; h.downT = this.diff.bleedOut; h.stance = 'prone'; this.stopUnit(h);
        this.message(`${h.name} is down! Reach them within ${this.diff.bleedOut} seconds.`, 'danger');
        this.emit({ type: 'down', id: h.id });
      } else {
        this.killHero(h);
      }
    }
  }
  killHero(h) {
    h.state = 'dead'; h.hp = 0; this.stopUnit(h);
    this.emit({ type: 'death', id: h.id });
    if (h.kind === 'hero') this.fail(`${h.name} has been killed.`);
    else this.mission.hook('onNpcDeath', h);
  }
  kill(e, by, how = 'knife') {
    if (e.state === 'dead') return;
    const wasKo = e.state === 'ko';
    e.state = 'dead'; e.hp = 0; e.koT = 0;
    if (e.ai) { e.ai.mode = 'dead'; e.ai.path = null; }
    if (!wasKo) this.s.stats.kills++;
    if (e.faction === 'neutral' || e.faction === 'civilian' || e.civilian) {
      this.s.stats.civiliansHurt++;
      if (this.def.noLethal || e.faction === 'civilian') this.fail('You have killed someone who was not a combatant.');
    } else if (this.def.noLethal) {
      this.fail('No lethal force. This is a neutral country.');
    }
    this.emit({ type: 'kill', id: e.id, how, by: by && by.id });
    this.mission.hook('onKill', e, by, how);
  }
  knockout(e, by, how = 'punch', dur = 45) {
    if (e.state !== 'ok') return;
    e.state = 'ko'; e.koT = dur;
    if (e.ai) { e.ai.mode = 'ko'; e.ai.path = null; }
    this.s.stats.kos++;
    this.emit({ type: 'ko', id: e.id, how, by: by && by.id });
    this.mission.hook('onKo', e, by, how);
  }

  // Whatever a man carried (enemy def `item: 'id'` or `{ id, label }`) goes to the first hero who
  // handles his body: ties, carries, strips, searches or captures him.
  searchBody(e, h) {
    const it = e && e.item;
    if (!it || !h || h.kind !== 'hero') return;
    const id = typeof it === 'string' ? it : it.id;
    if (this.s.flags['item:' + id]) return;
    this.s.flags['item:' + id] = h.hid;
    e.item = null;
    this.emit({ type: 'item', thing: id, by: h.id, name: it.label || id });
    this.message(`${h.name} finds ${it.label || 'something'} on ${e.name || 'the body'}.`, 'good');
    this.mission.hook('onInteract', h, { id, type: 'body-item', label: it.label, body: e.id });
    this.mission.checkObjectives();
  }

  // A knocked-out enemy taken prisoner: the same entity becomes an NPC who follows his captor
  // (tag and id are kept, so scripts still find him; `captive` marks him; a 'kill' objective
  // on his tag counts him as dealt with).
  capture(e, by) {
    if (e.kind !== 'enemy' || e.state !== 'ko') return false;
    const lead = by && by.kind === 'hero' ? by : null;
    e.kind = 'npc'; e.captive = true; e.role = 'captive'; e.look = 'captive';
    e.state = 'ok'; e.koT = 0; e.tied = false; e.hidden = null; e.discovered = false; e.carriedBy = null;
    e.hp = Math.max(1, e.hp || 1); e.maxHp = e.maxHp || 2; e.stance = 'stand'; e.path = null; e.pi = 0;
    e.ai = null; e.slow = false; e.locked = false;
    e.follow = lead ? lead.id : null;
    e.slot = lead ? this.ents.filter((n) => n.kind === 'npc' && n.follow === lead.id).length : 1;
    this.emit({ type: 'captured', id: e.id, by: lead && lead.id });
    this.message(`${e.name || 'The guard'} is taken prisoner.`, 'good');
    this.mission.hook('onCapture', e, lead);
    return true;
  }

  fail(reason) {
    if (this.s.result) return;
    this.s.result = 'lost'; this.s.failReason = reason;
    this.emit({ type: 'result', result: 'lost', reason });
  }
  win() {
    if (this.s.result) return;
    this.s.result = 'won';
    this.emit({ type: 'result', result: 'won' });
  }

  // ---------- orders ----------
  caps(u) {
    if (u.kind === 'vehicle') return u.boat ? CAP.BOAT : CAP.VEHICLE;
    let c = 0;
    if (u.kind === 'hero' && heroAbilities(u).includes('swim')) c |= CAP.SWIM;
    if (u.kind === 'hero' && heroAbilities(u).includes('climb')) c |= CAP.CLIMB;
    if (u.kind === 'enemy') c |= u.boat ? CAP.BOAT : CAP.ENEMY;     // a patrol boat stays on the water
    if (u.kind === 'npc' && u.swim) c |= CAP.SWIM;          // NPCs who can swim (def swim: true)
    return c;
  }
  stopUnit(u) { u.path = null; u.pi = 0; u.order = null; u.moving = false; u.act = null; }

  // Plan a path for unit u to (x, y). Returns true when a route exists.
  routeTo(u, x, y) {
    if (u.rail) { u.path = railPath(u.rail, u, x, y); u.pi = 0; u.moving = true; return true; }
    // A guard who cannot reach a spot would otherwise search the whole map for it every tick:
    // remember the failure (saved, so replays stay identical) and don't retry that tile for 1.5 s.
    const gx = Math.floor(x), gy = Math.floor(y), pf = u.pathFail;
    if (u.kind !== 'hero' && pf && pf.x === gx && pf.y === gy && this.s.t < pf.until) { u.path = null; return false; }
    const p = findPath(this.grid, u.x, u.y, x, y, this.caps(u));
    if (!p) { u.path = null; if (u.kind !== 'hero') u.pathFail = { x: gx, y: gy, until: this.s.t + 1.5 }; return false; }
    if (u.pathFail) u.pathFail = null;
    u.path = p; u.pi = 0; u.moving = true;
    return true;
  }

  orderMove(h, x, y, run = false) {
    if (h.state !== 'ok' || this.s.result) return false;
    if (h.inVehicle) return this.orderVehicleMove(h, x, y);
    if (h.carrying && run) run = false;
    if (h.hidden && h.hidden.startsWith('b:')) this.exitBuilding(h, { x, y });
    h.act = null;
    const ok = this.routeTo(h, x, y);
    h.order = ok ? { type: 'move', x, y } : null;
    h.run = run && h.stance === 'stand';
    if (!ok) this.emit({ type: 'cant', id: h.id, x, y });
    return ok;
  }

  // Order a hero to use an ability on a target; they walk into range first.
  orderAbility(h, abId, target, sync = null) {
    const ab = ABILITIES[abId];
    if (!ab || h.state !== 'ok' || this.s.result) return false;
    if (!heroAbilities(h).includes(abId) && !ANYONE.has(abId)) return false;
    if (h.inVehicle && !FROM_VEHICLE.has(abId)) { this.emit({ type: 'deny', id: h.id, text: 'Get out first' }); return false; }
    const why = ab.check ? ab.check(this, h, target) : null;
    if (why) { this.emit({ type: 'deny', id: h.id, text: why }); return false; }
    if (ab.target === 'none') { ab.use(this, h, target); return true; }
    if (h.hidden && h.hidden.startsWith('b:')) this.exitBuilding(h, targetPos(this, target));
    h.order = { type: 'ability', ab: abId, target, repath: 0, sync: sync || undefined };
    h.act = null;
    return true;
  }

  // Walk up to an NPC and take him along (a straggler, a prisoner): he follows once spoken to.
  orderRecruit(h, npcId) {
    const n = this.ent(npcId);
    if (!n || n.kind !== 'npc' || n.state !== 'ok' || n.locked || h.state !== 'ok' || this.s.result) return false;
    if (h.inVehicle) { this.emit({ type: 'deny', id: h.id, text: 'Get out first' }); return false; }
    if (h.hidden && h.hidden.startsWith('b:')) this.exitBuilding(h, n);
    h.order = { type: 'recruit', npc: npcId, repath: 0 };
    h.act = null;
    return true;
  }
  pursueRecruit(h, o, dt) {
    const n = this.ent(o.npc);
    if (!n || n.state !== 'ok') { h.order = null; return; }
    if (Math.hypot(n.x - h.x, n.y - h.y) <= 1.8) {
      h.order = null; h.path = null; h.moving = false;
      n.follow = h.id; n.task = null; n.slot = this.ents.filter((e) => e.kind === 'npc' && e.follow === h.id).length;
      this.emit({ type: 'recruited', id: n.id, by: h.id });
      return;
    }
    o.repath -= dt;
    if (!h.path || o.repath <= 0) { o.repath = 0.6; if (!this.routeTo(h, n.x, n.y)) { this.emit({ type: 'cant', id: h.id }); h.order = null; return; } }
    this.advance(h, this.heroSpeed(h), dt);
  }

  orderInteract(h, thingId) {
    if (h.state !== 'ok' || this.s.result) return false;
    if (h.inVehicle) { this.emit({ type: 'deny', id: h.id, text: 'Get out first' }); return false; }
    const t = this.thingById.get(thingId);
    if (!t || !t.interact) return false;
    const why = this.mission.interactBlocked(h, t);
    if (why) { this.emit({ type: 'deny', id: h.id, text: why }); return false; }
    // A job for the specialist he is escorting: the NPC goes and does it; the hero stays on guard.
    const helper = t.interact.npc && !t.interact.heroToo ? this.mission.helperFor(h, t) : null;
    if (helper) {
      helper.task = { thing: thingId, repath: 0 }; helper.path = null; helper.act = null;
      this.emit({ type: 'task', id: helper.id, thing: thingId, by: h.id });
      this.message(`${helper.name} goes to work on ${t.label || 'it'}.`);
      return true;
    }
    if (h.hidden && h.hidden.startsWith('b:')) this.exitBuilding(h, thingCenter(t));
    h.order = { type: 'interact', thing: thingId, repath: 0 };
    h.act = null;
    return true;
  }

  // Heroes slip into buildings with doors; the people they lead go in with them (those close
  // behind at once, stragglers when they reach the door) and come out with them.
  enterBuilding(h, t) {
    h.hidden = 'b:' + t.id; this.stopUnit(h);
    const st = this.thingState(t.id); st.inside = st.inside || [];
    if (!st.inside.includes(h.id)) st.inside.push(h.id);
    if (h.carrying) {
      const b = this.ent(h.carrying);
      if (b) { b.carriedBy = null; b.hidden = 'b:' + t.id; b.x = h.x; b.y = h.y; st.inside.push(b.id); }
      h.carrying = null;
    }
    this.emit({ type: 'enter', id: h.id, thing: t.id });
    this.mission.hook('onEnterBuilding', h, t);
    if (h.kind === 'hero') for (const n of this.ents) if (n.kind === 'npc' && n.follow === h.id && n.state === 'ok' && !n.inVehicle && !n.hidden && Math.hypot(n.x - h.x, n.y - h.y) < 6) this.enterBuilding(n, t);
  }
  exitBuilding(h, toward = null) {
    const tid = h.hidden.slice(2);
    const t = this.thingById.get(tid);
    const st = this.thingState(tid);
    st.inside = (st.inside || []).filter((id) => id !== h.id);
    h.hidden = null;
    // Out by the door nearer where he is headed (buildings with a second door).
    let door = t && t.door;
    if (t && t.doors && toward) door = t.doors.reduce((a, b) => (Math.hypot(b[0] + 0.5 - toward.x, b[1] + 0.5 - toward.y) < Math.hypot(a[0] + 0.5 - toward.x, a[1] + 0.5 - toward.y) ? b : a));
    if (door) { h.x = door[0] + 0.5; h.y = door[1] + 0.5; }
    h.path = null; h.moving = false;
    this.emit({ type: 'exit', id: h.id, thing: tid });
    this.mission.hook('onExitBuilding', h, t);
    if (h.kind === 'hero') for (const n of this.ents) if (n.kind === 'npc' && n.follow === h.id && n.hidden === 'b:' + tid) this.exitBuilding(n, { x: h.x, y: h.y });
  }

  // ---------- vehicles ----------
  canDrive(h, v) {
    if (v.anyDriver || v.vtype === 'canoe' || v.vtype === 'rubberboat') return true;
    const abs = heroAbilities(h);
    return v.boat ? (abs.includes('boat') || abs.includes('drive')) : abs.includes('drive');
  }
  orderBoard(h, vid) {
    const v = this.ent(vid);
    if (!v || v.state !== 'ok' || h.state !== 'ok' || this.s.result) return false;
    if (!v.seats) return false;                       // a parked car the mission keeps for itself
    if (v.passengers.length >= v.seats) { this.emit({ type: 'deny', id: h.id, text: 'No room aboard' }); return false; }
    if (h.inVehicle) return false;
    if (h.hidden && h.hidden.startsWith('b:')) this.exitBuilding(h);
    h.order = { type: 'board', veh: vid, repath: 0 };
    h.act = null;
    return true;
  }
  pursueBoard(h, o, dt) {
    const v = this.ent(o.veh);
    if (!v || v.state !== 'ok') { h.order = null; return; }
    // Board from beside it, or from the nearest ground this hero can reach (a boat moored off a
    // bank can be a few tiles out): the same spot disembarking would put him on.
    const n = nearestWalkable(this.grid, Math.floor(v.x), Math.floor(v.y), this.caps(h) & ~CAP.SWIM, 4) || nearestWalkable(this.grid, Math.floor(v.x), Math.floor(v.y), this.caps(h), 4);
    const reach = n ? Math.max(1.9, Math.hypot(n[0] + 0.5 - v.x, n[1] + 0.5 - v.y) + 0.8) : 1.9;
    if (Math.hypot(v.x - h.x, v.y - h.y) <= reach) { h.order = null; h.path = null; this.board(h, v); return; }
    o.repath -= dt;
    if (!h.path || o.repath <= 0) {
      o.repath = 0.7;
      if (!n || !this.routeTo(h, n[0] + 0.5, n[1] + 0.5)) { this.emit({ type: 'cant', id: h.id }); h.order = null; return; }
    }
    this.advance(h, this.heroSpeed(h), dt);
  }
  board(u, v) {
    if (v.passengers.length >= v.seats) return false;
    u.inVehicle = v.id; u.hidden = 'v:' + v.id; u.stance = 'stand';
    this.stopUnit(u);
    v.passengers.push(u.id);
    if (u.kind === 'hero' && !v.driver && this.canDrive(u, v)) v.driver = u.id;
    if (u.kind === 'hero') {
      // Escorted people climb in after their leader.
      for (const n of this.ents) if (n.kind === 'npc' && n.follow === u.id && n.state === 'ok' && !n.inVehicle && Math.hypot(n.x - v.x, n.y - v.y) < 6) this.board(n, v);
      this.emit({ type: 'board', id: u.id, veh: v.id });
    }
    return true;
  }
  disembark(u) {
    const v = this.ent(u.inVehicle);
    u.inVehicle = null; u.hidden = null;
    if (!v) return;
    v.passengers = v.passengers.filter((id) => id !== u.id);
    // Step off onto the nearest ground this person can stand on (the tile boarding comes back to).
    const caps = this.caps(u);
    const spot = nearestWalkable(this.grid, Math.floor(v.x), Math.floor(v.y), caps & ~CAP.SWIM, 4) || nearestWalkable(this.grid, Math.floor(v.x), Math.floor(v.y), caps, 4);
    if (spot) { u.x = spot[0] + 0.5; u.y = spot[1] + 0.5; }
    if (v.driver === u.id) {
      v.driver = null; v.path = null; v.moving = false;
      const next = v.passengers.map((id) => this.ent(id)).find((p) => p && p.kind === 'hero' && this.canDrive(p, v));
      if (next) v.driver = next.id;
    }
    if (u.kind === 'hero') {
      for (const id of [...v.passengers]) { const n = this.ent(id); if (n && n.kind === 'npc' && n.follow === u.id) this.disembark(n); }
      this.emit({ type: 'disembark', id: u.id, veh: v.id });
    }
  }
  orderVehicleMove(h, x, y) {
    const v = this.ent(h.inVehicle);
    if (!v || v.state !== 'ok') return false;
    if (v.driver !== h.id) { this.emit({ type: 'deny', id: h.id, text: v.boat ? 'Someone else has the paddle' : 'Only the driver can steer' }); return false; }
    const ok = this.routeTo(v, x, y);
    if (!ok) this.emit({ type: 'cant', id: h.id, x, y });
    return ok;
  }
  updateVehicle(v, dt) {
    if (v.state !== 'ok') return;
    if (v.path) {
      this.advance(v, v.speed * (v.rail || v.boat || this.grid.has(Math.floor(v.x), Math.floor(v.y), F.ROAD) ? 1 : 0.65), dt);
      if (v.motor) { v.noiseT = (v.noiseT || 0) + dt; if (v.noiseT > 0.5) { v.noiseT = 0; this.noise(v.x, v.y, v.motor, 'engine', v.id); } }
    }
    for (const id of v.passengers) {
      const p = this.ent(id);
      if (!p) continue;
      p.x = v.x; p.y = v.y; p.a = v.a;
      if (p.carrying) { const b = this.ent(p.carrying); if (b) { b.x = v.x; b.y = v.y; } }   // a body taken aboard rides along
    }
  }
  damageVehicle(v, n = 1, src = null) {
    if (v.state !== 'ok') return;
    v.hp -= n;
    // Bullets find the crew: a hit the vehicle's armour does not stop wounds someone aboard.
    const crew = v.passengers.map((id) => this.ent(id)).filter((p) => p && p.state === 'ok');
    if (crew.length && n <= 1 && !(v.armour > 0 && this.rng.next() < v.armour)) { const p = crew[Math.floor(this.rng.next() * crew.length)]; if (p.kind === 'hero') this.damageHero(p, src); else { p.hp -= 1; if (p.hp <= 0) this.killHero(p); } }
    if (v.hp <= 0) {
      v.state = 'destroyed'; v.path = null;
      for (const p of crew) { this.disembark(p); if (p.kind === 'hero') { this.damageHero(p); } }
      this.emit({ type: 'vehicle-destroyed', id: v.id });
    }
  }

  // ---------- main tick ----------
  step() {
    if (this.s.result) { this.s.t += TICK; return; }
    const dt = TICK;
    this.s.t += dt; this.s.tick++;
    // Lights people carry (a patrol's lantern, a train's headlamp) light the ground around them.
    this.lanterns = null;
    for (const e of this.ents) if (e.lantern && e.state === 'ok' && !(e.hidden && e.hidden.startsWith('b:'))) (this.lanterns || (this.lanterns = [])).push(e);
    for (const e of this.ents) {
      if (e.kind === 'hero') this.updateHero(e, dt);
      else if (e.kind === 'npc') this.updateNpc(e, dt);
      else if (e.kind === 'enemy') updateEnemy(this, e, dt);
      else if (e.kind === 'vehicle') this.updateVehicle(e, dt);
    }
    // Perception every other tick keeps the cost flat on large maps; suspicion rates are scaled to match.
    if (this.s.tick % 2 === 0) for (const e of this.ents) if (e.kind === 'enemy' && e.state === 'ok') perceive(this, e, dt * 2);
    this.resolveSync();
    updateSearchlights(this, dt, becomeAlert);
    if (this.s.tick % 30 === 0) pruneTracks(this);
    if (this.s.flares && this.s.flares.length && this.s.tick % 15 === 0) this.s.flares = this.s.flares.filter((f) => this.s.t - f.t0 < f.dur);
    if (this.s.todBlend && this.s.t - this.s.todBlend.t0 >= this.s.todBlend.dur) this.s.todBlend = null;
    this.updateProjectiles(dt);
    this.updateCharges(dt);
    this.updateHazards(dt);
    this.updatePlanes(dt);
    this.updateAlarm(dt);
    this.mission.update(dt);
  }

  // Synchronised strikes: when every hero of a group is at his moment of impact (or has dropped
  // out), all of them land on this tick. A group never waits more than 3 s.
  resolveSync() {
    const groups = new Map();
    for (const h of this.ents) {
      if (h.kind !== 'hero' || h.state !== 'ok') continue;
      const id = (h.act && h.act.sync) || (h.order && h.order.sync);
      if (!id) continue;
      const g = groups.get(id) || { ready: [], waiting: 0 };
      if (h.act && h.act.sync === id && h.act.ready) g.ready.push(h); else g.waiting++;
      groups.set(id, g);
    }
    for (const [id, g] of groups) {
      if (!g.ready.length) continue;
      const since = this.s.syncT && this.s.syncT[id];
      if (g.waiting && !(since !== undefined && this.s.t - since > 3)) { (this.s.syncT || (this.s.syncT = {}))[id] ??= this.s.t; continue; }
      if (this.s.syncT) delete this.s.syncT[id];
      for (const h of g.ready) {
        const a = h.act, ab = ABILITIES[a.ab];
        a.done = true; a.ready = false; a.sync = null;
        const tp = targetPos(this, a.target, h);
        const why = ab.check ? ab.check(this, h, a.target) : null;
        const handled = tp && tp.e && tp.e.kind === 'enemy' && tp.e.state !== 'ok' ? tp.e : null;
        if (!why && tp && targetDist(h, tp) <= ab.range + 0.6) { ab.use(this, h, a.target); if (handled) this.searchBody(handled, h); }
        else this.emit({ type: 'deny', id: h.id, text: why || 'Out of reach' });
      }
    }
  }

  // Move a unit along its path at the given speed; returns true on arrival.
  advance(u, speed, dt) {
    if (!u.path || u.pi >= u.path.length) { u.moving = false; return true; }
    let budget = speed * dt;
    const full = budget;
    while (budget > 0 && u.pi < u.path.length) {
      const [tx, ty] = u.path[u.pi];
      const dx = tx - u.x, dy = ty - u.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-4) { u.pi++; continue; }
      u.a = turnToward(u.a, Math.atan2(dy, dx), 14 * dt);
      if (d <= budget) { u.x = tx; u.y = ty; budget -= d; u.pi++; }
      else { u.x += dx / d * budget; u.y += dy / d * budget; budget = 0; }
    }
    if (u.kind === 'hero' || u.kind === 'npc') leaveTracks(this, u, full - budget);
    if (u.pi >= u.path.length) { u.path = null; u.moving = false; return true; }
    u.moving = true;
    return false;
  }

  heroSpeed(h) {
    const tf = this.grid.get(Math.floor(h.x), Math.floor(h.y));
    if (tf & F.DEEP) return SPEED.swim;
    // A hero without the strength to carry a man drags him, slowly.
    let v = h.carrying ? SPEED.carry * (heroAbilities(h).includes('carry') ? 1 : 0.55) : h.stance === 'prone' ? SPEED.prone : h.run ? SPEED.run : SPEED.walk;
    // On skis, snow is the fast ground: a skier glides at ski pace (a sprint is a little quicker).
    if ((tf & F.SNOW) && h.skis && h.stance !== 'prone' && !h.carrying) v = h.run ? Math.max(SPEED.run, SPEED.ski * 1.15) : SPEED.ski;
    if (tf & F.WATER) v *= 0.6;
    if ((tf & F.SNOW) && !h.skis) v *= 0.85;
    if (tf & F.CLIMB) v *= 0.45;
    return v;
  }

  updateHero(h, dt) {
    if (h.state === 'down') {
      if ((h.downT -= dt) <= 0) this.killHero(h);
      return;
    }
    if (h.state !== 'ok') return;
    if (h.hidden && h.hidden.startsWith('b:')) return;
    for (const k in h.cd) if (h.cd[k] > 0) h.cd[k] = Math.max(0, h.cd[k] - dt);
    if (h.inVehicle) {
      // Aboard: no walking, but the crew can still shoot, throw and watch.
      if (h.act) this.updateAction(h, dt);
      else if (h.order && h.order.type === 'ability') {
        const ab = ABILITIES[h.order.ab], tp = targetPos(this, h.order.target, h);
        if (tp && targetDist(h, tp) <= ab.range && (!ab.needsLos || hasLOS(this.grid, h.x, h.y, tp.x, tp.y, tp.prone))) {
          h.a = Math.atan2(tp.y - h.y, tp.x - h.x);
          if (ab.dur) h.act = { ab: h.order.ab, t: 0, dur: ab.dur, target: h.order.target, done: false }; else ab.use(this, h, h.order.target);
        } else this.emit({ type: 'deny', id: h.id, text: 'Out of range' });
        h.order = null;
      }
      return;
    }
    const tf = this.grid.get(Math.floor(h.x), Math.floor(h.y));
    h.swimming = (tf & F.DEEP) !== 0;
    // Bushes hide a man lying in them; tall crops hide him standing too.
    h.hidden = (!h.carrying && ((h.stance === 'prone' && (tf & F.BUSH)) || (tf & F.TALL))) ? 'bush' : (h.hidden === 'bush' ? null : h.hidden);
    h.still = h.moving ? 0 : (h.still || 0) + dt;

    if (h.act) { this.updateAction(h, dt); return; }
    const o = h.order;
    if (o && o.type === 'board') return this.pursueBoard(h, o, dt);
    if (o && o.type === 'recruit') return this.pursueRecruit(h, o, dt);
    if (o && o.type === 'ability') return this.pursueAbility(h, o, dt);
    if (o && o.type === 'interact') return this.pursueInteract(h, o, dt);
    if (h.path) {
      const wasRunning = h.run;
      const arrived = this.advance(h, this.heroSpeed(h), dt);
      // Footsteps: running is loud; walking on gravel/debris or through water is audible nearby.
      h.stepT = (h.stepT || 0) + dt;
      if (h.stepT > 0.45) {
        h.stepT = 0;
        if (wasRunning && h.stance === 'stand') this.noise(h.x, h.y, (tf & F.NOISY) ? 5 : 3.2, 'steps', h.id);
        else if ((tf & (F.NOISY | F.WATER)) && h.stance === 'stand') this.noise(h.x, h.y, 2.2, 'steps', h.id);
      }
      if (arrived) { h.order = null; h.run = false; this.mission.hook('onArrive', h); }
    }
    if (h.carrying) { const b = this.ent(h.carrying); if (b) { b.x = h.x - Math.cos(h.a) * 0.3; b.y = h.y - Math.sin(h.a) * 0.3; } }
  }

  pursueAbility(h, o, dt) {
    const ab = ABILITIES[o.ab];
    const tp = targetPos(this, o.target, h);
    if (!tp) { h.order = null; return; }
    const why = ab.check ? ab.check(this, h, o.target) : null;
    if (why) { this.emit({ type: 'deny', id: h.id, text: why }); h.order = null; h.path = null; return; }
    const d = targetDist(h, tp);
    const inRange = d <= ab.range && (!ab.needsLos || hasLOS(this.grid, h.x, h.y, tp.x, tp.y, tp.prone));
    if (inRange) {
      h.path = null; h.moving = false;
      h.a = Math.atan2(tp.y - h.y, tp.x - h.x);
      h.order = null;
      if (ab.dur) h.act = { ab: o.ab, t: 0, dur: ab.dur, target: o.target, done: false, sync: o.sync };
      else { const b = tp.e && tp.e.kind === 'enemy' && tp.e.state !== 'ok' ? tp.e : null; ab.use(this, h, o.target); if (b) this.searchBody(b, h); }
      return;
    }
    o.repath -= dt;
    if (!h.path || o.repath <= 0) {
      o.repath = 0.5;
      // Things never move: work out once which side to walk to (the hero's own side of a fence,
      // the near flank of a gun), then keep that goal.
      if (tp.t && !o.goal) o.goal = thingApproach(this, h, tp.t);
      const goal = (tp.t && o.goal) || approachPoint(this, h, tp, ab.range);
      if (!this.routeTo(h, goal.x, goal.y)) {
        if (o.goal) { o.goal = null; o.repath = 0; return; }
        this.emit({ type: 'cant', id: h.id, x: tp.x, y: tp.y }); h.order = null; return;
      }
    }
    this.advance(h, this.heroSpeed(h), dt);
  }

  pursueInteract(h, o, dt) {
    const t = this.thingById.get(o.thing);
    const spot = t.interact.at ? { x: t.interact.at[0] + 0.5, y: t.interact.at[1] + 0.5 } : thingCenter(t);
    const reach = t.interact.reach || 1.3;
    const d = distToThing(h, t, spot);
    if (d <= reach) {
      h.path = null; h.moving = false; h.order = null;
      h.a = Math.atan2(spot.y - h.y, spot.x - h.x);
      const dur = this.mission.interactDuration(h, t);
      h.act = { ab: 'interact', thing: t.id, t: 0, dur, done: false };
      return;
    }
    o.repath -= dt;
    if (!h.path || o.repath <= 0) {
      o.repath = 1;
      if (!t.interact.at && !o.goal) o.goal = thingApproach(this, h, t) || nearestReachable(this, h, t);
      const goal = t.interact.at ? spot : (o.goal || spot);
      if (!this.routeTo(h, goal.x, goal.y)) { this.emit({ type: 'cant', id: h.id, x: spot.x, y: spot.y }); h.order = null; return; }
    }
    this.advance(h, this.heroSpeed(h), dt);
  }

  updateAction(h, dt) {
    const a = h.act;
    a.t += dt;
    if (a.ab === 'interact') {
      if (a.t >= a.dur) { h.act = null; this.mission.interact(h, this.thingById.get(a.thing)); }
      return;
    }
    const ab = ABILITIES[a.ab];
    if (ab.continuous) { ab.tick(this, h, a, dt); return; }
    // A blade or a cloth needs arm's length: if the man walks on, the hero keeps after him.
    if (!a.done && ab.range <= 1.5 && a.target && a.target.ent) {
      const t = this.ent(a.target.ent);
      if (t && t.state === 'ok') {
        const d = Math.hypot(t.x - h.x, t.y - h.y);
        if (d > ab.range) {
          const step = Math.min(d - ab.range * 0.85, SPEED.run * dt), ux = (t.x - h.x) / d, uy = (t.y - h.y) / d;
          if (walkLine(this.grid, h.x, h.y, h.x + ux * step, h.y + uy * step, this.caps(h))) { h.x += ux * step; h.y += uy * step; }
          h.a = Math.atan2(t.y - h.y, t.x - h.x);
        }
      }
    }
    // Shadow Mode strikes planned together land together: each waits at its moment of impact
    // until every partner is there too (resolved after all heroes have moved this tick).
    if (a.sync && !a.done && a.t >= (ab.hitT ?? ab.dur * 0.5)) { a.t = ab.hitT ?? ab.dur * 0.5; a.ready = true; return; }
    if (!a.done && a.t >= (ab.hitT ?? ab.dur * 0.5)) {
      a.done = true;
      // Re-validate: the target may have moved out of reach or died meanwhile.
      const tp = targetPos(this, a.target, h);
      const why = ab.check ? ab.check(this, h, a.target) : null;
      const handled = tp && tp.e && tp.e.kind === 'enemy' && tp.e.state !== 'ok' ? tp.e : null;
      if (!why && tp && targetDist(h, tp) <= ab.range + 0.6) { ab.use(this, h, a.target); if (handled) this.searchBody(handled, h); }
      else this.emit({ type: 'deny', id: h.id, text: why || 'Out of reach' });
    }
    if (a.t >= a.dur) h.act = null;
  }

  // An escorted specialist doing an interaction (interact.npc): walk to it, work, done.
  npcTask(n, dt) {
    const o = n.task, t = this.thingById.get(o.thing);
    const st = t && this.thingState(t.id);
    if (!t || !t.interact) { n.task = null; n.act = null; return; }
    if (n.act) {
      n.act.t += dt;
      if (n.act.t >= n.act.dur) { n.act = null; n.task = null; st.busy = null; this.mission.interact(n, t); }
      return;
    }
    const spot = t.interact.at ? { x: t.interact.at[0] + 0.5, y: t.interact.at[1] + 0.5 } : thingCenter(t);
    if (distToThing(n, t, spot) <= (t.interact.reach || 1.3)) {
      n.path = null; n.moving = false;
      n.a = Math.atan2(spot.y - n.y, spot.x - n.x);
      const why = this.mission.interactBlocked(n, t);
      if (why) { n.task = null; this.emit({ type: 'deny', id: n.id, text: why }); return; }
      st.busy = n.id;
      n.act = { ab: 'interact', thing: t.id, t: 0, dur: this.mission.interactDuration(n, t), done: false };
      return;
    }
    o.repath -= dt;
    if (!n.path || o.repath <= 0) {
      o.repath = 1;
      if (!t.interact.at && !o.goal) o.goal = thingApproach(this, n, t) || nearestReachable(this, n, t);
      const goal = t.interact.at ? spot : (o.goal || spot);
      if (!this.routeTo(n, goal.x, goal.y)) { n.task = null; this.emit({ type: 'cant', id: n.id }); return; }
    }
    this.advance(n, SPEED.walk * (n.slow ? 0.75 : 1), dt);
  }

  // A friendly soldier in a firefight: picks the nearest enemy he can see and shoots at him.
  // Returns true while he is engaging (he stands to shoot).
  npcFight(n, dt) {
    if (n.holdFire) return false;                          // waiting for the order to open fire
    // Wounded and told to (`withdraw: true`), he falls back towards `fallback` or away from the fight.
    if (n.withdraw && n.hp <= 1 && n.maxHp > 1) {
      if (!n.path) { const f = n.fallback || [n.x - Math.cos(n.a) * 10, n.y - Math.sin(n.a) * 10]; this.routeTo(n, f[0], f[1]); }
      if (n.path) { this.advance(n, SPEED.run * 0.8, dt); return true; }
      return false;
    }
    n.shootT = Math.max(0, (n.shootT || 0) - dt);
    n.scanT = (n.scanT || 0) - dt;
    let tgt = n.target ? this.ent(n.target) : null;
    if (n.scanT <= 0 || !tgt || tgt.state !== 'ok') {
      n.scanT = 0.5; tgt = null;
      const night = this.time === 'night' ? 0.6 : 1;
      let bd = n.range * night;
      for (const e of this.ents) {
        if (e.kind !== 'enemy' || e.state !== 'ok' || (e.hidden && (e.hidden.startsWith('b:') || e.hidden === 'water'))) continue;
        const d = Math.hypot(e.x - n.x, e.y - n.y);
        if (d >= bd || !hasLOS(this.grid, n.x, n.y, e.x, e.y, e.stance === 'prone')) continue;
        bd = d; tgt = e;
      }
      n.target = tgt ? tgt.id : null;
    }
    if (!tgt) return false;
    n.a = Math.atan2(tgt.y - n.y, tgt.x - n.x);
    n.path = null; n.moving = false;
    if (n.shootT > 0) return true;
    const d = Math.hypot(tgt.x - n.x, tgt.y - n.y);
    const shots = n.weapon === 'mg' ? 3 : 1;
    let p = Math.min(0.9, Math.max(0.1, 0.55 * (1.15 - d / 16) * (n.accuracy ?? 1)));
    if (tgt.stance === 'prone') p *= 0.6;
    for (let i = 0; i < shots && tgt.state === 'ok'; i++) {
      const hit = this.rng.chance(n.weapon === 'mg' ? p * 0.6 : p);
      this.emit({ type: 'shot', from: n.id, to: tgt.id, hit, weapon: n.weapon, i });
      if (hit) { tgt.hp -= 1; if (tgt.hp <= 0) this.kill(tgt, n, n.weapon); }
    }
    if (tgt.state === 'ok' && tgt.ai.mode !== 'alert') becomeAlert(this, tgt, n);
    this.noise(n.x, n.y, 18, 'shot', n.id);
    n.shootT = (n.fireRate ?? (n.weapon === 'mg' ? 1.8 : 1.4)) * this.rng.range(0.85, 1.2);
    return true;
  }

  updateNpc(n, dt) {
    if (n.state !== 'ok' || n.inVehicle) return;
    if (n.hidden && n.hidden.startsWith('b:')) return;
    if (n.fighter && this.npcFight(n, dt)) return;
    if (n.task) return this.npcTask(n, dt);
    const leader = n.follow ? this.ent(n.follow) : null;
    const leaderIn = leader && leader.state === 'ok' && leader.hidden && leader.hidden.startsWith('b:') ? this.thingById.get(leader.hidden.slice(2)) : null;
    if (leaderIn && leaderIn.door) {
      // The leader has gone indoors: follow him in through the same door.
      const dx = leaderIn.door[0] + 0.5, dy = leaderIn.door[1] + 0.5;
      if (Math.hypot(dx - n.x, dy - n.y) < 1.3) { this.enterBuilding(n, leaderIn); return; }
      n.repath = (n.repath || 0) - dt;
      if (!n.path || n.repath <= 0) { n.repath = 1; if (!this.routeTo(n, dx, dy)) { n.path = null; return; } }
      this.advance(n, n.stance === 'prone' ? SPEED.prone : SPEED.walk * (n.slow ? 0.75 : 1), dt);
      return;
    }
    if (leader && leader.state === 'ok' && leader.inVehicle) {
      // The leader is aboard: climb in after him while there is room and the boat or car is near
      // and waiting; otherwise stay put, in the nearest bush if there is one, until he is back.
      const v = this.ent(leader.inVehicle);
      const dv = v ? Math.hypot(v.x - n.x, v.y - n.y) : Infinity;
      if (v && v.state === 'ok' && v.passengers.length < v.seats && !v.moving && dv < 10) {
        if (dv < 2.2) { this.board(n, v); return; }
        n.repath = (n.repath || 0) - dt;
        if (!n.path || n.repath <= 0) {
          n.repath = 0.8;
          const spot = nearestWalkable(this.grid, Math.floor(v.x), Math.floor(v.y), this.caps(n), 3);
          if (!spot || !this.routeTo(n, spot[0] + 0.5, spot[1] + 0.5)) n.path = null;
        }
        if (n.path) this.advance(n, SPEED.walk * (n.slow ? 0.75 : 1), dt);
        return;
      }
      if (!n.waitSpot) {
        let best = null, bd = 4.5;
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
          const x = Math.floor(n.x) + dx, y = Math.floor(n.y) + dy, d = Math.hypot(dx, dy);
          if (d < bd && this.grid.has(x, y, F.BUSH) && this.grid.walkable(x, y, this.caps(n))) { bd = d; best = { x: x + 0.5, y: y + 0.5 }; }
        }
        n.waitSpot = best || { x: n.x, y: n.y, open: true };
        n.path = null;
        if (best) this.routeTo(n, best.x, best.y);
      }
      if (n.path) this.advance(n, SPEED.walk * (n.slow ? 0.75 : 1), dt);
      else if (!n.waitSpot.open) n.stance = 'prone';           // keep his head down in the bush
      n.moving = !!n.path;
      const tf2 = this.grid.get(Math.floor(n.x), Math.floor(n.y));
      n.hidden = (n.stance === 'prone' && (tf2 & F.BUSH)) || (tf2 & F.TALL) ? 'bush' : (n.hidden === 'bush' ? null : n.hidden);
      return;
    }
    if (n.waitSpot) n.waitSpot = null;
    if (leader && leader.state === 'ok' && !(leader.hidden && leader.hidden.startsWith('b:'))) {
      // Followers keep a short chain behind their leader and copy their stance.
      const slot = n.slot || 1;
      const d = Math.hypot(leader.x - n.x, leader.y - n.y);
      n.stance = leader.stance;
      const want = 1.0 + slot * 0.7;
      if (d > want + 0.4) {
        n.repath = (n.repath || 0) - dt;
        if (!n.path || n.repath <= 0) { n.repath = 0.6; this.routeTo(n, leader.x, leader.y); }
        const sp = n.swimming ? SPEED.swim : n.stance === 'prone' ? SPEED.prone : (leader.run ? SPEED.run * 0.95 : SPEED.walk * (n.slow ? 0.75 : 1));
        this.advance(n, sp, dt);
        if (n.path && Math.hypot(leader.x - n.x, leader.y - n.y) <= want) { n.path = null; n.moving = false; }
      } else { n.path = null; n.moving = false; }
    } else if (n.path) {
      this.advance(n, SPEED.walk, dt);
    } else if (n.route && n.route.length && !n.follow) {
      // A scripted round (npc `route`, like an enemy patrol).
      const wp = n.route[n.ri % n.route.length];
      if (n.waitT > 0) { n.waitT -= dt; if (n.waitT <= 0) n.ri = (n.ri + 1) % n.route.length; }
      else if (Math.hypot(wp.x - n.x, wp.y - n.y) < 0.3) n.waitT = wp.wait || 0.01;
      else if (!this.routeTo(n, wp.x, wp.y)) n.ri = (n.ri + 1) % n.route.length;
    }
    const tf = this.grid.get(Math.floor(n.x), Math.floor(n.y));
    n.swimming = (tf & F.DEEP) !== 0;
    n.hidden = ((n.stance === 'prone' && (tf & F.BUSH)) || (tf & F.TALL)) ? 'bush' : (n.hidden === 'bush' ? null : n.hidden);
  }

  // ---------- projectiles & charges ----------
  throwProjectile(kind, from, x, y, extra = {}) {
    const d = Math.hypot(x - from.x, y - from.y);
    this.s.proj.push({ kind, sx: from.x, sy: from.y, x, y, t: 0, dur: Math.max(0.35, d / 11), by: from.id, ...extra });
    this.emit({ type: 'throw', kind, sx: from.x, sy: from.y, x, y });
  }
  updateProjectiles(dt) {
    const keep = [];
    for (const p of this.s.proj) {
      p.t += dt;
      if (p.t < p.dur) { keep.push(p); continue; }
      if (p.kind === 'stone') { this.noise(p.x, p.y, 6.5, 'stone'); this.emit({ type: 'land', kind: 'stone', x: p.x, y: p.y }); }
      else if (p.kind === 'firecracker') { this.noise(p.x, p.y, 11, 'firecracker'); this.emit({ type: 'firecracker', x: p.x, y: p.y }); }
      else if (p.kind === 'grenade') {
        if (p.fuse === undefined) { p.fuse = 1.2; p.dur = p.t + p.fuse; keep.push(p); this.emit({ type: 'land', kind: 'grenade', x: p.x, y: p.y }); continue; }
        this.explode(p.x, p.y, 2.2, this.ent(p.by));
      } else if (p.kind === 'smoke') { this.emit({ type: 'smoke', x: p.x, y: p.y }); this.mission.hook('onSmoke', p); }
    }
    this.s.proj = keep;
  }
  placeCharge(h, x, y, mode, thingId = null, fuse = 10) {
    const id = 'c' + this.s.nextId++;
    this.s.objs[id] = { type: 'charge', x, y, mode, thing: thingId, owner: h.id, t: mode === 'timed' ? fuse : -1 };
    this.emit({ type: 'charge', id, x, y });
    this.mission.hook('onPlace', h, { id, x, y, mode, thing: thingId, fuse: mode === 'timed' ? fuse : null });
    return id;
  }
  charges(owner) { return Object.entries(this.s.objs).filter(([, o]) => o.type === 'charge' && !o.spent && (!owner || o.owner === owner)); }
  detonate(id) {
    const c = this.s.objs[id];
    if (!c || c.spent) return;
    c.spent = true;
    this.explode(c.x, c.y, c.big ? 3.2 : 2.4, this.ent(c.owner), c.thing);
    delete this.s.objs[id];
  }
  updateCharges(dt) {
    for (const [id, c] of Object.entries(this.s.objs)) {
      if (c.type !== 'charge' || c.spent || c.mode !== 'timed') continue;
      c.t -= dt;
      if (c.t <= 0) this.detonate(id);
    }
  }
  // opts.quiet: background shelling and the like. It still flashes, booms, wounds and wrecks,
  // but sends no noise to the guards and raises no alarm.
  explode(x, y, r, by, thingId = null, opts = {}) {
    this.emit({ type: 'explosion', x, y, r, quiet: !!opts.quiet });
    this.mission.hook('onExplosion', x, y, r, by || null, { thing: thingId, quiet: !!opts.quiet });
    for (const e of this.ents) {
      if (e.state === 'dead') continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d > r) continue;
      if (e.hidden && e.hidden.startsWith('b:')) continue;
      if (e.kind === 'enemy' || (e.kind === 'npc' && e.state === 'ok')) {
        if (e.kind === 'npc') this.killHero(e); else this.kill(e, by, 'explosion');
      } else if (e.kind === 'hero' && !e.inVehicle) { this.damageHero(e); this.damageHero(e); }
      else if (e.kind === 'vehicle') this.damageVehicle(e, 4, by);
    }
    // Things caught in the blast are destroyed if they are destructible.
    for (const t of this.things) {
      if (!t.destructible) continue;
      const st = this.thingState(t.id);
      if (st.destroyed) continue;
      let hit;
      if (tileList(t)) hit = footprintDist(t, x, y) <= r * 0.8;      // wire and walls: the stretch the blast reaches
      else { const c = thingCenter(t); hit = Math.hypot(c.x - x, c.y - y) <= r + Math.max(t.w || 1, t.h || 1) * 0.5; }
      if (t.id === thingId || hit) this.destroyThing(t, by, !!opts.quiet);
    }
    if (opts.quiet) return;
    this.noise(x, y, 32, 'explosion');
    if (!this.def.explosionsQuiet) this.raiseAlarm(x, y);
  }

  // ---------- area hazards ----------
  // Gas, smoke or burning oil over a circle: `{ r: 3, dur: 30, kind: 'gas'|'smoke'|'fire', dps: 1 }`.
  // Every second it wounds (dps hits) anyone inside who is not in a vehicle or a building, and
  // smoke and gas block sight while they last. Saved in world.s.hazards.
  addHazard(x, y, opts = {}) {
    const kind = opts.kind || 'smoke';
    const h = { id: 'z' + this.s.nextId++, x, y, r: opts.r || 3, t0: this.s.t, dur: opts.dur || 30, kind,
      dps: opts.dps ?? (kind === 'smoke' ? 0 : 1), blocks: opts.blocksSight ?? (kind !== 'fire'), acc: 0, drift: opts.drift || null };
    (this.s.hazards || (this.s.hazards = [])).push(h);
    if (h.blocks) this.rebuildFlags();
    this.emit({ type: 'hazard', id: h.id, x, y, r: h.r, kind, dur: h.dur });
    return h.id;
  }
  updateHazards(dt) {
    const hz = this.s.hazards;
    if (!hz || !hz.length) return;
    let changed = false;
    let drifted = false;
    for (const h of hz) {
      if (this.s.t - h.t0 >= h.dur) { h.done = true; changed = changed || h.blocks; continue; }
      if (h.drift) { h.x += h.drift[0] * dt; h.y += h.drift[1] * dt; h.dacc = (h.dacc || 0) + dt; if (h.dacc >= 1 && h.blocks) { h.dacc = 0; drifted = true; } }
      if (!h.dps) continue;
      h.acc += dt;
      if (h.acc < 1) continue;
      h.acc -= 1;
      for (const e of this.ents) {
        if (e.state !== 'ok' || e.inVehicle || (e.hidden && e.hidden.startsWith('b:')) || e.kind === 'vehicle') continue;
        if (Math.hypot(e.x - h.x, e.y - h.y) > h.r) continue;
        for (let i = 0; i < h.dps; i++) {
          if (e.kind === 'hero') this.damageHero(e, null);
          else if (e.kind === 'npc') { e.hp -= 1; if (e.hp <= 0) this.killHero(e); }
          else if (e.kind === 'enemy') { e.hp -= 1; if (e.hp <= 0) this.kill(e, null, h.kind); }
        }
      }
    }
    if (hz.some((h) => h.done)) { this.s.hazards = hz.filter((h) => !h.done); if (changed) drifted = true; }
    if (drifted) this.rebuildFlags();
  }

  // ---------- aircraft ----------
  // A plane crossing the map: `{ from: [x, y], to: [x, y], kind: 'plane'|'bomber', speed: 22,
  // alt: 12, strafe: false, width: 1.5, noise: 14 }`. With `strafe` it fires along its ground track:
  // anyone within `width` of the lane as it passes may be hit (once per pass). Saved in world.s.planes.
  addFlyover(o = {}) {
    const [x0, y0] = o.from || [0, 0], [x1, y1] = o.to || [this.grid.w, this.grid.h];
    const d = Math.hypot(x1 - x0, y1 - y0) || 1;
    const p = { id: 'a' + this.s.nextId++, x0, y0, x1, y1, t0: this.s.t, dur: d / (o.speed || 22), kind: o.kind || 'plane', alt: o.alt ?? 12,
      strafe: !!o.strafe, width: o.width || 1.5, noise: o.noise ?? 14, hit: [], acc: 0 };
    (this.s.planes || (this.s.planes = [])).push(p);
    this.emit({ type: 'flyover', id: p.id, kind: p.kind, strafe: p.strafe });
    return p.id;
  }
  planePos(p) {
    const k = Math.min(1, Math.max(0, (this.s.t - p.t0) / p.dur));
    return { x: p.x0 + (p.x1 - p.x0) * k, y: p.y0 + (p.y1 - p.y0) * k, k, a: Math.atan2(p.y1 - p.y0, p.x1 - p.x0) };
  }
  updatePlanes(dt) {
    const ps = this.s.planes;
    if (!ps || !ps.length) return;
    for (const p of ps) {
      const P = this.planePos(p);
      if (P.k >= 1) { p.done = true; continue; }
      p.acc += dt;
      if (p.acc < 0.25) continue;
      p.acc = 0;
      // Its roar is everywhere at once: guards don't go looking for it (no AI noise); the
      // 'flyover' event carries the sound.
      if (!p.strafe) continue;
      // The guns rake the ground a little ahead of the plane.
      const gx = P.x + Math.cos(P.a) * 2, gy = P.y + Math.sin(P.a) * 2;
      this.emit({ type: 'strafe', x: gx, y: gy, a: P.a });
      for (const e of this.ents) {
        if (e.state !== 'ok' || p.hit.includes(e.id) || e.kind === 'vehicle' || (e.hidden && e.hidden.startsWith('b:'))) continue;
        if (Math.hypot(e.x - gx, e.y - gy) > p.width + 0.6) continue;
        p.hit.push(e.id);
        if (!this.rng.chance(e.stance === 'prone' ? 0.35 : 0.6)) continue;
        if (e.kind === 'hero') this.damageHero(e, null);
        else if (e.kind === 'npc') { e.hp -= 1; if (e.hp <= 0) this.killHero(e); }
        else if (e.kind === 'enemy') this.kill(e, null, 'strafe');
      }
      for (const v of this.ents) if (v.kind === 'vehicle' && v.state === 'ok' && !p.hit.includes(v.id) && Math.hypot(v.x - gx, v.y - gy) <= p.width + 1) { p.hit.push(v.id); this.damageVehicle(v, 2, null); }
    }
    if (ps.some((p) => p.done)) this.s.planes = ps.filter((p) => !p.done);
  }

  // ---------- temporary lights ----------
  // A flare over no-man's land, a burning lorry: lights the ground around it (vision at full
  // range, as under a lamp) and fades out. Kept in world.s.flares so saves carry it.
  addFlare(x, y, opts = {}) {
    const f = { id: 'f' + this.s.nextId++, x, y, r: opts.r || 7, t0: this.s.t, dur: opts.dur || 25, kind: opts.kind || 'flare', color: opts.color || null };
    (this.s.flares || (this.s.flares = [])).push(f);
    this.emit({ type: 'flare', id: f.id, x, y, r: f.r, dur: f.dur, kind: f.kind });
    return f.id;
  }
  // How much of its reach a flare still lights: full for most of its life, then it dies away.
  flareReach(f) {
    const k = (this.s.t - f.t0) / f.dur;
    if (k < 0 || k >= 1) return 0;
    return f.r * (k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25 * 0.85);
  }
  litByLantern(x, y) {
    const L = this.lanterns;
    if (!L) return false;
    for (const e of L) if (Math.hypot(x - e.x, y - e.y) <= e.lantern) return true;
    return false;
  }
  litByFlare(x, y) {
    const fl = this.s.flares;
    if (!fl || !fl.length) return false;
    for (const f of fl) if (Math.hypot(x - f.x, y - f.y) <= this.flareReach(f)) return true;
    return false;
  }
  destroyThing(t, by, quiet = false) {
    const st = this.thingState(t.id);
    if (st.destroyed) return;
    st.destroyed = true;
    this.rebuildFlags();
    this.emit({ type: 'destroyed', thing: t.id });
    this.mission.hook('onDestroyed', t, by);
    // Chain reactions: fuel and ammunition go up too.
    if (t.volatile) this.s.timers.push({ at: this.s.t + 0.4, ev: '_chain', x: thingCenter(t).x, y: thingCenter(t).y, r: t.volatile, quiet: quiet || undefined });
  }
}

// ---------- entity factories ----------
export function makeHero(def, heroData, diff, inventory = {}) {
  return {
    kind: 'hero', hid: def.hid, name: heroData.short || heroData.name, callsign: heroData.callsign,
    faction: 'allied', x: def.x + 0.5, y: def.y + 0.5, a: def.a || 0,
    hp: diff.heroHp, maxHp: diff.heroHp, stance: def.prone ? 'prone' : 'stand', state: 'ok',
    run: false, path: null, pi: 0, order: null, act: null, carrying: null, hidden: null,
    disguised: !!def.disguised, uniform: !!def.disguised, civilian: !!def.civilian,
    skis: !!def.skis, snow: !!def.snow, abilities: [...heroData.abilities, ...(def.extra || [])],
    ammo: { ...defaultAmmo(heroData.abilities, diff), ...inventory }, cd: {},
    colors: heroData.colors, shadow: null,
  };
}

function defaultAmmo(abilities, diff) {
  const bonus = diff.heroHp >= 6 ? 2 : 0;
  const a = {};
  for (const ab of abilities) {
    const def = ABILITIES[ab];
    if (def && def.ammo !== undefined) a[ab] = def.ammo + (def.ammo > 0 ? bonus : 0);
  }
  return a;
}

// Whole-number coordinates mean "the middle of that tile"; fractional ones are used as given.
const tileCentre = (v) => v + (Number.isInteger(v) ? 0.5 : 0);

export function makeEnemy(def, diff) {
  const et = ENEMY_TYPES[def.type || 'soldier'];
  const fac = FACTIONS[def.faction || 'wehrmacht'];
  return {
    kind: 'enemy', etype: def.type || 'soldier', faction: def.faction || 'wehrmacht', side: fac.side,
    tag: def.tag || null, name: def.name || et.label,
    x: tileCentre(def.x), y: tileCentre(def.y), a: def.a || 0,
    hp: et.hp, state: 'ok', koT: 0, tied: false, carriedBy: null, hidden: null, path: null, pi: 0,
    civilian: !!def.civilian, lantern: def.lantern === true ? 4 : (def.lantern || 0), pose: def.pose || null, item: def.item || null,
    look: def.look || null, boat: def.boat ? (def.boat === true ? 'boat' : def.boat) : null, surrenders: !!def.surrenders,
    grenades: def.grenades || 0, holdFire: !!def.holdFire, seesDisguise: def.seesDisguise,
    ai: {
      mode: def.route ? 'patrol' : 'post',
      home: { x: tileCentre(def.x), y: tileCentre(def.y), a: def.a || 0 },
      route: def.route ? def.route.map((p) => ({ x: tileCentre(p[0]), y: tileCentre(p[1]), wait: p[2] || 0, look: p[3] })) : null,
      ri: 0, waitT: 0, sweep: def.sweep || null, si: 0, sweepT: 0,
      range: et.range * (def.rangeMul || 1), fov: et.fov * Math.PI / 180, near: et.near,
      susp: {}, target: null, last: null, goal: null, path: null, pi: 0, searchT: 0, shootT: 0,
      holdPost: !!def.hold, edge: 0, lookT: 0, speech: 0, deaf: !!def.deaf, asleep: def.pose === 'sleep', seat: def.pose === 'sit',
      report: def.report || null, flee: !!def.flee, oblivious: !!def.oblivious,
    },
  };
}

// Vehicles and boats: seats, speed (tiles/s), engine noise radius (0 = silent paddling).
export const VEHICLES = {
// armour: the chance a hit on the vehicle is stopped before it reaches anyone aboard.
  jeep: { seats: 3, speed: 6.5, hp: 6, motor: 7, model: 'jeep', armour: 0 },
  kubel: { seats: 4, speed: 6, hp: 6, motor: 7, model: 'kubel', armour: 0.1 },
  truck: { seats: 8, speed: 4.5, hp: 9, motor: 9, model: 'truck', armour: 0.3 },
  train: { seats: 6, speed: 4, hp: 24, motor: 11, model: 'locomotive', armour: 0.8 },
  wagon: { seats: 10, speed: 4, hp: 14, motor: 0, model: 'wagon', armour: 0.6 },
  motorcycle: { seats: 2, speed: 7, hp: 3, motor: 8, model: 'motorcycle', armour: 0 },
  canoe: { seats: 2, speed: 2.5, hp: 2, motor: 0, model: 'canoe', boat: true, low: true, armour: 0 },
  rubberboat: { seats: 6, speed: 2.4, hp: 3, motor: 0, model: 'rubberboat', boat: true, low: true, armour: 0 },
  boat: { seats: 8, speed: 4, hp: 8, motor: 9, model: 'boat', boat: true, armour: 0.3 },
  fishingboat: { seats: 14, speed: 3, hp: 10, motor: 6, model: 'fishingboat', boat: true, armour: 0.4 },
  // Big vessels for scripted sailings (api.moveVehicle): nobody boards them unless the mission sets seats.
  ship: { seats: 0, speed: 1.8, hp: 40, motor: 8, model: 'ship', boat: true, armour: 0.9 },
  warship: { seats: 0, speed: 2, hp: 80, motor: 10, model: 'warship', boat: true, armour: 0.95 },
  uboat: { seats: 0, speed: 2, hp: 40, motor: 8, model: 'uboat', boat: true, armour: 0.9 },
};
export function makeVehicle(def) {
  const v = VEHICLES[def.vtype] || VEHICLES.jeep;
  return {
    kind: 'vehicle', vtype: def.vtype || 'jeep', model: def.model || v.model, tag: def.tag || null, color: def.color,
    x: def.x + 0.5, y: def.y + 0.5, a: def.a || 0, state: 'ok', hp: def.hp || v.hp, maxHp: def.hp || v.hp,
    seats: def.seats ?? v.seats, speed: def.speed || v.speed, motor: def.motor ?? v.motor, boat: !!v.boat,
    stance: v.low ? 'prone' : 'stand', side: def.side || 'allied', anyDriver: !!def.anyDriver,
    armour: def.armour ?? v.armour ?? 0, crew: !!def.crew, disguise: !!def.disguise, ignore: !!def.ignore,
    driver: null, passengers: [], path: null, pi: 0, moving: false,
    lantern: def.lights === true ? 5 : (def.lights || 0),
    rail: def.rail ? def.rail.map(([x, y]) => [x + 0.5, y + 0.5]) : null,
  };
}

// A rail vehicle runs only along its track: from the point of the line nearest to where it is
// to the point nearest the goal, through every bend in between.
function railProject(pts, x, y) {
  let best = { d: Infinity, i: 0, k: 0, x: pts[0][0], y: pts[0][1] };
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    const k = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
    const px = ax + dx * k, py = ay + dy * k, d = Math.hypot(x - px, y - py);
    if (d < best.d) best = { d, i, k, x: px, y: py };
  }
  return best;
}
export function railPath(pts, from, x, y) {
  const a = railProject(pts, from.x, from.y), b = railProject(pts, x, y);
  const out = [];
  if (a.i + a.k <= b.i + b.k) for (let i = a.i + 1; i <= b.i; i++) out.push([pts[i][0], pts[i][1]]);
  else for (let i = a.i; i > b.i; i--) out.push([pts[i][0], pts[i][1]]);
  out.push([b.x, b.y]);
  return out;
}

const MUFFLE = { rain: 0.8, storm: 0.7, blizzard: 0.75 };
// Things any hero can do: get out of a vehicle, search a body, drag one (if he cannot carry it).
const ANYONE = new Set(['disembark', 'search', 'carry', 'revive']);

const FROM_VEHICLE = new Set(['bren', 'rifle', 'pistol', 'welrod', 'silentrifle', 'grenade', 'binoculars', 'whistle', 'firecracker', 'stone', 'disembark']);

export function makeNpc(def) {
  return {
    kind: 'npc', role: def.role || 'prisoner', name: def.name || 'Prisoner', tag: def.tag || null,
    faction: def.faction || 'allied', x: def.x + 0.5, y: def.y + 0.5, a: def.a || 0,
    hp: def.hp || 2, maxHp: def.hp || 2, stance: 'stand', state: 'ok', follow: null, slot: 1,
    path: null, pi: 0, hidden: null, slow: !!def.slow, look: def.look || (def.fighter ? 'ally' : 'prisoner'), swim: !!def.swim,
    // Friendly soldiers who fight (`fighter: true`): they shoot enemies they can see and can be shot.
    fighter: !!def.fighter, weapon: def.weapon || 'rifle', range: def.range || 11, shootT: 0, scanT: 0,
    holdFire: !!def.holdFire, fireRate: def.fireRate, accuracy: def.accuracy, withdraw: !!def.withdraw, fallback: def.fallback || null,
    route: def.route ? def.route.map((p) => ({ x: p[0] + (Number.isInteger(p[0]) ? 0.5 : 0), y: p[1] + (Number.isInteger(p[1]) ? 0.5 : 0), wait: p[2] || 0 })) : null, ri: 0, waitT: 0,
  };
}

// ---------- geometry helpers ----------
export function turnToward(a, b, maxStep) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) <= maxStep) return b;
  return a + Math.sign(d) * maxStep;
}

export function thingCenter(t) {
  return { x: t.x + (t.w || 1) / 2, y: t.y + (t.h || 1) / 2 };
}

// Reach to a thing for an interaction: to its `at` spot, else to the nearest part of it (the
// nearest panel of a long fence, the edge of a rectangle), the same measure the approach uses.
function distToThing(u, t, spot) {
  if (t.interact && t.interact.at) return Math.hypot(spot.x - u.x, spot.y - u.y);
  return footprintDist(t, u.x, u.y);
}

function nearestReachable(world, u, t) {
  const caps = world.caps(u);
  let best = null, bd = 1e9;
  for (let y = t.y - 1; y <= t.y + (t.h || 1); y++) for (let x = t.x - 1; x <= t.x + (t.w || 1); x++) {
    if (!world.grid.walkable(x, y, caps)) continue;
    const d = Math.hypot(x + 0.5 - u.x, y + 0.5 - u.y);
    if (d < bd) { bd = d; best = { x: x + 0.5, y: y + 0.5 }; }
  }
  return best;
}

// Fences, walls and cliffs are lists of tiles rather than one rectangle.
const tileList = (t) => t.type === 'fence' || t.type === 'barrier' || t.type === 'cliff' || (t.tiles && t.tiles.length !== (t.w || 1) * (t.h || 1));

// Distance from a point to the nearest edge of a thing's footprint (0 when standing on it).
export function footprintDist(t, x, y) {
  if (tileList(t)) {
    let best = Infinity;
    for (const [tx, ty] of t.tiles) {
      const dx = Math.max(tx - x, 0, x - (tx + 1)), dy = Math.max(ty - y, 0, y - (ty + 1));
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }
  const dx = Math.max(t.x - x, 0, x - (t.x + (t.w || 1))), dy = Math.max(t.y - y, 0, y - (t.y + (t.h || 1)));
  return Math.hypot(dx, dy);
}

// Where an ability aims. For a thing seen from `from`, the point to face is its centre, or for a
// long fence or wall the stretch nearest to the hero.
export function targetPos(world, target, from = null) {
  if (!target) return null;
  if (target.ent) {
    const e = world.ent(target.ent);
    if (!e) return null;
    return { x: e.x, y: e.y, prone: e.state !== 'ok' || e.stance === 'prone', e };
  }
  if (target.thing) {
    const t = world.thingById.get(target.thing);
    if (!t) return null;
    if (from && tileList(t) && t.tiles.length) {
      let best = t.tiles[0], bd = Infinity;
      for (const p of t.tiles) { const d = (p[0] + 0.5 - from.x) ** 2 + (p[1] + 0.5 - from.y) ** 2; if (d < bd) { bd = d; best = p; } }
      return { x: best[0] + 0.5, y: best[1] + 0.5, t };
    }
    return { ...thingCenter(t), t };
  }
  return { x: target.x, y: target.y };
}

// Range to a target: to a unit or a point, centre to centre; to a thing, to its footprint's edge
// (a 3x3 gun is in reach from any tile beside it).
export function targetDist(u, tp) {
  return tp.t ? footprintDist(tp.t, u.x, u.y) : Math.hypot(tp.x - u.x, tp.y - u.y);
}

// The best tile to stand on to work on a thing: of the walkable tiles touching it, the one with
// the shortest walk (so a hero cuts a fence from his own side, not after a detour round it).
export function thingApproach(world, u, t) {
  const g = world.grid, caps = world.caps(u);
  const own = new Set((t.tiles || []).map(([x, y]) => y * g.w + x));
  // Along a fence or wall only the stretch nearest the hero matters.
  const np = tileList(t) ? targetPos(world, { thing: t.id }, u) : null;
  const src = np ? t.tiles.filter(([x, y]) => Math.hypot(x + 0.5 - np.x, y + 0.5 - np.y) < 2.5) : t.tiles;
  const seen = new Set(), cands = [];
  for (const [tx, ty] of src) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = tx + dx, y = ty + dy, k = y * g.w + x;
    if (seen.has(k) || !g.inside(x, y)) continue;
    seen.add(k);
    if (own.has(k) && (g.get(x, y) & F.BLOCK)) continue;
    if (!g.walkable(x, y, caps)) continue;
    cands.push([x, y, Math.hypot(x + 0.5 - u.x, y + 0.5 - u.y)]);
  }
  cands.sort((a, b) => a[2] - b[2]);
  let best = null, bl = Infinity;
  for (const [x, y, d] of cands.slice(0, 12)) {
    if (d >= bl) break;                       // a straight line is the shortest any walk can be
    if (Math.floor(u.x) === x && Math.floor(u.y) === y) return { x: u.x, y: u.y };
    const p = findPath(g, u.x, u.y, x + 0.5, y + 0.5, caps);
    if (!p) continue;
    const L = pathLength([u.x, u.y], p);
    if (L < bl) { bl = L; best = { x: x + 0.5, y: y + 0.5 }; }
  }
  return best;
}

// Where should a unit walk to be within `range` of point tp? For melee, the target itself.
function approachPoint(world, u, tp, range) {
  if (range <= 1.5) return tp;
  const d = Math.hypot(tp.x - u.x, tp.y - u.y);
  const k = Math.max(0, (d - range * 0.85) / d);
  const x = u.x + (tp.x - u.x) * k, y = u.y + (tp.y - u.y) * k;
  if (world.grid.walkable(Math.floor(x), Math.floor(y), world.caps(u))) return { x, y };
  const n = nearestWalkable(world.grid, Math.floor(x), Math.floor(y), world.caps(u), 4);
  return n ? { x: n[0] + 0.5, y: n[1] + 0.5 } : tp;
}

export { walkLine };
