// Playtest tools (phase D): automatic error capture, the in-game Report button and the ?perf=1 overlay.
//   installErrorReporter()  once at boot (main.js): window errors, unhandled rejections, console.error and
//                            failed resource loads go to POST /api/error (deduplicated, rate-limited).
//   attachPlaytest(screen)  from PlayScreen.enter: adds the Report button to the HUD, starts the perf sampler
//                            (always on, cheap) and shows the overlay when the URL has ?perf=1.
// Reports go to POST /api/report (server/api.mjs → playtest/reports.jsonl + shots/ + saves/).
// Automated browsers (navigator.webdriver) flag their submissions `test: true`; the server files them apart.
// ?report=0 hides the Report button.

const API = '/api/';
const IS_TEST = !!(navigator.webdriver);
const recentErrors = [];          // the last few errors, attached to every report
const seen = new Map();           // dedupe key -> count
let sendTimes = [];               // rate limit: at most 8 error posts a minute, 60 a session
let sentTotal = 0;

function context() {
  const app = window.__nj;
  const s = app && app.screen;
  const out = { screen: s ? (s.constructor && s.constructor.name || '').replace(/Screen$/, '').toLowerCase() || undefined : undefined };
  if (s && s.world && s.meta) { out.mission = s.meta.id; out.difficulty = s.difficulty; out.t = Math.round(s.world.s.t * 10) / 10; }
  out.view = { w: innerWidth, h: innerHeight, dpr: devicePixelRatio || 1 };
  return out;
}

function post(path, body) {
  return fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: path === 'error' })
    .then(async (r) => { let j = null; try { j = await r.json(); } catch (e) { j = null; } if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || `HTTP ${r.status}`); return j; });
}

function reportError(e) {
  const key = `${e.kind}|${e.message}|${e.source || ''}|${e.line || ''}`;
  const n = (seen.get(key) || 0) + 1;
  seen.set(key, n);
  recentErrors.push({ ...e, at: Math.round(performance.now()), stack: e.stack ? String(e.stack).slice(0, 1200) : undefined });
  if (recentErrors.length > 12) recentErrors.shift();
  if (n > 1 && n !== 10 && n !== 100) return;   // repeats: only the 10th and 100th go out, with the count
  const now = Date.now();
  sendTimes = sendTimes.filter((t) => now - t < 60000);
  if (sendTimes.length >= 8 || sentTotal >= 60) return;
  sendTimes.push(now); sentTotal++;
  post('error', { ...e, count: n, ...context(), url: location.href, ua: navigator.userAgent, test: IS_TEST || undefined }).catch(() => {});
}

export function installErrorReporter() {
  if (window.__njErrors) return;
  if ((window.NJ_RELEASE || {}).reports === false) { window.__njErrors = recentErrors; return; }   // public build: no report server
  window.__njErrors = recentErrors;
  window.addEventListener('error', (ev) => {
    if (ev instanceof ErrorEvent) {
      reportError({ kind: 'error', message: String(ev.message || ev.error || 'error'), source: ev.filename, line: ev.lineno, col: ev.colno, stack: ev.error && ev.error.stack });
    } else if (ev.target && ev.target !== window) {
      const t = ev.target, src = t.currentSrc || t.src || t.href;
      if (src) reportError({ kind: 'resource', message: `failed to load <${(t.tagName || '?').toLowerCase()}> ${src}`, source: src });
    }
  }, true);
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason;
    reportError({ kind: 'rejection', message: String((r && r.message) || r), stack: r && r.stack });
  });
  const origError = console.error.bind(console);
  console.error = (...args) => {
    origError(...args);
    try {
      const msg = args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch (e) { return String(a); } })())).join(' ').slice(0, 1500);
      const err = args.find((a) => a instanceof Error);
      reportError({ kind: 'console', message: msg, stack: err ? err.stack : undefined });
    } catch (e) { /* never let reporting throw */ }
  };
}

// ---------- performance sampler + overlay ----------
const RING = 240;
class PerfMonitor {
  constructor(screen) {
    this.screen = screen;
    this.gaps = new Float32Array(RING); this.cpu = new Float32Array(RING); this.n = 0;
    this.last = 0; this.calls = 0; this.tris = 0; this.texMB = null; this.texCount = 0; this.texAt = 0;
    this.attachedAt = performance.now();
    const gr = screen.renderer;
    const orig = gr.render;
    const info = gr.renderer.info;
    info.autoReset = false;    // count every pass of a frame (shadows, backdrop, composer)
    gr.render = (...args) => {
      info.reset();
      const t0 = performance.now();
      const res = orig.apply(gr, args);
      const t1 = performance.now();
      if (this.last) { const i = this.n % RING; this.gaps[i] = t0 - this.last; this.cpu[i] = t1 - t0; this.n++; }
      this.last = t0;
      this.calls = info.render.calls; this.tris = info.render.triangles;
      return res;
    };
  }
  textureMemory() {
    // Estimate GPU texture memory: unique textures reachable from the scene's materials.
    const gr = this.screen.renderer, texs = new Set();
    const addMat = (m) => {
      if (!m) return;
      for (const k in m) { const v = m[k]; if (v && v.isTexture) texs.add(v); }
      if (m.uniforms) for (const k in m.uniforms) { const v = m.uniforms[k] && m.uniforms[k].value; if (v && v.isTexture) texs.add(v); }
    };
    for (const sc of [gr.scene, gr.backdropScene]) if (sc) {
      sc.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(addMat); });
      if (sc.environment && sc.environment.isTexture) texs.add(sc.environment);
      if (sc.background && sc.background.isTexture) texs.add(sc.background);
    }
    let bytes = 0;
    for (const t of texs) {
      const img = t.image || {};
      const w = img.width || img.naturalWidth || img.videoWidth || 0, h = img.height || img.naturalHeight || img.videoHeight || 0;
      const depth = img.depth || 1;
      const bpp = t.type === 1016 /* HalfFloat */ ? 8 : t.type === 1015 /* Float */ ? 16 : 4;
      bytes += w * h * depth * bpp * (t.generateMipmaps !== false && !t.isDataTexture ? 4 / 3 : 1);
    }
    this.texMB = Math.round(bytes / 1048576);
    this.texCount = texs.size;
    this.texAt = performance.now();
  }
  stats() {
    const k = Math.min(this.n, RING);
    const gaps = Array.from(this.gaps.slice(0, k)).sort((a, b) => a - b);
    const avg = k ? gaps.reduce((a, b) => a + b, 0) / k : 0;
    const p95 = k ? gaps[Math.min(k - 1, Math.floor(k * 0.95))] : 0;
    const cpu = k ? Array.from(this.cpu.slice(0, k)).reduce((a, b) => a + b, 0) / k : 0;
    if (!this.texAt || performance.now() - this.texAt > 5000) { try { this.textureMemory(); } catch (e) { this.texMB = null; } }
    const info = this.screen.renderer.renderer.info;
    const mem = performance.memory;
    const r1 = (v) => Math.round(v * 10) / 10;
    return {
      fps: avg ? r1(1000 / avg) : 0, frameMs: r1(avg), p95Ms: r1(p95), renderMs: r1(cpu), frames: k,
      calls: this.calls, triangles: this.tris, textures: info.memory.textures, geometries: info.memory.geometries,
      texMB: this.texMB, texUnique: this.texCount,
      heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
      pixelRatio: this.screen.renderer.renderer.getPixelRatio(), painted: !!this.screen.renderer.painted,
      quality: this.screen.app.settings.quality, sinceNavMs: Math.round(this.attachedAt),
    };
  }
}

function showOverlay(screen, mon) {
  const el = document.createElement('div');
  el.className = 'pt-perf';
  screen.root.querySelector('.play').appendChild(el);
  const tick = () => {
    if (screen.exited || !el.isConnected) return;
    const s = mon.stats();
    const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n));
    el.textContent = `${s.fps} fps  ${s.frameMs} ms avg  ${s.p95Ms} p95  render ${s.renderMs} ms\n`
      + `draws ${s.calls}  tris ${fmt(s.triangles)}  tex ${s.textures} (${s.texMB ?? '?'} MB est)  geo ${s.geometries}\n`
      + `heap ${s.heapMB ?? 'n/a'} MB  dpr ${s.pixelRatio}  ${s.painted ? 'painted' : '3D'} ${s.quality}`;
    setTimeout(tick, 500);
  };
  tick();
}

// ---------- the Report button ----------
const FLAG = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Draw the canvas into a 2D copy in the same task as a render (no preserveDrawingBuffer needed), then
// encode asynchronously (toBlob runs off the main thread, so tapping Report never stalls the game).
function captureCanvas(screen) {
  const gr = screen.renderer, canvas = gr.renderer.domElement;
  try { gr.render(0, 1, screen); } catch (e) { /* draw what is there */ }
  const s = Math.min(1, 1600 / Math.max(1, canvas.width));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(canvas.width * s)); c.height = Math.max(1, Math.round(canvas.height * s));
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  return new Promise((resolve) => {
    const viaUrl = () => { try { resolve(c.toDataURL('image/jpeg', 0.8)); } catch (e) { resolve(null); } };
    if (!c.toBlob) return viaUrl();
    c.toBlob((blob) => {
      if (!blob) return viaUrl();
      const fr = new FileReader();
      fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    }, 'image/jpeg', 0.8);
  });
}

export function collectReport(screen, text, shot) {
  const w = screen.world, h = screen.primary && screen.primary();
  const gr = screen.renderer;
  let save = null;
  try { save = screen.snapshot(); } catch (e) { save = null; }
  return {
    text, test: IS_TEST || undefined,
    mission: screen.meta.id, build: screen.renderer?.opts.detailed ? 'first-year-harbour-wheels-perf-20261101' : screen.app.demo ? 'first-year-10-20261101' : undefined, difficulty: screen.difficulty, t: Math.round(w.s.t * 10) / 10, screen: 'play',
    hero: h ? { id: h.id, hid: h.hid, name: h.name, x: Math.round(h.x * 100) / 100, y: Math.round(h.y * 100) / 100, a: Math.round(h.a || 0), state: h.state, stance: h.stance, hp: h.hp, hidden: h.hidden || null, inVehicle: h.inVehicle || null, disguised: !!h.disguised, order: h.order ? h.order.type : null, selected: [...screen.selected] } : null,
    camera: { x: Math.round(gr.camTarget.x * 100) / 100, y: Math.round(gr.camTarget.z * 100) / 100, zoom: Math.round(gr.zoom * 100) / 100, yaw: Math.round(gr.yaw * 1000) / 1000, follow: gr.follow || null, painted: !!gr.painted },
    alarm: { on: w.s.alarm.on, t: Math.round((w.s.alarm.t || 0) * 10) / 10, count: w.s.alarm.count, pending: !!w.s.alarm.pending },
    objectives: (w.s.objectives || []).map((o) => ({ id: o.id, state: o.state })),
    log: (w.s.log || []).slice(-15),
    perf: screen.perfMon ? screen.perfMon.stats() : null,
    errors: recentErrors.slice(-8),
    settings: { quality: screen.app.settings.quality, speed: screen.app.settings.speed, paused: !!screen.paused },
    view: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio || 1, touch: navigator.maxTouchPoints || 0, orientation: (window.screen.orientation && window.screen.orientation.type) || (innerWidth > innerHeight ? 'landscape' : 'portrait') },
    url: location.href, ua: navigator.userAgent,
    screenshot: shot || null, save,
  };
}

function openReport(screen) {
  if (screen.root.querySelector('.pt-report')) return;
  let shot = Promise.resolve(null);
  try { shot = captureCanvas(screen); } catch (e) { shot = Promise.resolve(null); }
  const wasPaused = screen.paused;
  screen.paused = true; screen.hudDirty = true;
  const box = document.createElement('form');
  box.className = 'pt-report';
  box.innerHTML = `<input type="text" maxlength="2000" placeholder="What happened? (sent with a screenshot and your save)" autocomplete="off" enterkeyhint="send">
    <button type="submit" class="hb pt-send">Send</button><button type="button" class="hb pt-cancel" aria-label="Cancel">✕</button><div class="pt-msg"></div>`;
  screen.root.querySelector('.hud').appendChild(box);
  const input = box.querySelector('input'), msg = box.querySelector('.pt-msg');
  const close = () => { box.remove(); screen.paused = wasPaused; screen.hudDirty = true; screen.last = performance.now(); };
  // Keys typed here must not reach the game's shortcuts (WASD, P, Space…).
  for (const t of ['keydown', 'keyup']) box.addEventListener(t, (ev) => { ev.stopPropagation(); if (t === 'keydown' && ev.key === 'Escape') close(); });
  box.querySelector('.pt-cancel').addEventListener('click', (ev) => { ev.stopPropagation(); close(); });
  box.addEventListener('click', (ev) => ev.stopPropagation());
  box.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    const send = box.querySelector('.pt-send');
    send.disabled = true; msg.textContent = 'Sending…';
    shot.then((img) => {
      let body;
      try { body = collectReport(screen, text, img); } catch (e) { body = { text, mission: screen.meta && screen.meta.id, error: String(e) }; }
      return post('report', body);
    }).then(() => {
      close();
      if (screen.toast) screen.toast('Report sent. Thank you!', 'good', 1.8);
    }).catch((e) => { send.disabled = false; msg.textContent = `Could not send (${e.message}). Try again?`; });
  });
  setTimeout(() => input.focus(), 30);
}

let styled = false;
function injectStyle() {
  if (styled) return; styled = true;
  const st = document.createElement('style');
  st.textContent = `
  .hb.pt-btn { opacity: 0.7; }
  .hb.pt-btn:hover, .hb.pt-btn:active { opacity: 1; }
  .pt-report { position: absolute; left: 50%; top: max(150px, 20%); transform: translateX(-50%); z-index: 30;
    display: flex; gap: 6px; align-items: center; flex-wrap: wrap; width: min(620px, calc(100vw - 32px));
    padding: 8px; background: rgba(18, 17, 14, 0.94); border: 1px solid var(--panel-line, #555); border-radius: 4px; }
  .pt-report input { flex: 1; min-width: 0; height: 46px; padding: 0 12px; font: 16px var(--type, sans-serif); color: var(--paper, #eee);
    background: rgba(255, 255, 255, 0.07); border: 1px solid rgba(232, 223, 198, 0.35); border-radius: 3px; }
  .pt-report .hb { font: 600 15px var(--head, sans-serif); }
  .pt-report .pt-send { width: auto; padding: 0 16px; }
  .pt-report .pt-msg { flex-basis: 100%; font: 13px var(--type, sans-serif); color: #ffe0a0; }
  .pt-report .pt-msg:empty { display: none; }
  .pt-perf { position: absolute; right: max(10px, env(safe-area-inset-right)); top: max(64px, calc(env(safe-area-inset-top) + 58px)); z-index: 25; pointer-events: none;
    white-space: pre; font: 11px/1.35 ui-monospace, Menlo, monospace; color: #d8ffd0; background: rgba(0, 0, 0, 0.6); padding: 4px 8px; border-radius: 3px; }`;
  document.head.appendChild(st);
}

export function attachPlaytest(screen) {
  if ((window.NJ_RELEASE || {}).reports === false) return;
  try {
    injectStyle();
    const q = new URLSearchParams(location.search);
    screen.perfMon = new PerfMonitor(screen);
    if (q.get('perf') === '1') showOverlay(screen, screen.perfMon);
    if (q.get('report') === '0' || q.get('plate')) return;
    const bar = screen.root.querySelector('.hud-top-right');
    if (!bar) return;
    const b = document.createElement('button');
    b.className = 'hb pt-btn'; b.type = 'button';
    b.title = 'Report a problem (sends a screenshot and your save)';
    b.setAttribute('aria-label', 'Report a problem');
    b.innerHTML = FLAG;
    b.addEventListener('click', (ev) => { ev.stopPropagation(); openReport(screen); });
    bar.appendChild(b);
  } catch (e) { console.warn('playtest tools unavailable', e); }
}
