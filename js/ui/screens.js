import { icon } from './icons.js';
import { WorldMap } from './worldmap.js';
import { renderChart } from './charts.js';
import { DIFFICULTY } from '../core/constants.js';
import { buildMission } from '../core/builder.js';
import { F, T } from '../core/constants.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================ TITLE
export class TitleScreen {
  constructor(app) { this.app = app; }
  async enter(root) {
    const app = this.app;
    const started = app.profile.reached > 0 || app.profile.started;
    root.innerHTML = `
      <canvas class="title-map"></canvas>
      <div class="title-vignette"></div>
      <svg class="nightjar-fly" viewBox="0 0 200 80"><path d="M100 40 C 80 28, 55 22, 8 30 C 40 34, 62 38, 84 46 C 70 52, 60 60, 52 70 C 70 62, 86 54, 98 50 L 104 50 C 116 54, 132 62, 150 70 C 142 60, 132 52, 118 46 C 140 38, 162 34, 194 30 C 147 22, 122 28, 102 40 Z" fill="currentColor"/></svg>
      <div class="title-block">
        <div class="title-kicker">SPECIAL SECTION N · MOST SECRET</div>
        <h1 class="title-name">NIGHTJARS</h1>
        <div class="title-sub">2,194 DAYS · 1939–1945</div>
        <div class="title-motto">Audimur, non videmur. <span>We are heard, not seen.</span></div>
        <nav class="title-menu">
          ${started ? `<button class="btn big" data-a="continue">Continue the war<small>${esc(app.missions[Math.min(app.profile.reached, app.missions.length - 1)].title)}</small></button>` : ''}
          <button class="btn ${started ? '' : 'big'}" data-a="new">${started ? 'New campaign' : 'Begin: 1 September 1939'}</button>
          <button class="btn" data-a="missions">Operations</button>
          <button class="btn" data-a="archive">The Archive</button>
          <button class="btn" data-a="settings">Settings</button>
          <button class="btn ghost" data-a="credits">Credits &amp; sources</button>
        </nav>
      </div>
      <div class="tap-to-begin ${app.audio.ready ? 'hidden' : ''}">Tap anywhere to begin</div>
      <div class="title-foot">A work of historical fiction. Every date, place, photograph and figure in the documentary is real.</div>`;
    root.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-a]');
      app.unlockAudio();
      root.querySelector('.tap-to-begin').classList.add('hidden');
      if (!b) return;
      app.sfx.play('click', undefined, undefined, { ui: true });
      const a = b.dataset.a;
      if (a === 'continue') app.continueCampaign();
      if (a === 'new') app.show('difficulty');
      if (a === 'missions') app.show('missions');
      if (a === 'archive') app.show('archive');
      if (a === 'settings') app.show('settings');
      if (a === 'credits') app.show('credits');
    });
    this.map = new WorldMap(root.querySelector('.title-map'));
    await this.map.load();
    this.map.setView(14, 50, 7);
    const done = new Set(Object.keys(app.profile.completed));
    this.map.pins = app.missions.slice(0, app.profile.reached).map((m) => ({ lon: m.lon, lat: m.lat, done: done.has(m.id) }));
    this.map.route = this.map.pins.map((p) => [p.lon, p.lat]);
    let t0 = performance.now();
    const loop = (now) => {
      if (this.dead) return;
      const t = (now - t0) / 1000;
      this.map.view.x = 8 + Math.sin(t * 0.03) * 22; this.map.view.y = -55 + Math.cos(t * 0.021) * 8; this.map.view.s = 6 + Math.sin(t * 0.017) * 1.2;
      this.map.draw(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    this.onAudioReady();
  }
  onAudioReady() {
    if (!this.app.audio.ready) return;
    this.app.music.setTheatre('Western Europe');
    this.app.music.setMood('title');
    this.app.sfx.startAmbience(['nightjar', 'breeze', 'crickets']);
  }
  exit() { this.dead = true; cancelAnimationFrame(this.raf); this.app.sfx.stopAmbience(); }
}

// ============================================================ DIFFICULTY
export class DifficultyScreen {
  constructor(app) { this.app = app; }
  enter(root) {
    const app = this.app;
    root.innerHTML = `<div class="paper-page"><div class="dossier">
      <div class="doc-head"><span>SPECIAL SECTION N</span><span>PERSONNEL ASSESSMENT</span></div>
      <h2>How hard was your war?</h2>
      <div class="diff-cards">${Object.entries(DIFFICULTY).map(([k, d]) => `<button class="diff-card ${k === app.profile.difficulty ? 'sel' : ''}" data-d="${k}"><b>${d.label}</b><span>${d.blurb}</span><em>${k === 'easy' ? 'Easy' : k === 'normal' ? 'Medium' : 'Hard'}</em></button>`).join('')}</div>
      <p class="hint">You can change this for any operation when you replay it.</p>
      <div class="row"><button class="btn ghost" data-b="back">Back</button></div></div></div>`;
    root.addEventListener('click', (ev) => {
      const d = ev.target.closest('[data-d]');
      if (d) {
        app.sfx.play('stamp', undefined, undefined, { ui: true });
        app.profile.difficulty = d.dataset.d; app.profile.started = true; app.profile.reached = 0; app.saveProfile();
        app.beginMission(app.missions[0].id);
      }
      if (ev.target.closest('[data-b="back"]')) app.show('title');
    });
  }
}

// ============================================================ WAR ROOM (calendar + map)
export class WarRoomScreen {
  constructor(app, { id }) { this.app = app; this.id = id; }
  async enter(root) {
    const app = this.app, m = app.byId.get(this.id);
    const prev = app.prevMission(this.id);
    const fromDate = prev ? prev.date : '1939-08-23';
    root.innerHTML = `
      <canvas class="wr-map"></canvas>
      <div class="wr-panel">
        <div class="wr-act">ACT ${m.act} · ${esc(app.campaign.acts[m.act - 1].year)} · ${esc(app.campaign.acts[m.act - 1].title.toUpperCase())}</div>
        <div class="wr-date"></div>
        <div class="wr-day"></div>
        <div class="wr-bar"><i></i></div>
        <ul class="wr-ticker"></ul>
      </div>
      <div class="wr-dest hidden"><div class="wr-dest-place">${esc(m.place)}, ${esc(m.country)}</div><div class="wr-dest-title">${esc(m.title)}</div></div>
      <div class="wr-actions"><button class="btn ghost" data-a="menu">Menu</button><button class="btn" data-a="go">Skip ▸</button></div>`;
    this.map = new WorldMap(root.querySelector('.wr-map'));
    await this.map.load();
    const reachedIdx = m.index;
    const startPt = prev ? [prev.lon, prev.lat] : [17.6, 53.7];
    this.map.setView(startPt[0], startPt[1], prev ? 9 : 3);
    this.map.pins = app.missions.slice(0, reachedIdx + 1).map((x, i) => ({ lon: x.lon, lat: x.lat, done: !!app.profile.completed[x.id], current: i === reachedIdx, label: i === reachedIdx ? x.place.split(',')[0] : x.title }));
    this.map.route = app.missions.slice(0, reachedIdx + 1).map((x) => [x.lon, x.lat]);
    this.map.routeProgress = reachedIdx > 0 ? (reachedIdx - 1) / reachedIdx : 1;
    const events = (await app.timeline()).filter((e) => e.date > fromDate && e.date <= m.date);
    const d0 = Date.parse(fromDate + 'T12:00:00Z'), d1 = Date.parse(m.date + 'T12:00:00Z');
    const days = Math.max(1, Math.round((d1 - d0) / 86400000));
    const dur = Math.min(11, Math.max(4.5, 3 + days / 40 + events.length * 0.18));
    const zoom = /Pacific|Asia|China|Burma|Indian/.test(m.theatre) ? 5.5 : 8.5;
    setTimeout(() => this.map.flyTo(m.lon, m.lat, zoom, dur * 0.8), 300);
    root.addEventListener('click', (ev) => {
      app.unlockAudio();
      const b = ev.target.closest('[data-a]');
      if (!b) return;
      if (b.dataset.a === 'menu') app.show('title');
      if (b.dataset.a === 'go') { if (this.finished) app.show('documentary', { id: this.id }); else this.skip = true; }
    });
    app.mood('documentary', m.theatre);
    app.sfx.play('projector', undefined, undefined, { ui: true, vol: 0.6 });
    const elDate = root.querySelector('.wr-date'), elDay = root.querySelector('.wr-day'), bar = root.querySelector('.wr-bar i'), tick = root.querySelector('.wr-ticker');
    let shown = 0, t0 = performance.now(), last = t0;
    const loop = (now) => {
      if (this.dead) return;
      // A queued rAF timestamp can predate t0 after the asynchronous map load.
      const dt = Math.max(0, (now - last) / 1000); last = Math.max(last, now);
      let k = Math.max(0, Math.min(1, (now - t0) / 1000 / dur));
      if (this.skip) k = 1;
      const ease = 1 - Math.pow(1 - k, 2.2);
      const cur = new Date(d0 + (d1 - d0) * ease);
      const iso = cur.toISOString().slice(0, 10);
      elDate.textContent = cur.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
      const day = app.dayOf(iso);
      elDay.innerHTML = day >= 1 ? `DAY <b>${day.toLocaleString('en-GB')}</b> OF ${app.warDays.toLocaleString('en-GB')}` : `<b>${1 - day}</b> DAYS BEFORE THE WAR`;
      bar.style.width = `${Math.max(0, Math.min(100, (day / app.warDays) * 100))}%`;
      while (shown < events.length && events[shown].date <= iso) {
        const e = events[shown++];
        const li = document.createElement('li');
        li.innerHTML = `<time>${esc(app.formatDate(e.date, false))}</time><b>${esc(e.headline)}</b><span>${esc(e.detail || '')}</span><em>${esc(e.theatre || '')}</em>`;
        tick.prepend(li);
        if (!this.skip) app.sfx.play('type', undefined, undefined, { ui: true, vol: 0.5, gap: 0.08 });
        while (tick.children.length > 6) tick.lastChild.remove();
      }
      this.map.routeProgress = reachedIdx > 0 ? Math.min(1, (reachedIdx - 1 + ease) / reachedIdx) : 1;
      if (this.skip) { while (this.map.step(10)); } else this.map.step(dt);
      this.map.draw(now / 1000);
      if (k >= 1 && !this.finished) {
        this.finished = true;
        root.querySelector('.wr-dest').classList.remove('hidden');
        root.querySelector('[data-a="go"]').textContent = 'Open the file ▸';
        app.sfx.play('stamp', undefined, undefined, { ui: true });
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  exit() { this.dead = true; cancelAnimationFrame(this.raf); }
}

// ============================================================ DOCUMENTARY
export class DocumentaryScreen {
  constructor(app, { id }) { this.app = app; this.id = id; this.i = 0; }
  async enter(root) {
    const app = this.app, m = app.byId.get(this.id);
    const content = await app.content(this.id);
    const prev = app.prevMission(this.id);
    const charts = app.stats.filter((s) => prev && s.showAfter === prev.id);
    this.slides = [
      ...charts.map((c) => ({ kind: 'chart', chart: c })),
      ...((content && content.documentary) || [{ kind: 'history', date: m.date, heading: m.title, narration: m.event, photo: null }]),
    ];
    root.innerHTML = `
      <div class="doc-stage"></div>
      <div class="doc-grain"></div>
      <div class="doc-controls">
        <button class="hb" data-a="prev" title="Previous">‹</button>
        <span class="doc-count"></span>
        <button class="hb" data-a="next" title="Next">›</button>
        <button class="hb ${app.settings.narration ? 'on' : ''}" data-a="voice" title="Narration">${icon('speaker')}</button>
        <button class="btn ghost" data-a="skip">Skip to briefing ▸</button>
      </div>`;
    this.stage = root.querySelector('.doc-stage');
    root.addEventListener('click', (ev) => {
      app.unlockAudio();
      const b = ev.target.closest('[data-a]');
      if (b) {
        ev.stopPropagation();
        const a = b.dataset.a;
        if (a === 'prev') this.go(this.i - 1);
        if (a === 'next') this.go(this.i + 1);
        if (a === 'skip') this.finish();
        if (a === 'voice') { app.settings.narration = !app.settings.narration; app.saveProfile(); b.classList.toggle('on', app.settings.narration); if (!app.settings.narration) app.narrator.stop(); else this.speak(); }
        return;
      }
      if (ev.target.closest('.chart')) return;
      this.go(this.i + 1);
    });
    this.onKey = (ev) => { if (ev.key === 'ArrowRight' || ev.key === ' ') this.go(this.i + 1); if (ev.key === 'ArrowLeft') this.go(this.i - 1); if (ev.key === 'Escape') this.finish(); };
    window.addEventListener('keydown', this.onKey);
    const track = app.tracks.find((t) => (t.suggestedFor || []).includes(this.id));
    if (track && app.audio.ready) { app.music.setMood('silence'); app.music.playTrack(`assets/music/${track.file}`, { volume: 0.55 }); this.track = track; }
    else app.mood('documentary', m.theatre);
    this.go(0);
  }
  onAudioReady() { this.speak(); }
  go(i) {
    if (i < 0) return;
    if (i >= this.slides.length) return this.finish();
    this.i = i;
    clearTimeout(this.adv);
    const s = this.slides[i], app = this.app;
    this.stage.querySelector('.slide.cur')?.classList.replace('cur', 'out');
    setTimeout(() => this.stage.querySelectorAll('.slide.out').forEach((e) => e.remove()), 1200);
    const el = document.createElement('div');
    el.className = 'slide ' + s.kind;
    if (s.kind === 'chart') {
      el.innerHTML = `<div class="chart-wrap"></div>`;
      renderChart(el.querySelector('.chart-wrap'), s.chart);
    } else if (s.kind === 'file') {
      el.innerHTML = `<div class="file-doc"><div class="doc-head"><span>SPECIAL SECTION N</span><span>${esc(app.formatDate(s.date))}</span></div><h3>${esc(s.heading)}</h3><p class="typed">${esc(s.narration)}</p><div class="stamp">MOST SECRET</div></div>`;
    } else {
      const dir = ['kb1', 'kb2', 'kb3', 'kb4'][i % 4];
      el.innerHTML = `
        ${s.photo ? `<div class="photo ${dir}"><img src="assets/photos/${esc(s.photo)}" alt="${esc(s.caption || s.heading)}" onerror="this.parentElement.classList.add('missing')"></div>` : '<div class="photo none"></div>'}
        <div class="slide-date">${esc(app.formatDate(s.date))} · DAY ${Math.max(0, app.dayOf(s.date)).toLocaleString('en-GB')}</div>
        <div class="slide-text"><h2>${esc(s.heading)}</h2><p>${esc(s.narration)}</p></div>
        ${s.photo ? `<div class="slide-cap">${esc(s.caption || '')}<span>${esc(s.credit || '')}${s.license ? ' · ' + esc(s.license) : ''}</span></div>` : ''}`;
    }
    this.stage.appendChild(el);
    requestAnimationFrame(() => el.classList.add('cur'));
    this.stage.parentElement.querySelector('.doc-count').textContent = `${i + 1} / ${this.slides.length}`;
    app.sfx.play(s.kind === 'file' ? 'type' : 'projector', undefined, undefined, { ui: true, vol: 0.4 });
    this.speak();
  }
  speak() {
    const s = this.slides[this.i], app = this.app;
    clearTimeout(this.adv);
    const text = s.kind === 'chart' ? `${s.chart.title}. ${s.chart.takeaway || ''}` : s.narration;
    const next = () => { this.adv = setTimeout(() => this.go(this.i + 1), s.kind === 'chart' ? 5000 : 1600); };
    if (app.settings.narration && app.audio.ready) app.narrator.speak(text, () => { if (this.slides[this.i] === s) next(); });
    else this.adv = setTimeout(() => this.go(this.i + 1), Math.max(6000, text.length * 60) + (s.kind === 'chart' ? 6000 : 0));
  }
  finish() { if (this.done) return; this.done = true; this.app.show('briefing', { id: this.id }); }
  exit() { this.dead = true; clearTimeout(this.adv); window.removeEventListener('keydown', this.onKey); this.app.narrator.stop(); if (this.track) this.app.music.stopTrack(2); }
}

// ============================================================ BRIEFING
export class BriefingScreen {
  constructor(app, { id }) { this.app = app; this.id = id; }
  async enter(root) {
    const app = this.app, m = app.byId.get(this.id);
    const [content, def] = await Promise.all([app.content(this.id), app.missionDef(this.id)]);
    if (m.type === 'epilogue') return app.show('epilogue', { id: this.id });
    const br = content && content.briefing;
    const squad = m.heroes.map((h) => app.heroData[h]).filter(Boolean);
    root.innerHTML = `<div class="paper-page"><div class="dossier briefing">
      <div class="doc-head"><span>MOST SECRET · SPECIAL SECTION N</span><span>FILE N/${String(m.index + 1).padStart(2, '0')}</span></div>
      <div class="brief-grid">
        <div class="brief-main">
          <div class="brief-meta"><b>${esc(m.title.toUpperCase())}</b><span>${esc(m.place)}, ${esc(m.country)} · ${esc(app.formatDate(m.date))}</span><span>${m.basis === 'real' ? 'Based on a real operation' : 'Set within real events'} · ${esc(m.time)} · ${esc(m.weather)}</span></div>
          <div class="brief-from">From: ${esc(br ? br.from : 'Colonel Arthur Thorne')}</div>
          <p class="brief-text typed"></p>
          <h4>Objectives</h4>
          <ol class="brief-obj">${m.objectives.map((o) => `<li>${esc(o)}</li>`).join('')}</ol>
        </div>
        <div class="brief-side">
          <div class="recon"><canvas></canvas><span>Recon sketch</span></div>
          <h4>The squad</h4>
          <div class="squad">${squad.map((h) => `<div class="squad-card" style="--accent:${h.colors.accent}"><img class="face" src="assets/portraits/${esc(app.heroIdOf(h))}.jpg" alt="" onerror="this.remove()"><b>${esc(h.short || h.name)}</b><em>“${esc(h.callsign)}” · ${esc(h.role)}</em><span>${esc(h.nation)}</span></div>`).join('')}</div>
          <div class="diff-pick">${Object.entries(DIFFICULTY).map(([k, d]) => `<button class="chip ${k === app.profile.difficulty ? 'sel' : ''}" data-d="${k}">${d.label}</button>`).join('')}</div>
        </div>
      </div>
      <div class="row">
        <button class="btn ghost" data-a="back">‹ Documentary</button>
        ${def ? '<button class="btn big" data-a="deploy">Deploy ▸</button>' : '<span class="prep">This operation\'s battlefield is still being surveyed.</span><button class="btn" data-a="skip">Live it through the record ▸</button>'}
      </div></div></div>`;
    // Typewriter briefing.
    const text = br ? br.text : m.event;
    const p = root.querySelector('.brief-text');
    let n = 0;
    this.typer = setInterval(() => {
      n = Math.min(text.length, n + 3);
      p.textContent = text.slice(0, n);
      if (n % 9 === 0) app.sfx.play('type', undefined, undefined, { ui: true, vol: 0.25, gap: 0.05 });
      if (n >= text.length) clearInterval(this.typer);
    }, 18);
    root.addEventListener('click', (ev) => {
      app.unlockAudio();
      const d = ev.target.closest('[data-d]');
      if (d) { app.profile.difficulty = d.dataset.d; app.saveProfile(); root.querySelectorAll('[data-d]').forEach((x) => x.classList.toggle('sel', x === d)); return; }
      const b = ev.target.closest('[data-a]');
      if (!b) { clearInterval(this.typer); p.textContent = text; return; }
      app.sfx.play('click', undefined, undefined, { ui: true });
      if (b.dataset.a === 'back') app.show('documentary', { id: this.id });
      if (b.dataset.a === 'deploy') app.playMission(this.id, { difficulty: app.profile.difficulty });
      if (b.dataset.a === 'skip') app.skipMission(this.id);
    });
    app.mood('tension', m.theatre);
    if (def) this.drawRecon(root.querySelector('.recon canvas'), def);
    else root.querySelector('.recon').classList.add('none');
  }
  drawRecon(cv, def) {
    try {
      const M = buildMission(def, this.app.heroData, this.app.profile.difficulty);
      const g = M.grid;
      const s = Math.max(2, Math.floor(260 / Math.max(g.w, g.h)));
      cv.width = g.w * s; cv.height = g.h * s;
      const ctx = cv.getContext('2d');
      const col = { [T.WATER]: '#8fa3a8', [T.DEEP]: '#7a9096', [T.ROAD]: '#b8ad98', [T.COBBLE]: '#b8ad98', [T.SNOW]: '#ece8de', [T.FOREST]: '#c9c2a8', [T.SAND]: '#e2d6b6' };
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
        const f = g.base[g.idx(x, y)], t = g.terrain[g.idx(x, y)];
        ctx.fillStyle = (f & F.INDOOR) ? '#5a4a3a' : (f & F.SIGHT) ? '#7a8a62' : (f & F.BLOCK) ? '#6a5a4a' : (f & F.BUSH) ? '#a8b088' : col[t] || '#d8cfb8';
        ctx.fillRect(x * s, y * s, s, s);
      }
      ctx.strokeStyle = '#a8322a'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
      for (const z of Object.values(M.zones)) if (z.recon !== false) ctx.strokeRect(z.x * s, z.y * s, z.w * s, z.h * s);
      ctx.setLineDash([]);
      ctx.fillStyle = '#2a5a9a';
      for (const h of def.heroes) { ctx.beginPath(); ctx.arc((h.x + 0.5) * s, (h.y + 0.5) * s, 4, 0, 6.28); ctx.fill(); }
      const n = M.ents.filter((e) => e.kind === 'enemy').length;
      cv.nextElementSibling.textContent = `Recon sketch · estimated enemy strength: ${n}`;
    } catch (e) { console.error(e); }
  }
  exit() { clearInterval(this.typer); }
}

// ============================================================ DEBRIEF
export class DebriefScreen {
  constructor(app, params) { this.app = app; this.p = params; }
  async enter(root) {
    const app = this.app, m = app.byId.get(this.p.id);
    const c = await app.content(this.p.id);
    const next = app.nextMission(this.p.id);
    const rec = this.p.rec;
    const medals = [];
    if (rec) {
      if (rec.seen === 0) medals.push(['Ghost', 'Never seen by the enemy']);
      if (rec.kills === 0) medals.push(['Clean hands', 'Nobody killed']);
      if (rec.alarms === 0) medals.push(['Silent night', 'No alarm raised']);
      if (rec.difficulty === 'hard') medals.push(['Nightjar', 'Completed on the hardest setting']);
    }
    const after = c && c.aftermath, letter = c && c.letter;
    root.innerHTML = `<div class="paper-page debrief"><div class="dossier">
      <div class="doc-head"><span>SPECIAL SECTION N · AFTER-ACTION</span><span>${esc(m.title.toUpperCase())}</span></div>
      ${rec ? `<div class="stamp good">ACCOMPLISHED</div>
      <div class="stats"><div><b>${Math.floor(rec.time / 60)}:${String(rec.time % 60).padStart(2, '0')}</b>time</div><div><b>${rec.kills}</b>killed</div><div><b>${rec.kos}</b>subdued</div><div><b>${rec.alarms}</b>alarms</div><div><b>${rec.seen}</b>times seen</div></div>
      ${medals.length ? `<div class="medals">${medals.map(([a, b]) => `<span class="medal" title="${esc(b)}">✦ ${esc(a)}</span>`).join('')}</div>` : ''}` : '<div class="stamp">ON THE RECORD</div>'}
      ${after ? `<div class="aftermath">${after.photo ? `<figure><img src="assets/photos/${esc(after.photo)}" alt="${esc(after.caption)}" onerror="this.parentElement.remove()"><figcaption>${esc(after.caption)}<span>${esc(after.credit || '')}${after.license ? ' · ' + esc(after.license) : ''}</span></figcaption></figure>` : ''}<div><h3>What happened next</h3><p>${esc(after.narration)}</p></div></div>` : ''}
      ${letter ? `<div class="letter"><div class="letter-head">${esc(app.formatDate(letter.date || m.date))}</div><div class="letter-to">${esc(letter.to)}</div><p>${esc(letter.text)}</p><div class="letter-sign">${esc(app.heroName(letter.from))}</div></div>` : ''}
      ${c && c.facts ? `<div class="facts"><h4>Added to the Archive</h4><ul>${c.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>` : ''}
      <div class="row">
        <button class="btn ghost" data-a="menu">Main menu</button>
        ${app.demo ? '<button class="btn big" data-a="demo-end">Chapter recap ▸</button>' : '<button class="btn ghost" data-a="archive">The Archive</button>'}
        ${next && !app.demo ? `<button class="btn big" data-a="next">Onward: ${esc(app.formatDate(next.date))} ▸</button>` : ''}
      </div></div></div>`;
    root.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-a]');
      if (!b) return;
      app.sfx.play('click', undefined, undefined, { ui: true });
      if (b.dataset.a === 'menu') app.show('title');
      if (b.dataset.a === 'archive') app.show('archive');
      if (b.dataset.a === 'demo-end') app.show('demo', { id: this.p.id, phase: 'end' });
      if (b.dataset.a === 'next') app.beginMission(next.id);
    });
    app.mood('letter', m.theatre);
    if (after && app.settings.narration && app.audio.ready) setTimeout(() => !this.dead && app.narrator.speak(after.narration), 900);
  }
  exit() { this.dead = true; this.app.narrator.stop(); }
}

// ============================================================ EPILOGUE
export class EpilogueScreen {
  constructor(app, { id }) { this.app = app; this.id = id; }
  async enter(root) {
    const app = this.app;
    const c = await app.content(this.id) || {};
    const items = c.epilogue || [];
    const ppl = { ...app.heroData, vahl: { short: 'Erich Vahl', callsign: '', colors: { accent: '#888' } }, thorne: { short: 'Arthur Thorne', callsign: '', colors: { accent: '#c9a227' } } };
    root.innerHTML = `<div class="epi">
      <h1>What became of them</h1><p class="epi-sub">Kit Ashdown, writing in 1995</p>
      <div class="epi-list">${items.map((e) => { const h = ppl[e.who] || { short: e.who, colors: { accent: '#aaa' } }; return `<div class="epi-card" style="--accent:${h.colors.accent}"><img class="face" src="assets/portraits/${esc(e.who)}.jpg" alt="" onerror="this.remove()"><b>${esc(h.short || h.name)}</b>${h.callsign ? `<em>“${esc(h.callsign)}”</em>` : ''}<p>${esc(e.text)}</p></div>`; }).join('')}</div>
      ${(c.rollOfHonour || []).length ? `<div class="roll"><h2>Roll of honour</h2><ul>${c.rollOfHonour.map((r) => `<li>${esc(typeof r === 'string' ? r : r.line || r.text)}</li>`).join('')}</ul></div>` : ''}
      <div class="epi-charts"></div>
      <p class="epi-end">The USS Missouri lies today at Pearl Harbor, a few hundred yards from the sunken USS Arizona: where America's war began, and where it ended.</p>
      <p class="epi-motto">Audimur, non videmur.</p>
      <div class="row"><button class="btn" data-a="credits">Credits &amp; sources</button><button class="btn ghost" data-a="menu">Main menu</button></div></div>`;
    const ch = root.querySelector('.epi-charts');
    for (const ds of app.stats.filter((s) => s.showAfter === 'm56')) { const d = document.createElement('div'); ch.appendChild(d); renderChart(d, ds); }
    root.addEventListener('click', (ev) => { const b = ev.target.closest('[data-a]'); if (!b) return; if (b.dataset.a === 'credits') app.show('credits'); else app.show('title'); });
    app.music.setTheatre('Pacific'); app.mood('title');
    app.sfx.startAmbience(['nightjar', 'sea']);
    app.profile.reached = app.missions.length; app.saveProfile();
  }
  exit() { this.app.sfx.stopAmbience(); }
}

// ============================================================ MISSION SELECT
export class MissionSelectScreen {
  constructor(app) { this.app = app; }
  async enter(root) {
    const app = this.app;
    const playable = await Promise.all(app.missions.map((m) => app.missionDef(m.id).then((d) => !!d)));
    root.innerHTML = `<div class="paper-page"><div class="dossier ops">
      <div class="doc-head"><span>SPECIAL SECTION N</span><span>OPERATIONS 1939–1945</span></div>
      ${app.campaign.acts.map((a) => `<h3>Act ${a.n} · ${a.year} · ${esc(a.title)}</h3><div class="ops-list">${app.missions.filter((m) => m.act === a.n).map((m) => {
        const i = app.byId.get(m.id).index, open = i <= app.profile.reached, done = app.profile.completed[m.id];
        return `<button class="op ${open ? '' : 'locked'} ${done ? 'done' : ''}" data-id="${m.id}" ${open ? '' : 'disabled'}><span class="op-n">${String(i + 1).padStart(2, '0')}</span><b>${esc(m.title)}</b><em>${esc(app.formatDate(m.date, false))} · ${esc(m.place.split(',')[0])}</em><span class="op-tag">${done ? '✓ ' + (DIFFICULTY[done.difficulty]?.label || '') : playable[i] ? (m.type === 'epilogue' ? 'Epilogue' : 'Playable') : 'Story'}</span></button>`;
      }).join('')}</div>`).join('')}
      <div class="row"><button class="btn ghost" data-a="back">Back</button></div></div></div>`;
    root.addEventListener('click', (ev) => {
      const op = ev.target.closest('[data-id]');
      if (op && !op.disabled) { app.sfx.play('click', undefined, undefined, { ui: true }); app.beginMission(op.dataset.id); }
      if (ev.target.closest('[data-a="back"]')) app.show('title');
    });
  }
}

// ============================================================ ARCHIVE
export class ArchiveScreen {
  constructor(app) { this.app = app; }
  async enter(root) {
    const app = this.app;
    const reached = app.missions.slice(0, Math.max(1, app.profile.reached + 1));
    const contents = (await Promise.all(reached.map((m) => app.content(m.id)))).map((c, i) => ({ m: reached[i], c }));
    root.innerHTML = `<div class="archive">
      <div class="arch-head"><h1>The Archive</h1><nav>${['Photographs', 'Letters', 'The Squad', 'Data room', 'Facts'].map((t, i) => `<button class="tab ${i ? '' : 'sel'}" data-t="${i}">${t}</button>`).join('')}</nav><button class="btn ghost" data-a="back">Back</button></div>
      <div class="arch-body"></div><div class="lightbox hidden"></div></div>`;
    const body = root.querySelector('.arch-body');
    const photos = [];
    for (const { m, c } of contents) {
      if (!c) continue;
      for (const s of c.documentary || []) if (s.photo) photos.push({ ...s, m });
      if (c.aftermath && c.aftermath.photo) photos.push({ ...c.aftermath, heading: 'Aftermath: ' + m.title, date: m.date, m });
    }
    const tabs = [
      () => `<div class="photo-grid">${photos.map((p, i) => `<button class="ph" data-p="${i}"><img loading="lazy" src="assets/photos/${esc(p.photo)}" alt="${esc(p.caption)}"><span>${esc(app.formatDate(p.date, false))}</span></button>`).join('') || '<p>No photographs yet.</p>'}</div>`,
      () => `<div class="letters">${contents.filter((x) => x.c && x.c.letter).map(({ m, c }) => `<div class="letter"><div class="letter-head">${esc(app.formatDate(c.letter.date || m.date))}</div><div class="letter-to">${esc(c.letter.to)}</div><p>${esc(c.letter.text)}</p><div class="letter-sign">${esc(app.heroName(c.letter.from))}</div></div>`).join('') || '<p>No letters yet.</p>'}</div>`,
      () => this.squadHtml(),
      () => '<div class="data-room"></div>',
      () => `<div class="fact-list">${contents.filter((x) => x.c && x.c.facts).map(({ m, c }) => `<h3>${esc(m.title)} <span>${esc(app.formatDate(m.date, false))}</span></h3><ul>${c.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`).join('') || '<p>Nothing yet.</p>'}</div>`,
    ];
    const show = (i) => {
      body.innerHTML = tabs[i]();
      root.querySelectorAll('.tab').forEach((t) => t.classList.toggle('sel', +t.dataset.t === i));
      if (i === 2) this.drawLanes(body.querySelector('.lanes'));
      if (i === 3) {
        const room = body.querySelector('.data-room');
        const unlocked = app.stats.filter((s) => { const mm = app.byId.get(s.showAfter); return mm && mm.index < app.profile.reached; });
        if (!unlocked.length) room.innerHTML = '<p>Charts appear here as the war unfolds.</p>';
        for (const ds of unlocked) { const d = document.createElement('div'); room.appendChild(d); renderChart(d, ds, { animate: false }); }
      }
    };
    root.addEventListener('click', (ev) => {
      const t = ev.target.closest('[data-t]'); if (t) return show(+t.dataset.t);
      if (ev.target.closest('[data-a="back"]')) return app.show('title');
      const ph = ev.target.closest('[data-p]');
      const lb = root.querySelector('.lightbox');
      if (ph) {
        const p = photos[+ph.dataset.p];
        lb.innerHTML = `<figure><img src="assets/photos/${esc(p.photo)}" alt="${esc(p.caption)}"><figcaption><b>${esc(p.heading || '')}</b> · ${esc(app.formatDate(p.date))}<br>${esc(p.caption || '')}<span>${esc(p.credit || '')} · ${esc(p.license || '')} · <a href="${esc(p.source || '#')}" target="_blank" rel="noopener">source</a></span></figcaption></figure>`;
        lb.classList.remove('hidden');
        return;
      }
      if (ev.target.closest('.lightbox') && !ev.target.closest('a')) lb.classList.add('hidden');
    });
    show(0);
  }
  squadHtml() {
    const app = this.app, H = app.heroesJson;
    const card = (id, h) => `<div class="dossier-card" style="--accent:${h.colors.accent}"><img class="face" src="assets/portraits/${id}.jpg" alt="" onerror="this.remove()"><b>${esc(h.name)}</b><em>“${esc(h.callsign)}” · ${esc(h.role)} · ${esc(h.nation)} · b. ${h.born}</em><p>${esc(h.bio)}</p></div>`;
    return `<h2 class="arch-h">Who fought where</h2><p class="arch-p">Each line is a life; each dot an operation. Faded dots lie ahead.</p><div class="lanes"></div>
      <h2 class="arch-h">The Nightjars</h2><div class="dossier-grid">${Object.entries(H.heroes).map(([id, h]) => card(id, h)).join('')}</div>
      <h2 class="arch-h">Fighting alongside</h2><div class="dossier-grid">${Object.entries(H.guests).map(([id, h]) => card(id, h)).join('')}</div>
      <h2 class="arch-h">The handler</h2><div class="dossier-grid"><div class="dossier-card" style="--accent:#c9a227"><img class="face" src="assets/portraits/thorne.jpg" alt="" onerror="this.remove()"><b>${esc(H.handler.name)}</b><em>${esc(H.handler.role)}</em><p>${esc(H.handler.voice)}</p></div></div>`;
  }
  // Swimlane graph: heroes on rows, the 2,194 days across, a dot for every operation.
  drawLanes(el) {
    const app = this.app;
    const ids = [...Object.keys(app.heroesJson.heroes), ...Object.keys(app.heroesJson.guests)];
    const W = 980, rowH = 30, left = 150, top = 34, H = top + ids.length * rowH + 20;
    const x = (date) => left + (app.dayOf(date) / app.warDays) * (W - left - 16);
    let svg = '';
    for (let y = 1939; y <= 1945; y++) { const xx = x(`${y}-01-01` < '1939-09-01' ? '1939-09-01' : `${y}-01-01`); svg += `<line class="grid" x1="${xx}" x2="${xx}" y1="${top - 10}" y2="${H - 14}"/><text class="tick" x="${xx + 3}" y="${top - 16}">${y}</text>`; }
    ids.forEach((id, r) => {
      const h = app.heroData[id], y = top + r * rowH + rowH / 2;
      svg += `<text class="cat" x="${left - 12}" y="${y + 4}" text-anchor="end">${esc(h.short || h.name)}</text><line class="lane" x1="${left}" x2="${W - 16}" y1="${y}" y2="${y}"/>`;
      const ms = app.missions.filter((m) => m.heroes.includes(id));
      const pts = ms.map((m) => ({ m, x: x(m.date), open: app.byId.get(m.id).index <= app.profile.reached }));
      for (let i = 1; i < pts.length; i++) svg += `<line x1="${pts[i - 1].x}" x2="${pts[i].x}" y1="${y}" y2="${y}" stroke="${h.colors.accent}" stroke-width="2" opacity="${pts[i].open ? 0.8 : 0.2}"/>`;
      for (const p of pts) svg += `<circle class="dot" cx="${p.x}" cy="${y}" r="5" fill="${p.open ? h.colors.accent : '#3a3a36'}" stroke="#1a1a19" stroke-width="2"><title>${esc(p.m.title)} · ${esc(app.formatDate(p.m.date))} · ${esc(p.m.place)}</title></circle>`;
    });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Which heroes took part in which operations, 1939 to 1945">${svg}</svg>`;
  }
}

// ============================================================ CREDITS
export class CreditsScreen {
  constructor(app) { this.app = app; }
  async enter(root) {
    const app = this.app;
    const all = await Promise.all(app.missions.map((m) => app.content(m.id)));
    const photos = [];
    all.forEach((c, i) => { if (!c) return; for (const s of [...(c.documentary || []), c.aftermath || {}]) if (s && s.photo) photos.push({ ...s, m: app.missions[i] }); });
    root.innerHTML = `<div class="paper-page"><div class="dossier credits">
      <div class="doc-head"><span>NIGHTJARS: 2,194 DAYS</span><span>CREDITS &amp; SOURCES</span></div>
      <p>A work of historical fiction. Special Section N, its members, Colonel Thorne and Hauptmann Vahl are invented; the war around them is not. Real people appear only doing what they really did.</p>
      <h3>Archive photographs (${photos.length})</h3>
      <ul class="cred-list">${photos.map((p) => `<li><b>${esc(p.photo)}</b>: ${esc(p.caption || p.heading || '')}. ${esc(p.credit || '')}. ${esc(p.license || '')}. <a href="${esc(p.source || '#')}" target="_blank" rel="noopener">source</a></li>`).join('')}</ul>
      <h3>Music</h3>
      <p>The score is built from recordings by Scott Buckley and Kevin MacLeod, used under the Creative Commons Attribution 4.0 licence; by Carlo Alberto Boni and Charlie Huang, used under Creative Commons Attribution-ShareAlike 3.0 (the edited excerpts are shared under the same licence); and by the United States Marine Band (public domain). Each was excerpted, faded and loudness-normalised for the game, as noted below. Short stingers, a fallback score and the sound effects are synthesized in the browser.</p>
      <h4>Score</h4>
      <ul class="cred-list">${app.tracks.filter((t) => t.kind === 'score').map((t) => `<li>${esc(t.credit || `${t.title}, ${t.artist || t.composer}. ${t.license}.`)} <i>${esc(t.edit || '')}.</i> ${t.licenseUrl ? `<a href="${esc(t.licenseUrl)}" target="_blank" rel="noopener">licence</a> · ` : ''}<a href="${esc(t.source)}" target="_blank" rel="noopener">source</a></li>`).join('')}</ul>
      <h4>Documentary recordings</h4>
      <ul class="cred-list">${app.tracks.filter((t) => t.kind !== 'score').map((t) => `<li><b>${esc(t.title)}</b>, ${esc(t.composer)}; performed by ${esc(t.performer)}. ${esc(t.license)}. <a href="${esc(t.source)}" target="_blank" rel="noopener">source</a></li>`).join('')}</ul>
      <h3>Data</h3>
      <ul class="cred-list">${app.stats.map((s) => `<li><b>${esc(s.title)}</b>: ${(s.sources || []).map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label)}</a>`).join('; ')}</li>`).join('')}</ul>
      <h3>Software, maps and type</h3>
      <p>Forest models and photo-based surface materials: <a href="https://polyhaven.com/a/pine_tree_01" target="_blank" rel="noopener">Poly Haven — Pine Tree 01</a> (photography: Rob Tuytel; modeling: Rico Cilliers) and <a href="https://polyhaven.com/a/fern_02" target="_blank" rel="noopener">Fern 02</a>, <a href="https://polyhaven.com/license" target="_blank" rel="noopener">CC0</a>. Optimised and adapted for this game, including photographic twig cards for the pine canopy. Additional scanned props and textures from Poly Haven and ambientCG. These are environment art, not historical evidence.</p>
      <p>Industrial architecture: <a href="https://polyhaven.com/a/modular_factory_facade" target="_blank" rel="noopener">Modular Factory Facade by James Ray Cock</a>, CC0. Selected brick, window, door and cornice modules, adapted to the mission footprints with reduced textures. Asset-import tooling powered by Poly Haven. Period-inspired vehicle coachwork is original game geometry using the existing CC0 surface materials; it is not a vehicle scan or an exact historical replica. No Rockstar game assets are included.</p>
      <ul class="cred-list"><li>three.js, MIT licence</li><li>Natural Earth vector data, public domain</li><li>Special Elite (Apache 2.0), Oswald, Libre Baskerville and Caveat (SIL Open Font Licence), via Google Fonts</li></ul>
      <div class="row"><button class="btn ghost" data-a="back">Back</button></div></div></div>`;
    root.addEventListener('click', (ev) => { if (ev.target.closest('[data-a="back"]')) app.show('title'); });
  }
}

// ============================================================ SETTINGS
export class SettingsScreen {
  constructor(app) { this.app = app; }
  enter(root) {
    const app = this.app, s = app.settings;
    const slider = (k, label) => `<label class="set-row"><span>${label}</span><input type="range" min="0" max="1" step="0.05" value="${s[k]}" data-k="${k}"></label>`;
    root.innerHTML = `<div class="paper-page"><div class="dossier small settings">
      <div class="doc-head"><span>SPECIAL SECTION N</span><span>SETTINGS</span></div>
      ${slider('master', 'Master volume')}${slider('music', 'Music')}${slider('sfx', 'Sound effects')}${slider('voice', 'Narration volume')}
      <label class="set-row"><span>Documentary narration</span><input type="checkbox" data-k="narration" ${s.narration ? 'checked' : ''}></label>
      <label class="set-row"><span>Graphics quality</span><select data-k="quality"><option value="high" ${s.quality === 'high' ? 'selected' : ''}>High</option><option value="low" ${s.quality === 'low' ? 'selected' : ''}>Low (older devices)</option></select></label>
      <label class="set-row"><span>Game speed</span><select data-k="speed">${[0.75, 1, 1.25, 1.5].map((v) => `<option value="${v}" ${+s.speed === v ? 'selected' : ''}>${v}×</option>`).join('')}</select></label>
      ${app.controlsHtml()}
      <div class="row"><button class="btn ghost" data-a="reset">Reset ${app.demo ? 'demo' : 'campaign'} progress</button><button class="btn" data-a="back">Done</button></div></div></div>`;
    root.addEventListener('input', (ev) => {
      const k = ev.target.dataset.k; if (!k) return;
      s[k] = ev.target.type === 'checkbox' ? ev.target.checked : ev.target.type === 'range' ? +ev.target.value : (k === 'speed' ? +ev.target.value : ev.target.value);
      app.saveProfile(); app.audio.applyVolumes();
    });
    root.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-a]'); if (!b) return;
      if (b.dataset.a === 'back') app.show('title');
      if (b.dataset.a === 'reset' && confirm(`Erase all ${app.demo ? 'demo' : 'campaign'} progress and saves?`)) {
        app.profile.reached = 0; app.profile.completed = {}; app.profile.started = false; app.saveProfile();
        try { for (const k of Object.keys(localStorage)) if (k.startsWith(app.storagePrefix + 'save.')) localStorage.removeItem(k); } catch (e) { /* storage unavailable */ }
        app.show('title');
      }
    });
  }
}
