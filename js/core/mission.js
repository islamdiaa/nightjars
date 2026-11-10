import { makeEnemy, makeNpc, makeVehicle, thingCenter } from './world.js';
import { heroAbilities } from './abilities.js';
import { DIFF_RANK } from './constants.js';

// Objectives, triggers, timed events, interactions and the scripting API for one mission.
//
// A mission definition (js/data/missions/mNN.js) declares data (objectives, triggers) plus
// optional functions. Functions never hold state themselves: whatever they need to remember
// goes through api.flag(), which lives in world.s.flags and is saved with the game.

export class MissionRuntime {
  constructor(world, def) {
    this.w = world;
    this.def = def;
    this.api = makeApi(world, this);
    this.winDelay = null;
  }

  start() {
    const s = this.w.s;
    s.objectives = (this.def.objectives || []).map((o) => ({
      id: o.id, text: o.text, optional: !!o.optional, state: o.after || o.hidden ? 'hidden' : 'active', progress: null,
    }));
    s.countdowns = {};
    for (const o of s.objectives) if (o.state === 'active') this.armDeadline(o.id);
    this.hook('onStart');
  }

  // ---------- countdowns ----------
  // A visible clock in the objectives panel, saved in world.s.countdowns. An objective with
  // `deadline: seconds` starts its own when it becomes active; when it runs out the objective
  // fails, or `onExpire: 'eventName'` fires that event instead ('none' just stops the clock).
  // api.countdown(id, seconds, label) starts or resets any clock (id = an objective's id to put
  // the time on that line, any other id for a line of its own; its expiry fires events[id]).
  countdowns() { return this.w.s.countdowns || (this.w.s.countdowns = {}); }
  setCountdown(id, seconds, label = null) {
    const c = this.countdowns();
    if (seconds === null || seconds === undefined || seconds === false) { delete c[id]; return; }
    c[id] = { until: this.w.s.t + seconds, total: seconds, label };
  }
  timeLeft(id) { const c = this.countdowns()[id]; return c ? Math.max(0, c.until - this.w.s.t) : null; }
  armDeadline(id) {
    const d = (this.def.objectives || []).find((o) => o.id === id);
    if (d && d.deadline && !this.countdowns()[id]) this.setCountdown(id, d.deadline, d.deadlineLabel || null);
  }
  updateCountdowns() {
    const c = this.w.s.countdowns;
    if (!c) return;
    for (const id of Object.keys(c)) {
      if (this.w.s.t < c[id].until) continue;
      delete c[id];
      const d = (this.def.objectives || []).find((o) => o.id === id);
      const o = d && this.obj(id);
      if (o) {
        if (o.state !== 'active') continue;
        if (typeof d.onExpire === 'string' && d.onExpire !== 'none' && d.onExpire !== 'fail') this.fireEvent({ ev: d.onExpire, data: { id } });
        else if (d.onExpire !== 'none') this.setObjective(id, 'failed');
      } else this.fireEvent({ ev: id, data: { id } });
      this.hook('onCountdown', id);
    }
  }

  hook(name, ...args) {
    const fn = this.def.script && this.def.script[name];
    if (fn) fn(this.api, ...args);
    // Built-in reactions shared by every mission.
    if (name === 'onKill' || name === 'onKo') this.checkKillObjectives();
  }

  update(dt) {
    const s = this.w.s;
    this.updateCountdowns();
    // Timers
    if (s.timers.length) {
      const due = s.timers.filter((t) => t.at <= s.t);
      if (due.length) {
        s.timers = s.timers.filter((t) => t.at > s.t);
        for (const t of due) this.fireEvent(t);
      }
    }
    // Triggers (checked 6 times a second)
    if (s.tick % 5 === 0) {
      for (const tr of this.def.triggers || []) {
        if (tr.once !== false && s.fired[tr.id]) continue;
        if (tr.after && !this.done(tr.after)) continue;
        let hit = false;
        if (tr.zone) hit = this.zoneHas(tr.zone, tr.who || 'hero');
        else if (tr.at !== undefined) hit = s.t >= tr.at;
        else if (tr.when) hit = tr.when(this.api);
        if (hit) { s.fired[tr.id] = (s.fired[tr.id] || 0) + 1; tr.do(this.api); }
      }
      this.checkObjectives();
    }
    if (this.winDelay !== null && !s.result) {
      this.winDelay -= dt;
      if (this.winDelay <= 0) this.w.win();
    }
  }

  fireEvent(t) {
    if (t.ev === '_chain') { this.w.explode(t.x, t.y, t.r, null, null, { quiet: !!t.quiet }); return; }
    const fn = this.def.events && this.def.events[t.ev];
    if (fn) fn(this.api, t.data);
  }

  // ---------- objectives ----------
  obj(id) { return this.w.s.objectives.find((o) => o.id === id); }
  done(id) { const o = this.obj(id); return !!o && o.state === 'done'; }
  setObjective(id, state) {
    const o = this.obj(id);
    if (!o || o.state === state) return;
    const was = o.state;
    o.state = state;
    if (state !== 'active' && this.w.s.countdowns) delete this.w.s.countdowns[id];
    if (state === 'active') this.armDeadline(id);
    if (state === 'done') {
      this.w.emit({ type: 'objective', id, state, text: o.text });
      this.hook('onObjective', id);
      // Reveal objectives that were waiting on this one.
      for (const d of this.def.objectives) if (d.after === id) this.setObjective(d.id, 'active');
    } else if (state === 'active' && was === 'hidden') {
      this.w.emit({ type: 'objective', id, state: 'new', text: o.text });
    } else if (state === 'failed') {
      this.w.emit({ type: 'objective', id, state, text: o.text });
      if (!o.optional) this.w.fail(`Objective failed: ${o.text}`);
    }
  }

  checkObjectives() {
    const w = this.w;
    for (const d of this.def.objectives || []) {
      const o = this.obj(d.id);
      if (!o || o.state !== 'active') continue;
      let ok = false;
      switch (d.type) {
        case 'reach': ok = this.zoneHas(d.zone, d.who || 'hero'); break;
        case 'item': ok = !!w.s.flags['item:' + d.item]; break;
        case 'flag': ok = !!w.s.flags[d.flag]; break;
        case 'destroy': {
          const n = d.things.filter((id) => w.thingState(id).destroyed || w.s.flags['destroyed:' + id]).length;
          const need = d.count || d.things.length;
          o.progress = `${Math.min(n, need)}/${need}`;
          ok = n >= need; break;
        }
        case 'mined': {
          const n = d.things.filter((id) => w.thingState(id).limpet).length;
          const need = d.count || d.things.length;
          o.progress = `${Math.min(n, need)}/${need}`;
          ok = n >= need; break;
        }
        case 'kill': {
          const tgt = w.ents.filter((e) => e.tag === d.tag);
          const n = tgt.filter((e) => e.state !== 'ok' || e.captive).length;
          o.progress = tgt.length > 1 ? `${n}/${tgt.length}` : null;
          ok = tgt.length > 0 && n === tgt.length; break;
        }
        case 'escort': {
          const npcs = w.ents.filter((e) => e.kind === 'npc' && (d.tag ? e.tag === d.tag : true));
          const alive = npcs.filter((e) => e.state === 'ok');
          const inZone = alive.filter((e) => this.inZone(d.zone, e));
          const need = d.count || npcs.length;
          o.progress = `${inZone.length}/${need}`;
          if (alive.length < need) { this.setObjective(d.id, 'failed'); continue; }
          ok = inZone.length >= need; break;
        }
        case 'extract': {
          const hs = w.heroes().filter((h) => h.state !== 'dead');
          ok = hs.length > 0 && hs.every((h) => h.state === 'ok' && this.inZone(d.zone, h));
          if (ok && d.withNpcs) ok = w.ents.filter((e) => e.kind === 'npc' && e.tag === d.withNpcs && e.state === 'ok').every((e) => this.inZone(d.zone, e));
          break;
        }
        case 'survive': ok = w.s.t >= (w.s.flags['surviveUntil:' + d.id] ?? d.seconds); break;
        case 'check': ok = !!d.check(this.api); break;
        default: break;
      }
      if (ok) this.setObjective(d.id, 'done');
    }
    // Victory: every required objective done.
    const req = w.s.objectives.filter((o) => !o.optional);
    if (req.length && req.every((o) => o.state === 'done') && this.winDelay === null && !w.s.result) this.winDelay = 2.5;
  }

  checkKillObjectives() { this.checkObjectives(); }

  // ---------- zones ----------
  zone(name) { return this.w.zones[name]; }
  inZone(name, u) {
    const z = this.w.zones[name];
    if (!z) return false;
    if (u.hidden && u.hidden.startsWith('b:')) return false;
    return u.x >= z.x && u.y >= z.y && u.x < z.x + z.w && u.y < z.y + z.h;
  }
  zoneHas(name, who) {
    const w = this.w;
    const heroes = w.heroes().filter((h) => h.state === 'ok');
    if (who === 'hero' || who === 'any') return heroes.some((h) => this.inZone(name, h));
    if (who === 'all') return heroes.length > 0 && heroes.every((h) => this.inZone(name, h));
    if (who === 'enemy') return w.liveEnemies().some((e) => this.inZone(name, e));
    if (who.startsWith('tag:')) return w.ents.some((e) => e.tag === who.slice(4) && e.state === 'ok' && this.inZone(name, e));
    return heroes.some((h) => h.hid === who && this.inZone(name, h));
  }
  inRestricted(u) {
    for (const [name, z] of Object.entries(this.w.zones)) if (z.restricted && this.inZone(name, u)) return true;
    return false;
  }

  // ---------- interactions ----------
  interactBlocked(h, t) {
    const it = t.interact;
    const st = this.w.thingState(t.id);
    if (st.used && !it.repeat) return 'Already done';
    if (st.destroyed) return 'Destroyed';
    if (st.busy && st.busy !== h.id) { const b = this.w.ent(st.busy); if (b && b.state === 'ok' && b.task && b.task.thing === t.id) return 'Someone is already at work there'; }
    if (it.after && !this.done(it.after)) return it.afterText || 'Not yet';
    if (h.kind === 'npc') {
      // An escorted specialist (interact.npc = his tag) does the job himself.
      if (!it.npc || h.tag !== it.npc) return it.whoText || 'Not for them';
    } else {
      if (it.npc && !it.heroToo) return this.helperFor(h, t) ? null : (it.npcText || 'Bring the one who knows how');
      if (it.who && !it.who.includes(h.hid)) return it.whoText || `Only ${it.who.join(' or ')} can do that`;
      if (it.need && !heroAbilities(h).includes(it.need) && !it.anyoneSlow) return it.needText || 'Needs the right specialist';
    }
    if (it.blocked) { const why = it.blocked(this.api, h); if (why) return why; }
    return null;
  }
  // The escorted NPC (tag interact.npc, following this hero) who will do an interaction for him.
  helperFor(h, t) {
    const tag = t.interact && t.interact.npc;
    if (!tag) return null;
    return this.w.ents.find((n) => n.kind === 'npc' && n.tag === tag && n.state === 'ok' && n.follow === h.id && !n.inVehicle && !(n.hidden && n.hidden.startsWith('b:'))) || null;
  }
  // `dur` is seconds, or a map by hero id (or NPC tag) with an optional `default`:
  // dur: { wrona: 2, default: 6 }.
  interactDuration(h, t) {
    const it = t.interact;
    let d = it.dur ?? 1;
    if (d && typeof d === 'object') d = d[h.hid] ?? d[h.tag] ?? d.default ?? 1;
    if (h.kind !== 'npc' && it.need && !heroAbilities(h).includes(it.need)) d *= 3; // e.g. forcing a lock without picks
    return d;
  }
  interact(h, t) {
    if (!t || h.state !== 'ok') return;
    const w = this.w, it = t.interact;
    const st = w.thingState(t.id);
    switch (it.kind) {
      case 'pickup':
        st.used = true; st.taken = true;
        w.s.flags['item:' + (it.item || t.id)] = h.hid || h.tag || true;
        w.emit({ type: 'item', thing: t.id, by: h.id, name: it.name || t.label });
        w.message(`${h.name} takes ${it.name || t.label || 'it'}.`, 'good');
        break;
      case 'door':
        if (h.carrying || it.hide !== false) { w.enterBuilding(h, t.building ? w.thingById.get(t.building) : t); return; }
        break;
      case 'rope': st.rope = true; st.used = true; w.rebuildFlags(); w.emit({ type: 'rope', thing: t.id }); break;
      case 'gate': st.open = !st.open; w.rebuildFlags(); w.emit({ type: 'gate', thing: t.id, open: st.open }); w.noise(h.x, h.y, 3, 'steps', h.id); break;
      case 'free': {
        const n = w.ents.filter((e) => e.kind === 'npc' && e.tag === it.npcs);
        n.forEach((e, i) => { e.follow = h.id; e.slot = i + 1; });
        st.used = true;
        w.emit({ type: 'freed', thing: t.id, by: h.id });
        break;
      }
      default:
        st.used = true;
        break;
    }
    if (it.flag) w.s.flags[it.flag] = true;
    // `grant: 'cutters'` (or a list): picking up the kit teaches the hero who did it.
    if (it.grant && h.kind === 'hero') for (const ab of [].concat(it.grant)) if (!h.abilities.includes(ab)) { h.abilities.push(ab); w.emit({ type: 'abilities', id: h.id }); }
    if (it.handler) this.def.handlers[it.handler](this.api, h, t);
    this.hook('onInteract', h, t);
    this.checkObjectives();
  }
}

function makeApi(w, m) {
  const api = {
    world: w,
    get t() { return w.s.t; },
    get difficulty() { return w.difficulty; },
    hard: () => DIFF_RANK[w.difficulty] >= 2,
    flag: (k, v) => { if (v === undefined) return w.s.flags[k]; w.s.flags[k] = v; return v; },
    msg: (text, kind) => w.message(text, kind),
    hint: (text, id) => w.emit({ type: 'hint', text, id }),
    say: (who, text, dur) => { const e = typeof who === 'string' ? (w.heroes().find((h) => h.hid === who) || api.ent(who)) : who; if (e) w.say(e.id, text, dur); },
    dialogue: (lines) => w.emit({ type: 'dialogue', lines }),
    objective: (id, state = 'done') => m.setObjective(id, state),
    done: (id) => m.done(id),
    at: (delay, ev, data) => w.s.timers.push({ at: w.s.t + delay, ev, data }),
    ent: (tag) => w.ents.find((e) => e.tag === tag),
    tagged: (tag) => w.ents.filter((e) => e.tag === tag),
    hero: (hid) => w.heroes().find((h) => h.hid === hid),
    heroes: () => w.heroes(),
    zoneHas: (z, who) => m.zoneHas(z, who),
    inZone: (z, u) => m.inZone(z, u),
    thing: (id) => w.thingById.get(id),
    thingState: (id) => w.thingState(id),
    destroy: (id) => w.destroyThing(w.thingById.get(id)),
    spawnEnemy: (def) => w.addEnt(makeEnemy(def, w.diff)),
    spawnNpc: (def) => w.addEnt(makeNpc(def)),
    spawnVehicle: (def) => w.addEnt(makeVehicle(def)),
    moveVehicle: (tag, x, y) => { const v = w.ents.find((e) => e.tag === tag && e.kind === 'vehicle'); if (v) w.routeTo(v, x, y); },
    alarm: (x, y) => w.raiseAlarm(x, y),
    alarmOn: () => w.s.alarm.on,
    focus: (x, y, zoom) => w.emit({ type: 'focus', x, y, zoom }),
    music: (mood) => w.emit({ type: 'music', mood }),
    sound: (name, x, y) => w.emit({ type: 'sound', name, x, y }),
    explode: (x, y, r, opts) => w.explode(x, y, r, null, null, opts || {}),
    countdown: (id, seconds, label) => m.setCountdown(id, seconds, label),
    // Visual-only shelling: flash, smoke and boom; no damage, no noise, no alarm.
    shell: (x, y, r = 2) => w.emit({ type: 'explosion', x, y, r, quiet: true, visual: true }),
    // Move, tilt, scale or hide a thing's model from a script (a dummy tank inflated, a hatch
    // lifted): { y, rx, ry, rz, scale, hidden }, relative to how it was built. Saved.
    thingVisual: (id, v) => { w.thingState(id).visual = v ? { ...v } : null; w.rebuildFlags(); w.emit({ type: 'thing-visual', thing: id }); },
    // Make guards with this tag turn and stare at a point (a scripted distraction), for `secs`.
    lookAt: (tag, x, y, secs = 3) => { for (const e of w.ents) if (e.tag === tag && e.kind === 'enemy' && e.state === 'ok') e.ai.notice = { x, y, t: secs, scripted: true }; },
    // Order guards (or allied fighters) with this tag to hold or open fire.
    holdFire: (tag, on = true) => { for (const e of w.ents) if (e.tag === tag) e.holdFire = !!on; },
    // An aircraft crossing (optionally strafing): see World.addFlyover.
    flyover: (opts) => w.addFlyover(opts || {}),
    // Change the weather mid-mission ('clear', 'rain', 'snow', 'fog', 'storm', 'blizzard'…): vision,
    // noise, footprints and the scene follow.
    weather: (kind) => w.setWeather(kind),
    // Change the light mid-mission (moonrise, dawn breaking): 'dawn' | 'morning' | 'day' | 'dusk' | 'night'.
    timeOfDay: (tod, seconds) => w.setTimeOfDay(tod, seconds),
    time: (tod, seconds) => w.setTimeOfDay(tod, seconds),
    // Give or take an ability (saved with the hero): api.grant('wrona', 'cutters').
    grant: (hid, ab) => { const h = w.heroes().find((x) => x.hid === hid); if (h && !h.abilities.includes(ab)) { h.abilities.push(ab); w.emit({ type: 'abilities', id: h.id }); } },
    revoke: (hid, ab) => { const h = w.heroes().find((x) => x.hid === hid); if (h) { h.abilities = h.abilities.filter((a) => a !== ab); w.emit({ type: 'abilities', id: h.id }); } },
    // An area hazard (gas, smoke, burning oil): see World.addHazard.
    hazard: (x, y, opts) => w.addHazard(x, y, opts || {}),
    // Switch a lamp or searchlight (by id) on or off: its pool of light and the vision it gives go with it.
    light: (id, on) => { w.thingState(id).lightOff = !on; w.rebuildFlags(); w.emit({ type: 'light', thing: id, on: !!on }); },
    timeLeft: (id) => m.timeLeft(id),
    flare: (x, y, opts) => w.addFlare(x, y, opts || {}),
    win: () => w.win(),
    fail: (reason) => w.fail(reason),
    center: (id) => thingCenter(w.thingById.get(id)),
    orderNpc: (tag, x, y) => { for (const e of w.ents) if (e.tag === tag) { e.follow = null; e.task = null; e.act = null; w.routeTo(e, x, y); } },
    rng: () => w.rng.next(),
  };
  return api;
}
