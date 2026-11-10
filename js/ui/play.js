import { TICK, DIFFICULTY, F } from '../core/constants.js';
import { World } from '../core/world.js';
import { buildMission } from '../core/builder.js';
import { CAP } from '../core/grid.js';
import { inspectRoute, fieldStatus } from '../core/recon.js';
import { ABILITIES, abilityBar, targetKind, dropBody, heroAbilities } from '../core/abilities.js';
import { GameRenderer } from '../render/scene.js';
import { icon } from './icons.js';
import { attachPlaytest } from './playtest.js';

// The playable mission: game loop, HUD and input (mouse, keyboard, touch).

const ABILITY_KEYS = ['z', 'x', 'c', 'v', 'b', 'n'];

export class PlayScreen {
  constructor(app, meta, def, content, opts) {
    this.app = app; this.meta = meta; this.def = def; this.content = content || {};
    this.difficulty = opts.difficulty || 'normal';
    this.save = opts.save || null;
    this.selected = new Set(); this.primaryId = null;
    this.targeting = null; this.planning = false; this.paused = false;
    this.showAllCones = false;
    this.acc = 0; this.last = 0; this.running = false;
    this.toasts = [];
    this.subtitleQueue = [];
  }

  // ---------- lifecycle ----------
  async enter(root) {
    this.root = root;
    root.innerHTML = `
      <div class="play">
        <div class="viewport"></div>
        <div class="hud">
          <div class="hud-top-left">
            <div class="mission-chip"><span class="mc-date"></span><span class="mc-title"></span></div>
            <div class="objectives"></div>
          </div>
          <div class="hud-top-right">
            <button class="hb" data-act="cones" title="Show all view cones (Tab)">${icon('eye')}</button>
            <button class="hb" data-act="shadow" title="Shadow Mode: plan simultaneous actions (T)">${icon('shadow')}</button>
            <button class="hb" data-act="rotl" title="Rotate view (Q)">${icon('rotl')}</button>
            <button class="hb" data-act="rotr" title="Rotate view (E)">${icon('rotr')}</button>
            <button class="hb" data-act="save" title="Quick save (F5)">${icon('save')}</button>
            <button class="hb" data-act="load" title="Quick load (F9)">${icon('load')}</button>
            <button class="hb" data-act="pause" title="Pause (Space)">${icon('pause')}</button>
            <button class="hb" data-act="menu" title="Menu (Esc)">${icon('menu')}</button>
          </div>
          <div class="alarm-banner hidden"><span class="ab-text">ALARM</span><span class="ab-time"></span></div>
          <div class="pending-banner hidden">! <span></span></div>
          <div class="plan-banner hidden">SHADOW MODE: give each hero one action, then <button class="hb go" data-act="go">${icon('go')} EXECUTE</button></div>
          <div class="pause-banner hidden">PAUSED: orders can still be given</div>
          <div class="target-hint hidden"><span></span><button class="hb" data-act="cancel">${icon('close')}</button></div>
          <div class="route-panel hidden" aria-live="polite"><b>RECON / ROUTE PLANNER</b><p class="route-summary">Choose open ground to inspect a route.</p><small class="route-detail"></small><div><button data-act="route-go">Move this route</button><button data-act="route-cancel">Cancel</button></div><small>Current sightlines only. Patrols, sound and escorts can change the risk.</small></div>
          <div class="hint-card hidden"><span class="hc-tag">FIELD NOTE</span><p></p><button class="hb" data-act="hint-ok">OK</button></div>
          <div class="feed"></div>
          <div class="subtitle hidden"></div>
          <div class="toast-zone"></div>
          <div class="hud-bottom">
            <div class="field-status" aria-live="polite"><span></span><i><em></em></i></div>
            <div class="portraits"></div>
            <div class="command-tray"><div class="tactical-tools"></div><div class="abilities"></div></div>
            <div class="minimap-wrap"><canvas class="minimap"></canvas></div>
          </div>
          <div class="tooltip hidden"></div>
        </div>
        <div class="overlay hidden"></div>
      </div>`;
    this.$ = (sel) => root.querySelector(sel);
    this.viewport = this.$('.viewport');
    if (this.app.demo) this.viewport.insertAdjacentHTML('afterend', `<div class="demo-loading"><span>${this.meta.country} · ${this.app.formatDate(this.meta.date)}</span><b>${this.meta.title}</b><i></i><span>Preparing the battlefield…</span></div>`);
    this.buildWorld();
    this.renderer = await GameRenderer.create(this.viewport, this.world, this.built, { quality: this.app.settings.quality }, (message) => {
      const status = this.root.querySelector('.demo-loading span:last-child');
      if (status) status.textContent = message;
    });
    if (this.exited) { this.renderer.dispose(); return; }
    this.initHud();
    this.bindInput();
    attachPlaytest(this);   // Report button + perf sampler (?perf=1 overlay); see ui/playtest.js
    const positionHint = () => {
      const top = Math.max(this.$('.hud-top-left').getBoundingClientRect().bottom, this.$('.hud-top-right').getBoundingClientRect().bottom) - root.getBoundingClientRect().top + 12;
      root.style.setProperty('--hint-top', `${top}px`);
    };
    this.hintObserver = new ResizeObserver(positionHint);
    this.hintObserver.observe(this.$('.hud-top-left')); this.hintObserver.observe(this.$('.hud-top-right'));
    positionHint();
    if (this.renderer.painted) this.root.querySelectorAll('[data-act="rotl"], [data-act="rotr"]').forEach((b) => b.remove());
    if (new URLSearchParams(location.search).get('plate')) {
      this.paused = true;
      this.root.querySelector('.hud').style.display = 'none';
      this.renderer.setPlateMode(true);
      window.__plate = { tiles: (z, o) => this.renderer.plateTiles(z, o), render: (x, z, zoom) => this.renderer.renderPlate(x, z, zoom) };
      this.running = false;
    }
    const first = this.world.heroes()[0];
    if (first) { this.select(first.id); this.renderer.focus(first.x, first.y, 20); }
    if (this.def.cameraStart) this.renderer.focus(...this.def.cameraStart);
    if (this.app.forestDemo && this.meta.id === 'm01') this.renderer.focus(this.save && first ? first.x : 8, this.save && first ? first.y : 46, 18);
    this.startAudio();
    this.setMarkers();
    this.root.querySelector('.demo-loading')?.remove();
    if (!this.save) {
      this.autosave();
      const lines = (this.content.dialogue || []).filter((l) => this.world.heroes().some((h) => h.hid === l.who));
      if (this.app.demo) {
        this.demoDialogue = lines;
        const touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
        const lessons = { m01: 'Move Wrona through the trees.', m02: 'Tap the civilians to have them follow. Keep the whole party out of view.', m03: 'Use Kit’s distractions and lockpicks. No killing in neutral Uruguay.', m04: 'Switch between Wrona and Kit. Shadow Mode queues coordinated actions.', m05: 'Use Haugland’s charges. Wait for every gold truck before blowing the bridge.', m06: 'Kit can take a uniform from a subdued guard. Officers can see through it.', m07: 'Use Prys’s rifle and Ndiaye’s strength. Watch the evacuation clock.', m08: 'Ndiaye can drive. Protect the scientists, cargo and ship.', m09: 'Use Li Mei’s scout ability and firecrackers to read and divert patrols.', m10: 'Paddle quietly. Plant the charges, then clear the blast.' };
        this.openOverlay(`<div class="demo-arrival"><div class="demo-eyebrow">${this.meta.place} / ${this.app.formatDate(this.meta.date)}</div><h1>${this.meta.title}</h1><div class="demo-arrival-controls"><div><b>THIS OPERATION</b>${lessons[this.meta.id] || 'Select a hero, then choose a destination.'}</div><div><b>${touch ? 'Tap an enemy' : 'Click an enemy'}</b>Read his view cone before moving.</div><div><b>${touch ? 'The pause button' : 'Space to pause'}</b>Take your time. Give orders while paused.</div></div><button class="demo-primary" data-o="demo-start">I’m ready <span>→</span></button></div>`);
        this.$('.overlay').classList.add('demo-arrival-overlay');
      } else if (lines.length) setTimeout(() => !this.exited && this.queueDialogue(lines), 1200);
    }
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  exit() {
    this.exited = true;
    this.running = false;
    this.hintObserver?.disconnect();
    clearTimeout(this.longT); clearTimeout(this.curT);
    if (!this.renderer) return;
    cancelAnimationFrame(this.raf);
    this.unbindInput();
    this.app.sfx.stopAmbience();
    this.renderer.dispose();
  }

  buildWorld() {
    const M = buildMission(this.def, this.app.heroData, this.difficulty);
    const diff = DIFFICULTY[this.difficulty];
    if (!this.save) for (const h of this.def.heroes) M.hero(h, diff);
    this.built = M.result();
    this.world = new World(this.def, this.built, this.difficulty, this.save ? this.save.s : null);
    if (this.save) this.world.s.stats.saves = (this.world.s.stats.saves || 0);
  }

  startAudio() {
    const d = this.def;
    const amb = [...(d.ambience || [])];
    if (!d.ambience) {
      if (d.weather === 'storm') amb.push('storm');
      else if (d.weather === 'rain') amb.push('rain');
      if (d.weather === 'snow' || d.weather === 'blizzard' || /snow|fjord/.test(d.biome || '')) amb.push('wind');
      else amb.push('breeze');
      if (d.time === 'night') amb.push('crickets'); else if (d.time === 'dawn' || d.time === 'day' || d.time === 'morning') amb.push('birds');
      if (/harbou?r|coast|fjord|docks|port|estuary|ship|uboat|beach|island|naval|bay|shore|mouth|cliff|sea/.test(d.biome || '')) amb.push('sea');
      amb.push('artillery');
    }
    this.app.sfx.startAmbience(amb);
    this.app.music.setTheatre(this.meta.theatre, d.time === 'night');
    this.app.music.setMood('explore', true);
  }

  // ---------- main loop ----------
  loop(now) {
    if (!this.running) return;
    // rAF can hand the first frame a timestamp from before `last`: never let time run backwards.
    const dt = Math.max(0, Math.min(0.1, (now - this.last) / 1000));
    this.last = now;
    const w = this.world;
    if (!this.paused && !this.overlayOpen) {
      this.acc += dt * (this.app.settings.speed || 1);
      let steps = 0;
      while (this.acc >= TICK && steps < 5) {
        for (const e of w.ents) { if (!e._prev) e._prev = {}; e._prev.x = e.x; e._prev.y = e.y; e._prev.a = e.a; }
        w.step();
        this.handleEvents();
        this.acc -= TICK; steps++;
      }
      if (steps === 5) this.acc = 0;
    } else {
      for (const e of w.ents) if (e._prev) { e._prev.x = e.x; e._prev.y = e.y; e._prev.a = e.a; }
      this.handleEvents();
    }
    // Planned second steps fire once their hero has finished the first.
    if (!this.paused && !this.overlayOpen && this.followUps && this.followUps.size) for (const [id, f] of this.followUps) {
      const h = w.ent(id);
      if (!h || h.state !== 'ok') { this.followUps.delete(id); continue; }
      if (f.wait > 0) { f.wait--; continue; }             // let the first order get going
      if (!h.order && !h.act && !h.path) { this.followUps.delete(id); this.execute(h, f.order); }
    }
    this.keyPan(dt);
    const L = this.app.audio.listener;
    L.x = this.renderer.camTarget.x; L.y = this.renderer.camTarget.z; L.zoom = this.renderer.zoom; L.yaw = this.renderer.yaw;
    this.renderer.render(dt, this.paused ? 1 : Math.min(1, this.acc / TICK), this);
    this.hudFrame(dt);
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  // ---------- world events -> audio / fx / hud ----------
  handleEvents() {
    const w = this.world, sfx = this.app.sfx, r = this.renderer;
    for (const ev of w.events) {
      r.worldEvent(ev);
      const e = ev.id ? w.ent(ev.id) : null;
      switch (ev.type) {
        case 'noise': if (ev.kind !== 'shot' && ev.kind !== 'explosion' && ev.kind !== 'shout') r.overlays.addNoise(ev.x, ev.y, ev.r, ev.kind); else if (ev.kind === 'shot') r.overlays.addNoise(ev.x, ev.y, ev.r, ev.kind); break;
        case 'shot': {
          const from = w.ent(ev.from), to = w.ent(ev.to);
          if (from && to) {
            const quiet = ev.weapon === 'welrod' || ev.weapon === 'silentrifle';
            r.fx.muzzle(from, to, ev.hit, quiet);
            if (ev.i === undefined || ev.i === 0) sfx.play(quiet ? 'suppressed' : ev.weapon === 'mg' ? 'mg' : ev.weapon === 'bren' ? 'bren' : ev.weapon === 'pistol' ? 'pistol' : 'rifle', from.x, from.y, { gap: 0.05 });
            if (!ev.hit && !quiet) sfx.play('ricochet', to.x, to.y, { vol: 0.5 });
          }
          break;
        }
        case 'burst': { const from = w.ent(ev.from); if (from) { sfx.play('bren', from.x, from.y); for (let i = 0; i < 4; i++) r.fx.muzzle(from, { x: ev.x + (Math.random() - 0.5) * 2, y: ev.y + (Math.random() - 0.5) * 2 }, false, false); } break; }
        case 'explosion': r.fx.explosion(ev.x, ev.y, ev.r); sfx.play('explosion', ev.x, ev.y, { vol: ev.visual ? 0.8 : 1.2, wet: 0.35 }); break;
        case 'strafe': r.fx.dust(ev.x, ev.y, 6); r.fx.dust(ev.x + Math.cos(ev.a) * 1.5, ev.y + Math.sin(ev.a) * 1.5, 5); sfx.play('mg', ev.x, ev.y, { gap: 0.2 }); break;
        case 'flyover': sfx.play('aircraft', undefined, undefined, { ui: true }); break;
        case 'flare': sfx.play('flare', ev.x, ev.y); break;
        case 'gate': { const t = w.thingById.get(ev.thing); if (t) sfx.play('gate', t.x, t.y); break; }
        case 'light': { const t = w.thingById.get(ev.thing); if (t && ev.on && t.kind === 'searchlight') sfx.play('searchlight', t.x, t.y); break; }
        case 'say': r.label(ev.id, ev.text, e && e.kind === 'hero' ? 'hero' : 'say', ev.dur); break;
        case 'message': this.feed(ev.text, ev.kind); break;
        case 'alarm':
          if (ev.on) { sfx.play('alarm', undefined, undefined, { ui: true, vol: 0.9 }); this.app.music.setMood('alarm'); }
          else this.app.music.setMood('explore');
          break;
        case 'alarm-pending': sfx.play('spotted', undefined, undefined, { ui: true, vol: 0.6 }); break;
        case 'spotted': if (!w.s.alarm.on) this.app.music.setMood('tension'); break;
        case 'notice': sfx.play('notice', e && e.x, e && e.y, { vol: 0.6, gap: 0.4 }); break;
        case 'objective':
          if (ev.state === 'done') { sfx.play('objective', undefined, undefined, { ui: true }); this.toast(`✓ ${ev.text}`, 'good'); this.autosave(); this.setMarkers(); }
          else if (ev.state === 'new') { this.toast(`New objective: ${ev.text}`, 'info'); sfx.play('bell', undefined, undefined, { ui: true, vol: 0.5 }); this.setMarkers(); }
          else if (ev.state === 'failed') this.toast(`✗ ${ev.text}`, 'danger');
          break;
        case 'kill': if (e) { sfx.play(ev.how === 'knife' || ev.how === 'kukri' || ev.how === 'bolo' ? 'knife' : 'fall', e.x, e.y); if (ev.how !== 'explosion') sfx.play('fall', e.x, e.y, { delay: 0.1 }); } break;
        case 'ko': if (e) { sfx.play(ev.how === 'chloroform' ? 'fall' : 'punch', e.x, e.y); } break;
        case 'hit': if (e) { sfx.play('hit', e.x, e.y); if (e.kind === 'hero') this.flashPortrait(e.id); } break;
        case 'down': this.toast(`${e ? e.name : 'A hero'} is down!`, 'danger'); break;
        case 'result': setTimeout(() => this.showResult(ev.result, ev.reason), ev.result === 'won' ? 1800 : 1400); this.app.music.setMood(ev.result === 'won' ? 'victory' : 'defeat'); break;
        case 'dialogue': this.queueDialogue(ev.lines); break;
        case 'hint': this.showHint(ev.text); break;
        case 'focus': r.focus(ev.x, ev.y, ev.zoom); break;
        case 'music': this.app.music.setMood(ev.mood); break;
        case 'sound': sfx.play(ev.name, ev.x, ev.y); break;
        case 'reveal': r.reveal(ev.x, ev.y, ev.r, ev.dur); break;
        case 'routes': r.overlays.showRoutes(w.enemies().filter((x) => Math.hypot(x.x - ev.x, x.y - ev.y) < ev.r)); clearTimeout(this.routeT); this.routeT = setTimeout(() => r.overlays.hideRoutes(), ev.dur * 1000); break;
        case 'throw': { const h = w.ents.find((u) => Math.hypot(u.x - ev.sx, u.y - ev.sy) < 0.01); if (h) h._throwT = performance.now(); sfx.play('throw', ev.sx, ev.sy); break; }
        case 'land': if (ev.kind === 'stone') { sfx.play('stone', ev.x, ev.y); r.fx.dust(ev.x, ev.y, 4); } else sfx.play('stone', ev.x, ev.y, { vol: 0.5 }); break;
        case 'firecracker': sfx.play('firecracker', ev.x, ev.y); r.fx.firecrackers(ev.x, ev.y); break;
        case 'whistle': if (e) sfx.play('whistle', e.x, e.y); break;
        case 'charge': case 'limpet': sfx.play('charge', ev.x, ev.y); break;
        case 'cut': { const t = w.thingById.get(ev.thing); sfx.play('cut', t && t.tiles[0][0], t && t.tiles[0][1]); break; }
        case 'enter': case 'exit': if (e) sfx.play('door', e.x, e.y); break;
        case 'item': { const t = w.thingById.get(ev.thing); sfx.play('pickup', undefined, undefined, { ui: true }); if (t) r.fx.sparkle(t.x + 0.5, t.y + 0.5); break; }
        case 'cant': this.toast(e && e.swimming === false && ev.x !== undefined ? 'Can\'t get there' : 'Can\'t get there', 'warn', 1.2); break;
        case 'deny': this.toast(ev.text, 'warn', 1.4); break;
        case 'pickup': case 'drop': if (e) sfx.play('step', e.x, e.y); if (ev.hidden === 'water' && e) r.fx.splash(e.x, e.y); break;
        case 'freed': this.toast('They will follow you.', 'good'); break;
        case 'recruited': { const by = w.ent(ev.by); if (e) this.toast(`${e.name} follows ${by ? by.name : 'you'}.`, 'info', 1.2); break; }
        case 'board': case 'disembark': if (e) sfx.play('door', e.x, e.y, { vol: 0.7 }); this.hudDirty = true; break;
        case 'abilities': this.hudDirty = true; break;
        case 'vehicle-destroyed': this.toast('Vehicle destroyed!', 'danger'); break;
        case 'revived': this.toast(`${e ? e.name : 'Hero'} is back on their feet.`, 'good'); break;
        case 'wake': this.toast('A guard has come round!', 'warn'); break;
        case 'death': if (e && e.kind === 'npc') this.toast(`${e.name} has been killed.`, 'danger'); break;
        default: break;
      }
    }
    w.events.length = 0;
  }

  // ---------- selection & orders ----------
  selectedSet() { return this.selected; }
  primary() { return this.world.ent(this.primaryId); }
  select(id, add = false) {
    this.cancelRoute();
    if (!add) this.selected.clear();
    const h = this.world.ent(id);
    if (!h || h.kind !== 'hero') return;
    if (add && this.selected.has(id)) { this.selected.delete(id); if (this.primaryId === id) this.primaryId = [...this.selected][0] || null; }
    else { this.selected.add(id); this.primaryId = id; }
    this.cancelTargeting();
    this.app.sfx.play('click', undefined, undefined, { ui: true });
    this.hudDirty = true;
  }

  // Issue (or plan, in Shadow Mode) an order for a hero.
  issue(h, order) {
    const w = this.world;
    if (this.planning) {
      // A hero working alone may plan two steps (walk up, then strike): the second runs as soon
      // as the first is finished. With several heroes in the plan, a new order replaces the old.
      const solo = !this.world.heroes().some((o) => o !== h && o.shadow);
      if (h.shadow && solo && !h.shadow2) { h.shadow2 = order; this.toast(`${h.name}: second action planned`, 'info', 1); this.hudDirty = true; return true; }
      h.shadow = order; h.shadow2 = null;
      this.toast(`${h.name}: action planned`, 'info', 1);
      this.hudDirty = true;
      return true;
    }
    return this.execute(h, order);
  }
  execute(h, o) {
    const w = this.world;
    if (o.type === 'move') return w.orderMove(h, o.x, o.y, o.run);
    if (o.type === 'ability') return w.orderAbility(h, o.ab, o.target, o.sync);
    if (o.type === 'recruit') return w.orderRecruit(h, o.npc);
    if (o.type === 'interact') return w.orderInteract(h, o.thing);
    if (o.type === 'board') return w.orderBoard(h, o.veh);
    return false;
  }
  executePlan() {
    let n = 0;
    // Strikes and shots planned together land on the same tick.
    const STRIKES = ['knife', 'kukri', 'bolo', 'punch', 'chloroform', 'pistol', 'welrod', 'rifle', 'silentrifle', 'surrender'];
    const strikers = this.world.heroes().filter((h) => h.shadow && h.shadow.type === 'ability' && STRIKES.includes(h.shadow.ab));
    if (strikers.length > 1) { const id = 'sync' + this.world.s.tick; for (const h of strikers) h.shadow = { ...h.shadow, sync: id }; }
    for (const h of this.world.heroes()) if (h.shadow) {
      this.execute(h, h.shadow); h.shadow = null; n++;
      if (h.shadow2) { (this.followUps || (this.followUps = new Map())).set(h.id, { order: h.shadow2, wait: 2 }); h.shadow2 = null; }
    }
    this.planning = false;
    this.paused = false;
    if (n) this.toast(`Shadow Mode: ${n} action${n > 1 ? 's' : ''} executed`, 'good');
    this.hudDirty = true;
  }

  beginTargeting(abId) {
    this.cancelRoute();
    const h = this.primary();
    if (!h || h.state !== 'ok') return;
    const kind = targetKind(this.world, h, abId);
    if (kind === 'none') {
      const ab = ABILITIES[abId];
      if (abId === 'carry' && h.carrying) { dropBody(this.world, h); return; }
      const why = ab.check ? ab.check(this.world, h, null) : null;
      if (why) { this.toast(why, 'warn'); return; }
      if (this.planning) { h.shadow = { type: 'ability', ab: abId, target: null }; this.hudDirty = true; return; }
      this.world.orderAbility(h, abId, null);
      this.hudDirty = true;
      return;
    }
    if (this.targeting && this.targeting.ab === abId) { this.cancelTargeting(); return; }
    this.targeting = { ab: abId, kind, hero: h.id };
    const what = { enemy: 'an enemy', body: 'a body', ground: 'a spot on the ground', thing: 'a target', hero: 'a fallen comrade' }[kind];
    this.$('.target-hint span').textContent = `${ABILITIES[abId].name}: choose ${what}`;
    this.$('.target-hint').classList.remove('hidden');
    this.renderer.overlays.showRange(h, ABILITIES[abId].range);
    this.hudDirty = true;
  }
  cancelTargeting() {
    this.targeting = null;
    if (this.$) { this.$('.target-hint').classList.add('hidden'); this.renderer && this.renderer.overlays.showRange(null); this.renderer && this.renderer.overlays.showCursor(null); }
    this.hudDirty = true;
  }

  // A click/tap on the map at screen position (sx, sy).
  clickAt(sx, sy, { run = false, add = false, long = false } = {}) {
    const w = this.world, r = this.renderer;
    if (w.s.result) return;
    this.app.unlockAudio();
    const h = this.primary();
    if (this.routeMode) { const p = r.groundAt(sx, sy); this.previewRoute(p.x, p.y, run); return; }
    // Targeting an ability?
    if (this.targeting) {
      const tg = this.targeting;
      const hero = w.ent(tg.hero);
      if (!hero) return this.cancelTargeting();
      let target = null;
      if (tg.kind === 'enemy') { const e = r.pickUnit(sx, sy, 40, (u) => u.kind === 'enemy' && u.state === 'ok'); if (e) target = { ent: e.id }; }
      else if (tg.kind === 'body') { const e = r.pickUnit(sx, sy, 40, (u) => u.kind === 'enemy' && u.state !== 'ok' && !u.carriedBy); if (e) target = { ent: e.id }; }
      else if (tg.kind === 'hero') { const e = r.pickUnit(sx, sy, 40, (u) => u.kind === 'hero' && u.state === 'down'); if (e) target = { ent: e.id }; }
      else if (tg.kind === 'thing') {
        const t = r.pickThing(sx, sy);
        if (t) target = { thing: t.id };
        else if (ABILITIES[tg.ab].alsoGround) { const p = r.groundAt(sx, sy); target = { x: p.x, y: p.y }; }
      } else if (tg.kind === 'ground') { const p = r.groundAt(sx, sy); target = { x: p.x, y: p.y }; }
      if (!target) { this.toast('Not a valid target', 'warn', 1); return; }
      this.issue(hero, { type: 'ability', ab: tg.ab, target });
      if (!(add && tg.kind === 'ground')) this.cancelTargeting();
      return;
    }
    // Clicked a hero: select it.
    const hero = r.pickUnit(sx, sy, 34, (u) => u.kind === 'hero' && u.state !== 'dead');
    if (hero && !(h && hero.state === 'down' && h.id !== hero.id)) { this.select(hero.id, add); return; }
    if (hero && h && hero.state === 'down') { this.issue(h, { type: 'ability', ab: 'revive', target: { ent: hero.id } }); return; }
    // Clicked a vehicle or boat: climb aboard.
    const veh = r.pickUnit(sx, sy, 46, (u) => u.kind === 'vehicle' && u.state === 'ok' && u.seats > 0);
    if (veh && h && !h.inVehicle && !this.targeting) { this.issue(h, { type: 'board', veh: veh.id }); return; }
    // Clicked an enemy: toggle its view cone (never attacks by accident).
    const enemy = r.pickUnit(sx, sy, 30, (u) => u.kind === 'enemy' && u.state === 'ok');
    if (enemy) {
      if (r.shownCones.has(enemy.id)) r.shownCones.delete(enemy.id); else r.shownCones.add(enemy.id);
      this.app.sfx.play('hover', undefined, undefined, { ui: true });
      return;
    }
    if (!h) return;
    // Bodies: an unconscious man is tied up first (if the hero can), then carried on a second
    // click; the dead and the bound are carried. The Carry button picks up any body directly.
    const body = r.pickUnit(sx, sy, 30, (u) => u.kind === 'enemy' && u.state !== 'ok' && !u.carriedBy);
    if (body) {
      const abs = heroAbilities(h);
      if (h.carrying) { /* fall through to move */ }
      else if (body.state === 'ko' && !body.tied && abs.includes('tie')) { this.issue(h, { type: 'ability', ab: 'tie', target: { ent: body.id } }); return; }
      else if (abs.includes('carry')) { this.issue(h, { type: 'ability', ab: 'carry', target: { ent: body.id } }); return; }
      else if (body.item) { this.issue(h, { type: 'ability', ab: 'search', target: { ent: body.id } }); return; }
      else { this.issue(h, { type: 'ability', ab: 'carry', target: { ent: body.id } }); return; }      // drag it
    }
    // NPCs: toggle following.
    const npc = r.pickUnit(sx, sy, 30, (u) => u.kind === 'npc' && u.state === 'ok');
    if (npc && npc.role !== 'civilian') {
      if (npc.follow === h.id) { npc.follow = null; npc.path = null; npc.task = null; npc.act = null; this.toast(`${npc.name} will wait here.`, 'info', 1.2); }
      else if (!npc.locked) {
        // The hero has to walk up and speak to him first.
        if (this.issue(h, { type: 'recruit', npc: npc.id }) && !this.planning) this.toast(`${h.name} goes to fetch ${npc.name}.`, 'info', 1.2);
      }
      return;
    }
    // Things with an interaction.
    const t = r.pickThing(sx, sy);
    if (t && t.interact && !(t.interact.kind === 'door' && !h.carrying && t.interact.hide === false)) {
      this.issue(h, { type: 'interact', thing: t.id });
      return;
    }
    // Ground: move the selection (spread out for groups).
    const p = r.groundAt(sx, sy);
    if (r.terrain.opts.preciseWater && !h.inVehicle && w.grid.has(Math.floor(p.x), Math.floor(p.y), F.DEEP) && !(w.caps(h) & CAP.SWIM)) {
      this.toast(this.meta.id === 'm01' ? 'Deep water — use the bridge or one of the two gravel fords.' : 'Deep water — find a crossing or board a boat.', 'warn', 3.5);
      r.overlays.showCursor(p, 0xff735c);
      clearTimeout(this.curT); this.curT = setTimeout(() => r.overlays.showCursor(null), 900);
      return;
    }
    let sel = [...this.selected].map((id) => w.ent(id)).filter((u) => u && u.state === 'ok');
    // Aboard a vehicle only its driver steers; the others just ride.
    const drivers = sel.filter((u) => u.inVehicle && w.ent(u.inVehicle) && w.ent(u.inVehicle).driver === u.id);
    sel = sel.filter((u) => !u.inVehicle || drivers.includes(u) || (sel.length === 1));
    sel.forEach((u, i) => {
      const off = i === 0 ? [0, 0] : [[0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9], [0.9, 0.9]][(i - 1) % 5];
      this.issue(u, { type: 'move', x: p.x + off[0], y: p.y + off[1], run: run || long });
    });
    if (r.terrain.opts.preciseWater && r.terrain.isFord(Math.floor(p.x), Math.floor(p.y))) this.toast('Shallow ford — wading is slower and makes noise.', 'info', 2.5);
    if (sel.length) { r.overlays.showCursor(p, run || long ? 0xffb04a : 0xffffff); clearTimeout(this.curT); this.curT = setTimeout(() => r.overlays.showCursor(null), 500); }
  }

  hoverAt(sx, sy) {
    const r = this.renderer, w = this.world;
    const enemy = r.pickUnit(sx, sy, 30, (u) => u.kind === 'enemy' && u.state === 'ok');
    r.hoverEnemy = enemy ? enemy.id : null;
    let tip = null;
    let cursor = 'default';
    const h = this.primary();
    if (this.targeting) {
      cursor = 'crosshair';
      if (this.targeting.kind === 'ground') { const p = r.groundAt(sx, sy); r.overlays.showCursor(p, 0xffd36b); }
    } else if (enemy) { tip = `${enemy.name}${enemy.ai.mode === 'distracted' ? ' (distracted)' : ''}`; cursor = 'help'; }
    else if (r.pickUnit(sx, sy, 46, (u) => u.kind === 'vehicle' && u.state === 'ok' && u.seats > 0)) { const v = r.pickUnit(sx, sy, 46, (u) => u.kind === 'vehicle' && u.state === 'ok' && u.seats > 0); tip = `Board the ${v.vtype} (${v.passengers.length}/${v.seats})`; cursor = 'pointer'; }
    else {
      const t = r.pickThing(sx, sy);
      if (t && t.interact && h) {
        const st = w.s.objs[t.id] || {};
        if (!(t.type === 'item' && st.taken)) { tip = `${t.interact.verb || 'Use'}${t.label ? ' ' + t.label : ''}`; cursor = 'pointer'; }
      } else if (t && t.label && (t.destructible || t.limpet)) tip = t.label + (w.s.objs[t.id] && w.s.objs[t.id].destroyed ? ' (destroyed)' : '');
      const body = r.pickUnit(sx, sy, 28, (u) => u.kind === 'enemy' && u.state !== 'ok' && !u.carriedBy);
      if (body) {
        const abs = h ? heroAbilities(h) : [];
        const act = body.state === 'ko' && !body.tied && abs.includes('tie') ? ' (click: tie up)' : abs.includes('carry') ? ' (click: carry)' : body.item ? ' (click: search)' : ' (click: drag)';
        tip = (body.state === 'ko' ? (body.tied ? 'Bound and gagged' : 'Unconscious') : 'Dead') + act; cursor = 'pointer';
      }
    }
    const el = this.$('.tooltip');
    if (tip) { el.textContent = tip; el.classList.remove('hidden'); el.style.transform = `translate(${sx + 16}px, ${sy + 12}px)`; } else el.classList.add('hidden');
    this.viewport.style.cursor = cursor;
  }

  // ---------- input ----------
  bindInput() {
    const c = this.viewport;
    this.pointers = new Map();
    this.onDown = (ev) => {
      c.setPointerCapture && c.setPointerCapture(ev.pointerId);
      this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, sx: ev.clientX, sy: ev.clientY, t: performance.now(), button: ev.button, type: ev.pointerType, moved: false });
      if (this.pointers.size === 2) { clearTimeout(this.longT); const [a, b] = [...this.pointers.values()]; a.moved = b.moved = true; this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; }
      if (ev.pointerType === 'touch' && this.pointers.size === 1) {
        clearTimeout(this.longT);
        this.longT = setTimeout(() => {
          const p = this.pointers.get(ev.pointerId);
          if (p && !p.moved) { p.long = true; this.longPress(p.x, p.y); }
        }, 520);
      }
    };
    this.onMove = (ev) => {
      const p = this.pointers.get(ev.pointerId);
      if (!p) { if (ev.pointerType === 'mouse') this.hoverAt(ev.clientX, ev.clientY); return; }
      const dx = ev.clientX - p.x, dy = ev.clientY - p.y;
      p.x = ev.clientX; p.y = ev.clientY;
      if (Math.hypot(p.x - p.sx, p.y - p.sy) > 9) p.moved = true;
      if (this.pointers.size === 2 && this.pinch) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (d > 0 && this.pinch.d > 0) this.renderer.zoomBy(this.pinch.d / d);
        this.renderer.pan(mx - this.pinch.mx, my - this.pinch.my);
        this.pinch = { d, mx, my };
        return;
      }
      if (p.moved && !(ev.pointerType === 'mouse' && p.button === 0 && this.targeting)) this.renderer.pan(dx, dy);
      if (ev.pointerType === 'mouse') this.hoverAt(ev.clientX, ev.clientY);
    };
    this.onUp = (ev) => {
      const p = this.pointers.get(ev.pointerId);
      this.pointers.delete(ev.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      clearTimeout(this.longT);
      if (!p || p.moved || p.long) return;
      if (ev.pointerType === 'mouse' && p.button === 2) { this.rightClick(); return; }
      if (ev.pointerType === 'mouse' && p.button === 1) return;
      const now = performance.now();
      const dbl = this.lastTap && now - this.lastTap.t < 320 && Math.hypot(this.lastTap.x - p.x, this.lastTap.y - p.y) < 24;
      this.lastTap = { t: now, x: p.x, y: p.y };
      this.clickAt(p.x, p.y, { run: dbl || ev.shiftKey && !this.targeting, add: ev.ctrlKey || ev.metaKey || (ev.shiftKey && !!this.renderer.pickUnit(p.x, p.y, 34, (u) => u.kind === 'hero')) });
    };
    this.onWheel = (ev) => { ev.preventDefault(); this.renderer.zoomBy(ev.deltaY > 0 ? 1.12 : 1 / 1.12); };
    this.onCancel = ev => { this.pointers.delete(ev.pointerId); this.pinch=null; clearTimeout(this.longT); };
    this.onCtx = (ev) => ev.preventDefault();
    this.onKey = (ev) => this.key(ev, true);
    this.onKeyUp = (ev) => this.key(ev, false);
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerup', this.onUp);
    c.addEventListener('pointercancel', this.onCancel);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('contextmenu', this.onCtx);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    this.keys = new Set();
    this.root.querySelector('.hud').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-act]');
      if (b) { ev.stopPropagation(); this.app.unlockAudio(); this.hudAction(b.dataset.act, b); }
    });
    // Minimap: tap to look there.
    const mm = this.$('.minimap');
    const mmLook = (ev) => { const r = mm.getBoundingClientRect(); const g = this.world.grid; this.renderer.focus((ev.clientX - r.left) / r.width * g.w, (ev.clientY - r.top) / r.height * g.h); };
    mm.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); mmLook(ev); mm.setPointerCapture(ev.pointerId); mm._drag = true; });
    mm.addEventListener('pointermove', (ev) => { if (mm._drag) mmLook(ev); });
    mm.addEventListener('pointerup', () => { mm._drag = false; });
  }
  unbindInput() {
    const c = this.viewport;
    c.removeEventListener('pointerdown', this.onDown); c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp); c.removeEventListener('pointercancel', this.onCancel);
    c.removeEventListener('wheel', this.onWheel); c.removeEventListener('contextmenu', this.onCtx);
    window.removeEventListener('keydown', this.onKey); window.removeEventListener('keyup', this.onKeyUp);
  }
  longPress(x, y) {
    // A touch hold inspects a route without moving; enemies still pin their cones.
    const enemy = this.renderer.pickUnit(x, y, 30, (u) => u.kind === 'enemy' && u.state === 'ok');
    if (enemy) { this.renderer.shownCones.add(enemy.id); return; }
    if (navigator.vibrate) navigator.vibrate(15);
    if (!this.targeting) { this.beginRoute(); const p = this.renderer.groundAt(x,y); this.previewRoute(p.x,p.y); }
  }
  rightClick() {
    if (this.routeMode) return this.cancelRoute();
    if (this.targeting) return this.cancelTargeting();
    const h = this.primary();
    if (h && (h.path || h.order)) { this.world.stopUnit(h); return; }
  }
  key(ev, down) {
    if (this.overlayOpen && ev.key !== 'Escape') return;
    const k = ev.key.toLowerCase();
    if (!down) { this.keys.delete(k); return; }
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) { this.keys.add(k); ev.preventDefault(); return; }
    if (ev.repeat) return;
    const heroes = this.world.heroes();
    if (k >= '1' && k <= '9') { const h = heroes[+k - 1]; if (h) { if (this.primaryId === h.id && this.selected.size === 1) this.renderer.focus(h.x, h.y); this.select(h.id, ev.shiftKey); } return; }
    const ai = ABILITY_KEYS.indexOf(k);
    if (ai >= 0) { const h = this.primary(); if (h) { const bar = abilityBar(this.world, h); if (bar[ai]) this.beginTargeting(bar[ai]); } return; }
    switch (k) {
      case ' ': ev.preventDefault(); this.togglePause(); break;
      case 'p': this.toggleStance(); break;
      case 'tab': ev.preventDefault(); this.showAllCones = !this.showAllCones; this.hudDirty = true; break;
      case 't': this.togglePlanning(); break;
      case 'enter': if (this.routeMode) this.commitRoute(); else if (this.planning) this.executePlan(); break;
      case 'q': this.renderer.rotate(-1); break;
      case 'e': this.renderer.rotate(1); break;
      case 'f': { const h = this.primary(); if (h) this.renderer.follow = this.renderer.follow ? null : h.id; break; }
      case 'f5': ev.preventDefault(); this.quickSave(); break;
      case 'f9': ev.preventDefault(); this.quickLoad(); break;
      case '+': case '=': this.renderer.zoomBy(1 / 1.15); break;
      case '-': this.renderer.zoomBy(1.15); break;
      case 'escape': if (this.routeMode) this.cancelRoute(); else if (this.targeting) this.cancelTargeting(); else if (this.overlayOpen) this.closeOverlay(); else this.openMenu(); break;
      case 'r': this.routeMode ? this.cancelRoute() : this.beginRoute(); break;
      default: break;
    }
  }
  keyPan(dt) {
    if (!this.keys || !this.keys.size) return;
    const ax = this.renderer.screenAxes();
    let x = 0, y = 0;
    if (this.keys.has('arrowleft') || this.keys.has('a')) x -= 1;
    if (this.keys.has('arrowright') || this.keys.has('d')) x += 1;
    if (this.keys.has('arrowup') || this.keys.has('w')) y -= 1;
    if (this.keys.has('arrowdown') || this.keys.has('s')) y += 1;
    const sp = this.renderer.zoom * 0.9 * dt;
    this.renderer.panWorld((ax.rx * x + ax.dx * y) * sp, (ax.rz * x + ax.dz * y) * sp);
  }

  hudAction(act, el) {
    switch (act) {
      case 'cones': this.showAllCones = !this.showAllCones; this.hudDirty = true; break;
      case 'shadow': this.togglePlanning(); break;
      case 'go': this.executePlan(); break;
      case 'rotl': this.renderer.rotate(-1); break;
      case 'rotr': this.renderer.rotate(1); break;
      case 'save': this.quickSave(); break;
      case 'load': this.quickLoad(); break;
      case 'pause': this.togglePause(); break;
      case 'menu': this.openMenu(); break;
      case 'cancel': this.cancelTargeting(); break;
      case 'hint-ok': this.$('.hint-card').classList.add('hidden'); break;
      case 'stance': this.toggleStance(); break;
      case 'route': this.routeMode ? this.cancelRoute() : this.beginRoute(); break;
      case 'route-cancel': this.cancelRoute(); break;
      case 'route-go': this.commitRoute(); break;
      case 'halt': this.cancelRoute(); for (const id of this.selected) { const h = this.world.ent(id); if(h) { const v=h.inVehicle&&this.world.ent(h.inVehicle); if(v?.driver===h.id)this.world.stopUnit(v); this.world.stopUnit(h); h.shadow = null; h.shadow2 = null; this.followUps?.delete(id); } } this.hudDirty = true; break;
      case 'squad': this.cancelRoute(); this.cancelTargeting(); this.selected = new Set(this.world.heroes().filter(h=>h.state==='ok').map(h=>h.id)); this.hudDirty = true; break;
      case 'run': this.runMode = !this.runMode; this.hudDirty = true; break;
      case 'hero': { const id = el.dataset.id; const h = this.world.ent(id); if (h) { if (this.primaryId === id && this.lastPortrait && performance.now() - this.lastPortrait < 400) this.renderer.focus(h.x, h.y); this.select(id); this.lastPortrait = performance.now(); } break; }
      case 'ability': this.beginTargeting(el.dataset.ab); break;
      default: break;
    }
  }
  togglePause() { this.cancelRoute(); this.paused = !this.paused; this.hudDirty = true; }
  togglePlanning() {
    this.cancelRoute();
    this.planning = !this.planning;
    if (!this.planning) for (const h of this.world.heroes()) { h.shadow = null; h.shadow2 = null; }
    else this.paused = true;
    this.hudDirty = true;
  }
  toggleStance() {
    for (const id of this.selected) {
      const h = this.world.ent(id);
      if (!h || h.state !== 'ok' || h.carrying) continue;
      if (h.disguised && h.stance === 'stand') { this.toast('Crawling in uniform would give you away', 'warn'); continue; }
      h.stance = h.stance === 'prone' ? 'stand' : 'prone';
      if (h.stance === 'prone') h.run = false;
    }
    this.hudDirty = true;
    if (this.routePreview) this.previewRoute(this.routePreview.x,this.routePreview.y,this.routePreview.run);
  }

  beginRoute() {
    if (this.planning) { this.toast('Finish or cancel Shadow Mode first.', 'warn'); return; }
    if (!this.primary()) return;
    if (!this.routeMode) this.routeWasPaused = this.paused;
    this.cancelTargeting(); this.routeMode = true; this.paused = true;
    this.$('.hint-card').classList.add('hidden');
    this.$('.route-panel').classList.remove('hidden');
    this.$('.route-summary').textContent = 'Choose open ground. Only the selected lead hero will move.';
    this.$('.route-detail').textContent = '';
    this.$('[data-act="route-go"]').disabled = true;
    this.hudDirty = true;
  }
  previewRoute(x,y,run=false) {
    if (!this.routeMode) return;
    const p = this.routePreview = inspectRoute(this.world,this.primary(),x,y,run);
    this.$('.route-summary').textContent = p.ok ? `${p.stance} · ${Math.round(p.length)} paces · ${p.watchers.length ? 'exposed to the current watch' : 'no current sightline found'}` : p.reason;
    this.$('.route-detail').textContent = p.ok ? p.hazards.join(' · ') || 'Check the watch before committing.' : '';
    this.$('[data-act="route-go"]').disabled = !p.ok;
    this.renderer.overlays.showRoutePreview(p);
    this.renderer.overlays.showCursor({x,y},p.ok ? 0xd9c696 : 0xff735c);
    this.hudDirty = true;
  }
  cancelRoute() {
    if (!this.routeMode) return;
    this.routeMode = false; this.routePreview = null; this.paused = this.routeWasPaused;
    this.$('.route-panel').classList.add('hidden');
    this.renderer.overlays.showRoutePreview(null); this.renderer.overlays.showCursor(null);
    this.hudDirty = true;
  }
  commitRoute() {
    const p = this.routePreview;
    if (!p?.ok) return;
    // Recheck against current flags, even though the planner pauses the world.
    const fresh = inspectRoute(this.world,this.primary(),p.x,p.y,p.run);
    if (!fresh.ok) { this.previewRoute(p.x,p.y,p.run); return; }
    const h = this.primary(); this.cancelRoute();
    this.issue(h,{type:'move',x:p.x,y:p.y,run:p.run});
  }

  // ---------- saves ----------
  snapshot() {
    return JSON.stringify({ v: 1, mission: this.meta.id, difficulty: this.difficulty, date: Date.now(), s: this.world.s }, (k, v) => (k.startsWith('_') ? undefined : v));
  }
  writeSave(slot) {
    try { localStorage.setItem(this.app.saveKey(slot), this.snapshot()); return true; } catch (e) { this.toast('Could not save: storage is full or blocked', 'danger'); return false; }
  }
  autosave() { this.writeSave('auto'); }
  quickSave() { if (this.world.s.result) return; this.world.s.stats.saves++; if (this.writeSave('quick')) { this.toast('Game saved', 'good', 1); this.app.sfx.play('stamp', undefined, undefined, { ui: true, vol: 0.5 }); } }
  quickLoad(slot = 'quick') {
    let raw = null;
    try { raw = localStorage.getItem(this.app.saveKey(slot)); } catch (e) { /* storage blocked */ }
    if (!raw) { this.toast('No saved game', 'warn'); return; }
    let save;
    try { save = JSON.parse(raw); if (!save?.s || !save.mission) throw Error('invalid save'); }
    catch { this.toast('This save is damaged. Your autosave is still available from the menu.', 'warn'); return; }
    if (save.mission !== this.meta.id) { this.toast('That save is from another mission', 'warn'); return; }
    this.app.playMission(this.meta.id, { difficulty: save.difficulty, save });
  }

  // ---------- HUD ----------
  initHud() {
    const m = this.meta;
    this.$('.mc-date').textContent = `${this.app.formatDate(m.date)} · DAY ${this.app.dayOf(m.date).toLocaleString('en-GB')}`;
    this.$('.mc-title').textContent = m.title;
    // Minimap
    const mm = this.$('.minimap');
    const g = this.world.grid;
    this.mmBase = this.renderer.terrain.minimapCanvas(3);
    const maxW = 190, maxH = 150;
    const s = Math.min(maxW / g.w, maxH / g.h);
    mm.width = Math.round(g.w * s * 2); mm.height = Math.round(g.h * s * 2);
    mm.style.width = Math.round(g.w * s) + 'px'; mm.style.height = Math.round(g.h * s) + 'px';
    this.mmScale = s * 2;
    this.hudDirty = true;
  }

  hudFrame(dt) {
    this.hudT = (this.hudT || 0) + dt;
    this.markerT = (this.markerT || 0) + dt;
    if (this.markerT > 0.5) { this.markerT = 0; this.setMarkers(); }
    this.drawMinimap();
    this.updateBanners();
    this.updateToasts(dt);
    if (!this.hudDirty && this.hudT < 0.2) return;
    this.hudT = 0; this.hudDirty = false;
    const w = this.world;
    // Portraits
    const ps = w.heroes().map((h, i) => {
      const sel = this.selected.has(h.id);
      const pips = Array.from({ length: h.maxHp }, (_, k) => `<i class="${k < h.hp ? 'on' : ''}"></i>`).join('');
      const status = h.state === 'down' ? `<b class="down">DOWN ${Math.ceil(h.downT)}s</b>` : h.state === 'dead' ? '<b class="down">KIA</b>'
        : h.inVehicle ? '<b>aboard</b>' : h.hidden && h.hidden.startsWith('b:') ? '<b>inside</b>' : h.hidden === 'bush' ? '<b>hidden</b>' : h.disguised ? '<b>disguised</b>' : h.carrying ? '<b>carrying</b>' : h.stance === 'prone' ? '<b>prone</b>' : '';
      const plan = h.shadow ? `<em class="planned">planned${h.shadow2 ? ' ×2' : ''}</em>` : '';
      return `<button class="portrait ${sel ? 'sel' : ''} ${h.state}" data-act="hero" data-id="${h.id}" style="--accent:${h.colors.accent};background-image:linear-gradient(180deg, rgba(10, 9, 7, 0.15) 0%, rgba(10, 9, 7, 0.85) 72%), url(assets/portraits/${h.hid}.jpg)">
        <span class="p-key">${i + 1}</span><span class="p-call">${h.callsign}</span><span class="p-name">${h.name}</span>
        <span class="p-hp">${pips}</span>${status}${plan}${typeof h.breath === 'number' && h.breath < 1 ? `<span class="p-breath${h.breath < 0.25 ? ' low' : ''}"><i style="width:${Math.round(Math.max(0, h.breath) * 100)}%"></i></span>` : ''}</button>`;
    }).join('');
    if (ps !== this._ps) { this.$('.portraits').innerHTML = ps; this._ps = ps; }
    // Ability bar
    const h = this.primary();
    const status = fieldStatus(w,h);
    this.$('.field-status span').textContent = h ? `${h.callsign || h.name} / ${status.label}` : status.label;
    this.$('.field-status').classList.toggle('noticed',status.suspicion>0);
    this.$('.field-status em').style.width = `${status.suspicion*100}%`;
    let ab = '';
    if (h && h.state === 'ok') {
      const bar = abilityBar(w, h);
      ab = bar.map((id, i) => {
        const def = ABILITIES[id];
        const ammo = h.ammo[id];
        const cnt = ammo !== undefined && ammo !== Infinity ? `<span class="a-ammo">${ammo}</span>` : '';
        const active = this.targeting && this.targeting.ab === id ? 'active' : '';
        const toggled = (id === 'disguise' && h.disguised) || (id === 'camouflage' && h.camo) || (id === 'civilian' && h.civilian) || (id === 'carry' && h.carrying) ? 'toggled' : '';
        const off = (ammo !== undefined && ammo <= 0) || h.cd[id] > 0 ? 'off' : '';
        return `<button class="ability ${active} ${toggled} ${off}" data-act="ability" data-ab="${id}" title="${def.name}: ${def.desc} [${ABILITY_KEYS[i].toUpperCase()}]">${icon(id)}<span class="a-key">${ABILITY_KEYS[i].toUpperCase()}</span>${cnt}<span class="a-name">${id === 'carry' && h.carrying ? 'Drop' : id === 'carry' && !heroAbilities(h).includes('carry') ? 'Drag body' : def.name}</span></button>`;
      }).join('');
      ab += `<span class="sep"></span><button class="ability ${h.stance === 'prone' ? 'toggled' : ''}" data-act="stance" title="Crawl / stand [P]">${icon(h.stance === 'prone' ? 'stand' : 'prone')}<span class="a-key">P</span><span class="a-name">${h.stance === 'prone' ? 'Stand' : 'Crawl'}</span></button>`;
    }
    if (ab !== this._ab) { this.$('.abilities').innerHTML = ab; this._ab = ab; }
    const tools = h?.state === 'ok' ? `<button class="${this.routeMode?'active':''}" data-act="route" title="Inspect a route before moving [R]">Plot route</button><button data-act="halt" title="Stop selected heroes and cancel their planned actions">Halt</button>${w.heroes().length>1?'<button data-act="squad" title="Select all able heroes">Squad</button>':''}` : '';
    if(tools!==this._tools){this.$('.tactical-tools').innerHTML=tools;this._tools=tools;}
    // Objectives
    const cds = w.s.countdowns || {};
    const clock = (c) => { const left = Math.max(0, Math.ceil(c.until - w.s.t)); return `<span class="timer${left <= 30 ? ' low' : ''}">${c.label ? c.label + ' ' : ''}${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</span>`; };
    let ob = w.s.objectives.filter((o) => o.state !== 'hidden').map((o) => `<li class="${o.state}${o.optional ? ' optional' : ''}">${o.state === 'done' ? '☑' : o.state === 'failed' ? '☒' : '☐'} ${o.text}${o.progress ? ` <span class="prog">${o.progress}</span>` : ''}${o.state === 'active' && cds[o.id] ? ' ' + clock(cds[o.id]) : ''}${o.optional ? ' <span class="opt">(optional)</span>' : ''}</li>`).join('');
    for (const [id, c] of Object.entries(cds)) if (!w.s.objectives.some((o) => o.id === id)) ob += `<li class="countdown">⏱ ${clock(c)}</li>`;
    const obHtml = `<ul>${ob}</ul>`;
    if (obHtml !== this._ob) { this.$('.objectives').innerHTML = obHtml; this._ob = obHtml; }
    this.root.querySelector('[data-act="cones"]').classList.toggle('on', this.showAllCones);
    this.root.querySelector('[data-act="shadow"]').classList.toggle('on', this.planning);
    this.root.querySelector('[data-act="pause"]').innerHTML = icon(this.paused ? 'play' : 'pause');
  }

  updateBanners() {
    const a = this.world.s.alarm;
    const ab = this.$('.alarm-banner');
    ab.classList.toggle('hidden', !a.on);
    if (a.on) this.$('.ab-time').textContent = Math.ceil(a.t) + 's';
    const pb = this.$('.pending-banner');
    pb.classList.toggle('hidden', !a.pending || a.on);
    if (a.pending) pb.querySelector('span').textContent = `Spotted! Silence them before the alarm sounds: ${a.pending.t.toFixed(1)}s`;
    this.$('.plan-banner').classList.toggle('hidden', !this.planning);
    this.$('.pause-banner').classList.toggle('hidden', !this.paused || this.planning);
  }

  drawMinimap() {
    const mm = this.$('.minimap');
    const ctx = mm.getContext('2d');
    const s = this.mmScale, w = this.world;
    ctx.globalAlpha = 1;
    ctx.drawImage(this.mmBase, 0, 0, mm.width, mm.height);
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(0, 0, mm.width, mm.height);
    for (const z of Object.values(w.zones)) if (z.show) { ctx.strokeStyle = '#ffd36b'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.strokeRect(z.x * s, z.y * s, z.w * s, z.h * s); ctx.setLineDash([]); }
    for (const e of w.ents) {
      if (e.hidden && e.hidden.startsWith('b:')) continue;
      if (e.kind === 'enemy') {
        if (e.state !== 'ok') continue;
        ctx.fillStyle = e.ai.mode === 'alert' ? '#ff4a3a' : e.ai.mode === 'search' || e.ai.mode === 'investigate' ? '#f2c94c' : '#d8d2c0';
        ctx.fillRect(e.x * s - 2, e.y * s - 2, 4, 4);
      } else if (e.kind === 'hero') {
        ctx.fillStyle = e.colors.accent; ctx.beginPath(); ctx.arc(e.x * s, e.y * s, this.selected.has(e.id) ? 5 : 3.5, 0, 6.28); ctx.fill();
        ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
      } else if (e.kind === 'npc' && e.state === 'ok') { ctx.fillStyle = '#7fb2ff'; ctx.fillRect(e.x * s - 1.5, e.y * s - 1.5, 3, 3); }
    }
    // Camera view footprint.
    const r = this.renderer, t = r.camTarget;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
    const vw = r.zoom * (r.width / r.height), vh = r.zoom / Math.sin(38 * Math.PI / 180);
    ctx.save(); ctx.translate(t.x * s, t.z * s); ctx.rotate(-r.yaw + Math.PI / 4 - Math.PI / 4); ctx.rotate(Math.PI / 4 - r.yaw);
    ctx.strokeRect(-vw / 2 * s * 0.75, -vh / 2 * s * 0.75, vw * s * 0.75, vh * s * 0.75);
    ctx.restore();
  }

  // Objective beacons. Re-evaluated twice a second and redrawn only when something changed, so
  // a marker goes out as soon as its safe is opened or its group found. An objective's `marker`
  // can be [x, y], a list of points, a thing id (shown until that thing is used, taken or
  // destroyed), or a function (api) => any of those (or null for none).
  setMarkers(force = false) {
    const w = this.world, list = [];
    const S = (id) => w.s.objs[id] || {};
    const addPoint = (m) => {
      if (!m) return;
      if (typeof m === 'string') { const t = w.thingById.get(m); const st = S(m); if (t && !st.used && !st.taken && !st.destroyed) list.push({ x: t.x + (t.w || 1) / 2, y: t.y + (t.h || 1) / 2 }); return; }
      if (Array.isArray(m) && typeof m[0] === 'number') { list.push({ x: m[0], y: m[1] }); return; }
      if (Array.isArray(m)) m.forEach(addPoint);
    };
    for (const d of this.def.objectives || []) {
      const o = w.s.objectives.find((x) => x.id === d.id);
      if (!o || o.state !== 'active') continue;
      if (d.zone && w.zones[d.zone]) { const z = w.zones[d.zone]; list.push({ x: z.x + z.w / 2, y: z.y + z.h / 2, zone: z, zid: d.zone }); }
      if (d.item) { const t = w.thingById.get(d.item); if (t && !S(t.id).taken) list.push({ x: t.x + 0.5, y: t.y + 0.5 }); }
      if (d.things && d.marker !== false) for (const id of d.things) { const t = w.thingById.get(id); if (t && !S(id).destroyed && !S(id).limpet && !w.s.flags['destroyed:' + id]) list.push({ x: t.x + t.w / 2, y: t.y + t.h / 2, color: 0xff8a5a }); }
      if (d.marker && d.marker !== false) {
        let m = d.marker;
        if (typeof m === 'function') { try { m = m(w.mission.api); } catch (e) { m = null; } }
        addPoint(m);
      }
    }
    const sig = list.map((m) => `${m.x.toFixed(1)},${m.y.toFixed(1)},${m.zid || ''},${m.color || ''}`).join(';');
    if (!force && sig === this._markerSig) return;
    this._markerSig = sig;
    for (const z of Object.values(w.zones)) z.show = list.some((m) => m.zone === z);
    this.renderer.overlays.setMarkers(list);
  }

  showHint(text) {
    if (this.app.settings.hints === false) return;
    const el = this.$('.hint-card');
    el.querySelector('p').innerHTML = text;
    el.classList.remove('hidden');
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    this.app.sfx.play('page', undefined, undefined, { ui: true, vol: 0.6 });
  }
  feed(text, kind = 'info') {
    const el = document.createElement('div');
    el.className = 'feed-item ' + kind;
    el.textContent = text;
    this.$('.feed').appendChild(el);
    setTimeout(() => el.classList.add('fade'), 5000);
    setTimeout(() => el.remove(), 6000);
    const items = this.$('.feed').children;
    while (items.length > 5) items[0].remove();
  }
  toast(text, kind = 'info', dur = 2.2) {
    if (this.toasts.some((t) => t.text === text)) return;
    const el = document.createElement('div');
    el.className = 'toast ' + kind; el.textContent = text;
    this.$('.toast-zone').appendChild(el);
    this.toasts.push({ el, text, t: dur });
  }
  updateToasts(dt) {
    this.toasts = this.toasts.filter((t) => { t.t -= dt; if (t.t <= 0) { t.el.remove(); return false; } if (t.t < 0.4) t.el.style.opacity = t.t / 0.4; return true; });
  }
  flashPortrait(id) { const el = this.root.querySelector(`.portrait[data-id="${id}"]`); if (el) { el.classList.remove('hurt'); void el.offsetWidth; el.classList.add('hurt'); } }

  queueDialogue(lines) {
    this.subtitleQueue.push(...lines);
    if (!this.subtitleBusy) this.nextSubtitle();
  }
  nextSubtitle() {
    if (this.exited) return;
    const el = this.$('.subtitle');
    const line = this.subtitleQueue.shift();
    if (!line) { el.classList.add('hidden'); this.subtitleBusy = false; return; }
    this.subtitleBusy = true;
    const who = this.app.heroName(line.who);
    el.innerHTML = `<b>${who}</b> ${line.line}`;
    el.classList.remove('hidden');
    const h = this.world.heroes().find((x) => x.hid === line.who);
    if (h) this.renderer.label(h.id, '…', 'hero', 1.5);
    setTimeout(() => this.nextSubtitle(), Math.max(2600, line.line.length * 62));
  }

  // ---------- overlays ----------
  openOverlay(html) {
    const o = this.$('.overlay');
    o.innerHTML = html;
    o.classList.remove('hidden');
    this.overlayOpen = true;
    o.onclick = (ev) => { const b = ev.target.closest('[data-o]'); if (b) this.overlayAction(b.dataset.o); };
  }
  closeOverlay() { this.$('.overlay').classList.add('hidden'); this.$('.overlay').classList.remove('demo-arrival-overlay'); this.overlayOpen = false; this.last = performance.now(); }
  openMenu() {
    if (this.world.s.result) return;
    const has = (s) => { try { return !!localStorage.getItem(this.app.saveKey(s)); } catch (e) { return false; } };
    this.openOverlay(`<div class="dossier small">
      <div class="stamp">PAUSED</div><h2>${this.meta.title}</h2>
      <div class="menu-col">
        <button class="btn" data-o="resume">Resume</button>
        <button class="btn" data-o="save">Save game</button>
        <button class="btn" data-o="load" ${has('quick') ? '' : 'disabled'}>Load quick save</button>
        <button class="btn" data-o="loadauto" ${has('auto') ? '' : 'disabled'}>Load autosave</button>
        <button class="btn" data-o="briefing">Review briefing</button>
        <button class="btn" data-o="help">Controls</button>
        <button class="btn" data-o="restart">Restart mission</button>
        <button class="btn ghost" data-o="quit">Abandon mission</button>
      </div></div>`);
  }
  overlayAction(a) {
    switch (a) {
      case 'demo-start': this.closeOverlay(); this.queueDialogue(this.demoDialogue || []); this.demoDialogue = null; break;
      case 'resume': this.closeOverlay(); break;
      case 'save': this.quickSave(); this.closeOverlay(); break;
      case 'load': this.closeOverlay(); this.quickLoad('quick'); break;
      case 'loadauto': this.closeOverlay(); this.quickLoad('auto'); break;
      case 'restart': this.app.playMission(this.meta.id, { difficulty: this.difficulty }); break;
      case 'quit': this.app.show('title'); break;
      case 'help': this.openOverlay(this.app.controlsHtml() + '<div class="menu-col"><button class="btn" data-o="menu">Back</button></div>'); break;
      case 'menu': this.openMenu(); break;
      case 'briefing': this.openOverlay(`<div class="dossier small"><h2>Briefing</h2><p class="brief-text">${(this.content.briefing && this.content.briefing.text) || this.meta.event}</p><ol>${this.meta.objectives.map((o) => `<li>${o}</li>`).join('')}</ol><div class="menu-col"><button class="btn" data-o="menu">Back</button></div></div>`); break;
      case 'debrief': this.app.debrief(this.meta.id, this.world.s, this.difficulty); break;
      case 'retry': this.app.playMission(this.meta.id, { difficulty: this.difficulty }); break;
      default: break;
    }
  }
  showResult(result, reason) {
    const s = this.world.s;
    const t = s.t;
    const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
    if (result === 'won') {
      const v = this.content.victory;
      this.openOverlay(`<div class="dossier small result won">
        <div class="stamp good">ACCOMPLISHED</div><h2>${this.meta.title}</h2>
        ${v ? `<p class="victory-line">“${v.line}” <span>— ${this.app.heroName(v.who)}</span></p>` : ''}
        <div class="stats"><div><b>${mm}:${String(ss).padStart(2, '0')}</b>time</div><div><b>${s.stats.kills}</b>killed</div><div><b>${s.stats.kos}</b>subdued</div><div><b>${s.stats.alarms}</b>alarms</div><div><b>${s.stats.seen}</b>times seen</div></div>
        <div class="menu-col"><button class="btn" data-o="debrief">Continue</button></div></div>`);
    } else {
      this.app.sfx.play('fail', undefined, undefined, { ui: true });
      const has = (k) => { try { return !!localStorage.getItem(this.app.saveKey(k)); } catch (e) { return false; } };
      this.openOverlay(`<div class="dossier small result lost">
        <div class="stamp bad">FAILED</div><h2>${this.meta.title}</h2><p>${reason || ''}</p>
        <div class="menu-col">
          ${has('quick') ? '<button class="btn" data-o="load">Load quick save</button>' : ''}
          ${has('auto') ? '<button class="btn" data-o="loadauto">Load autosave</button>' : ''}
          <button class="btn" data-o="retry">Restart mission</button>
          <button class="btn ghost" data-o="quit">Main menu</button>
        </div></div>`);
    }
  }
}
