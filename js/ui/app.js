import { AudioEngine } from '../audio/audio.js';
import { Sfx } from '../audio/sfx.js';
import { Music } from '../audio/music.js';
import { Narrator } from '../audio/voice.js';
import { PlayScreen } from './play.js';
import * as Screens from './screens.js';
import { DemoScreen } from './demo.js';
import { WAR_START, WAR_DAYS } from '../core/constants.js';

// The application: profile, settings, audio, screen flow and campaign progression.

const DEFAULT_SETTINGS = { master: 0.9, music: 0.7, sfx: 0.85, voice: 0.9, narration: true, quality: 'high', speed: 1, subtitles: true };

export class App {
  constructor(root, data) {
    this.root = root;
    this.campaign = data.campaign;
    this.heroesJson = data.heroes;
    this.heroData = { ...data.heroes.heroes, ...data.heroes.guests };
    this.stats = data.stats.datasets || [];
    this.tracks = Array.isArray(data.music) ? data.music : [];
    // A public demo build ships release.js, which sets window.NJ_RELEASE = { demo: <chapters>, world: '3d', reports: false }.
    const R = window.NJ_RELEASE || {};
    this.release = R;
    this.demo = new URLSearchParams(location.search).get('demo') === '1' || !!R.demo;
    this.demoCount = typeof R.demo === 'number' ? R.demo : 10;
    this.missions = this.demo ? this.campaign.missions.slice(0, this.demoCount) : this.campaign.missions;
    this.byId = new Map(this.missions.map((m, i) => [m.id, { ...m, index: i }]));
    this.forestDemo = this.demo && (new URLSearchParams(location.search).get('world') === '3d' || R.world === '3d');
    this.storagePrefix = this.forestDemo ? 'nj.forest.' : this.demo ? 'nj.demo.' : 'nj.';
    this.profile = this.loadProfile();
    this.settings = this.profile.settings;
    this.audio = new AudioEngine(this.settings);
    this.sfx = new Sfx(this.audio);
    this.music = new Music(this.audio);
    this.narrator = new Narrator(this.settings);
    this.screen = null;
    this.contentCache = new Map();
    this.defCache = new Map();
    // First interaction anywhere unlocks audio on iOS.
    const unlock = () => { this.unlockAudio(); };
    window.addEventListener('pointerdown', unlock, { once: false, passive: true });
    window.addEventListener('keydown', unlock, { once: false });
  }

  async start() {
    const params = new URLSearchParams(location.search);
    if (this.demo) return this.show('demo');
    if (params.get('quality')) this.settings.quality = params.get('quality');
    if (params.get('mission')) return this.playMission(params.get('mission'), { difficulty: params.get('difficulty') || this.profile.difficulty || 'normal' });
    if (params.get('screen')) return this.show(params.get('screen'), { id: params.get('id') });
    this.show('title');
  }

  unlockAudio() {
    const was = this.audio.ready;
    this.audio.unlock();
    this.narrator.prime();
    if (!was && this.audio.ready && this.pendingMood) { this.music.setMood(this.pendingMood, true); this.pendingMood = null; }
    if (!was && this.audio.ready && this.screen && this.screen.onAudioReady) this.screen.onAudioReady();
  }
  mood(m, theatre) {
    if (theatre) this.music.setTheatre(theatre);
    if (!this.audio.ready) { this.pendingMood = m; return; }
    this.music.setMood(m);
  }

  // ---------- profile ----------
  loadProfile() {
    let p = null;
    try { p = JSON.parse(localStorage.getItem(this.storagePrefix + 'profile') || 'null'); } catch (e) { p = null; }
    p = p || {};
    return {
      v: 1, difficulty: p.difficulty || (this.demo ? 'easy' : 'normal'), reached: p.reached || 0, completed: p.completed || {},
      seen: p.seen || {}, settings: { ...DEFAULT_SETTINGS, ...(this.demo ? { narration: false } : {}), ...(p.settings || {}) }, started: !!p.started,
    };
  }
  saveProfile() { try { localStorage.setItem(this.storagePrefix + 'profile', JSON.stringify(this.profile)); } catch (e) { /* storage unavailable */ } }
  saveKey(slot) { return `${this.storagePrefix}save.${slot}`; }

  // ---------- content ----------
  async content(id) {
    if (this.contentCache.has(id)) return this.contentCache.get(id);
    let c = null;
    try { const r = await fetch(`content/missions/${id}.json`); if (r.ok) c = await r.json(); } catch (e) { c = null; }
    this.contentCache.set(id, c);
    return c;
  }
  async missionDef(id) {
    if (this.defCache.has(id)) return this.defCache.get(id);
    let def = null;
    try { def = (await import(`../data/missions/${id}.js`)).default; } catch (e) { def = null; }
    this.defCache.set(id, def);
    return def;
  }
  async timeline() {
    if (this.timelineCache) return this.timelineCache;
    const parts = await Promise.all([1, 2, 3, 4].map((n) => fetch(`content/timeline/part${n}.json`).then((r) => (r.ok ? r.json() : [])).catch(() => [])));
    this.timelineCache = parts.flat().filter((e) => e && e.date).sort((a, b) => a.date.localeCompare(b.date));
    return this.timelineCache;
  }
  heroIdOf(h) { return Object.keys(this.heroData).find((k) => this.heroData[k] === h) || ''; }
  heroName(id) { const h = this.heroData[id]; return h ? (h.short || h.name) : (id === 'thorne' ? 'Thorne' : id); }
  prevMission(id) { const m = this.byId.get(id); return m && m.index > 0 ? this.missions[m.index - 1] : null; }
  nextMission(id) { const m = this.byId.get(id); return m ? this.missions[m.index + 1] || null : null; }
  latestSave() {
    return ['quick', 'auto'].flatMap((slot) => {
      try { const s = JSON.parse(localStorage.getItem(this.saveKey(slot)) || 'null'); return s?.s && !s.s.result && this.byId.has(s.mission) ? [s] : []; } catch { return []; }
    }).sort((a, b) => b.date - a.date)[0] || null;
  }
  dayOf(date) { return Math.round((Date.parse(date + 'T12:00:00Z') - Date.parse(WAR_START + 'T12:00:00Z')) / 86400000) + 1; }
  formatDate(date, long = true) {
    const d = new Date(date + 'T12:00:00Z');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: long ? 'long' : 'short', year: 'numeric', timeZone: 'UTC' });
  }
  get warDays() { return WAR_DAYS; }

  // ---------- screens ----------
  async show(name, params = {}) {
    if (this.demo && name === 'title') name = 'demo';
    if (this.screen && this.screen.exit) this.screen.exit();
    this.narrator.stop();
    this.root.innerHTML = '';
    const holder = document.createElement('div');
    holder.className = 'screen screen-' + name;
    this.root.appendChild(holder);
    const S = {
      title: Screens.TitleScreen, warroom: Screens.WarRoomScreen, documentary: Screens.DocumentaryScreen,
      briefing: Screens.BriefingScreen, debrief: Screens.DebriefScreen, archive: Screens.ArchiveScreen,
      credits: Screens.CreditsScreen, settings: Screens.SettingsScreen, missions: Screens.MissionSelectScreen,
      difficulty: Screens.DifficultyScreen, epilogue: Screens.EpilogueScreen,
      demo: DemoScreen,
    }[name];
    this.screen = new S(this, params);
    await this.screen.enter(holder);
    requestAnimationFrame(() => holder.classList.add('in'));
  }

  // Continue the campaign from wherever the player is.
  continueCampaign() {
    if (this.demo && this.profile.reached >= this.missions.length) return this.show('demo', { id: this.missions[this.missions.length - 1].id, phase: 'end' });
    const idx = Math.min(this.profile.reached, this.missions.length - 1);
    this.beginMission(this.missions[idx].id);
  }
  beginMission(id) { if (!this.byId.has(id)) return this.show('title'); return this.demo ? this.show('demo', { id, phase: 'story' }) : this.show('warroom', { id }); }

  async playMission(id, opts = {}) {
    const meta = this.byId.get(id);
    if (!meta || (opts.save && opts.save.mission !== id)) return this.show('title');
    let def = await this.missionDef(id);
    // Debug overrides for testing lighting and weather: ?time=night&weather=rain
    const q = new URLSearchParams(location.search);
    if (def && (q.get('time') || q.get('weather'))) def = { ...def, time: q.get('time') || def.time, weather: q.get('weather') || def.weather };
    if (!meta || !def) return this.show('briefing', { id });
    const content = await this.content(id);
    if (this.screen && this.screen.exit) this.screen.exit();
    this.narrator.stop();
    this.music.stopTrack(1);
    this.root.innerHTML = '';
    const holder = document.createElement('div');
    holder.className = 'screen screen-play in';
    this.root.appendChild(holder);
    this.screen = new PlayScreen(this, meta, def, content, { difficulty: opts.difficulty || this.profile.difficulty, save: opts.save });
    return this.screen.enter(holder);
  }

  // Mission finished (won): record, then show the debrief.
  debrief(id, state, difficulty) {
    const prev = this.profile.completed[id];
    const rec = { difficulty, time: Math.round(state.t), kills: state.stats.kills, kos: state.stats.kos, alarms: state.stats.alarms, seen: state.stats.seen, date: Date.now() };
    if (!prev || rec.time < prev.time) this.profile.completed[id] = rec;
    const m = this.byId.get(id);
    this.profile.reached = Math.max(this.profile.reached, m.index + 1);
    this.saveProfile();
    this.show('debrief', { id, rec, state });
  }
  // A mission without a playable map can still be "lived" through its story.
  skipMission(id) {
    const m = this.byId.get(id);
    this.profile.reached = Math.max(this.profile.reached, m.index + 1);
    this.profile.seen[id] = true;
    this.saveProfile();
    this.show('debrief', { id, skipped: true });
  }

  controlsHtml() {
    const touch = matchMedia('(pointer: coarse)').matches;
    return `<div class="dossier small controls"><h2>Field manual</h2>
      <table>
        ${touch ? `
        <tr><th>Tap hero / portrait</th><td>Select (double-tap portrait: look at them)</td></tr>
        <tr><th>Tap ground</th><td>Walk there · double-tap or long-press: run</td></tr>
        <tr><th>Tap enemy</th><td>Show / hide their view cone (long-press pins it)</td></tr>
        <tr><th>Tap body, door, item</th><td>Carry / tie up · enter · take</td></tr>
        <tr><th>Ability button, then target</th><td>Knife, shoot, throw, charge…</td></tr>
        <tr><th>Drag · pinch</th><td>Move the camera · zoom</td></tr>` : `
        <tr><th>Left click</th><td>Select hero · move · use a context action</td></tr>
        <tr><th>Double-click / Shift+click</th><td>Run</td></tr>
        <tr><th>Click enemy</th><td>Show / hide their view cone (hover also shows it)</td></tr>
        <tr><th>Right click / Esc</th><td>Cancel the current action or stop</td></tr>
        <tr><th>Drag · wheel</th><td>Pan · zoom</td></tr>
        <tr><th>1–6</th><td>Select hero (press again to look)</td></tr>
        <tr><th>Z X C V B N</th><td>Hero abilities</td></tr>
        <tr><th>P</th><td>Crawl / stand</td></tr>
        <tr><th>Space</th><td>Tactical pause (orders still work)</td></tr>
        <tr><th>T, then Enter</th><td>Shadow Mode: plan one action each, then execute together</td></tr>
        <tr><th>Tab</th><td>Show every view cone</td></tr>
        <tr><th>Q / E · WASD / arrows</th><td>Rotate · pan camera · F follows the hero</td></tr>
        <tr><th>F5 / F9</th><td>Quick save / quick load</td></tr>`}
      </table>
      <p class="hint">Green cone: unaware. Darker inner zone: they see you even crawling. Yellow: suspicious. Red: they've seen you, and the alarm follows in seconds unless you silence them.</p></div>`;
  }
}
