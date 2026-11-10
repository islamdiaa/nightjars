// The war-room map: Natural Earth land (public domain) in the Equal Earth projection, drawn on
// a canvas with animated camera flights, mission pins and the red string of the Nightjars' route.

const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = Math.sqrt(3) / 2;
export function project(lon, lat) {
  const l = lon * Math.PI / 180, p = lat * Math.PI / 180;
  const t = Math.asin(M * Math.sin(p)), t2 = t * t, t6 = t2 * t2 * t2;
  const x = (2 * Math.sqrt(3) * l * Math.cos(t)) / (3 * (9 * A4 * t6 * t2 + 7 * A3 * t6 + 3 * A2 * t2 + A1));
  const y = t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
  return [x * 100, -y * 100];
}

let GEO = null;
async function loadGeo() {
  if (GEO) return GEO;
  const get = (n) => fetch(`assets/world/${n}.geojson`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [land110, land50, b110, b50] = await Promise.all([get('ne_110m_land'), get('ne_50m_land'), get('ne_110m_admin_0_boundary_lines_land'), get('ne_50m_admin_0_boundary_lines_land')]);
  const toPath = (gj, closed) => {
    const p = new Path2D();
    if (!gj) return p;
    for (const f of gj.features) {
      const g = f.geometry;
      if (!g) continue;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : g.type === 'LineString' ? [[g.coordinates]] : g.type === 'MultiLineString' ? [g.coordinates] : [];
      for (const poly of polys) for (const ring of poly) {
        ring.forEach(([lo, la], i) => { const [x, y] = project(lo, la); if (i) p.lineTo(x, y); else p.moveTo(x, y); });
        if (closed) p.closePath();
      }
    }
    return p;
  };
  const grat = new Path2D();
  for (let lo = -180; lo <= 180; lo += 15) for (let la = -85; la <= 85; la += 2.5) { const [x, y] = project(lo, la); if (la === -85) grat.moveTo(x, y); else grat.lineTo(x, y); }
  for (let la = -75; la <= 75; la += 15) for (let lo = -180; lo <= 180; lo += 3) { const [x, y] = project(lo, la); if (lo === -180) grat.moveTo(x, y); else grat.lineTo(x, y); }
  const outline = new Path2D();
  for (let la = -90; la <= 90; la += 2) { const [x, y] = project(-180, la); if (la === -90) outline.moveTo(x, y); else outline.lineTo(x, y); }
  for (let la = 90; la >= -90; la -= 2) { const [x, y] = project(180, la); outline.lineTo(x, y); }
  outline.closePath();
  GEO = { land110: toPath(land110, true), land50: toPath(land50 || land110, true), b110: toPath(b110, false), b50: toPath(b50 || b110, false), grat, outline };
  return GEO;
}

export class WorldMap {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.view = { x: 0, y: -40, s: 4 };
    this.anim = null;
    this.pins = []; this.route = []; this.current = null; this.routeProgress = 1;
  }
  async load() { this.geo = await loadGeo(); }
  setView(lon, lat, s) { const [x, y] = project(lon, lat); this.view = { x, y, s }; }
  // Fly from the current view to (lon, lat), zooming out in the middle for long hops.
  flyTo(lon, lat, s, dur = 3) {
    const [x, y] = project(lon, lat);
    const from = { ...this.view };
    const dist = Math.hypot(x - from.x, y - from.y);
    const peak = Math.min(from.s, s) / (1 + dist / 40);
    this.anim = { from, to: { x, y, s }, peak, t: 0, dur };
  }
  step(dt) {
    const a = this.anim;
    if (!a) return false;
    a.t = Math.min(a.dur, a.t + dt);
    const k = a.t / a.dur, e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    this.view.x = a.from.x + (a.to.x - a.from.x) * e;
    this.view.y = a.from.y + (a.to.y - a.from.y) * e;
    const zoomOut = Math.sin(k * Math.PI);
    const base = a.from.s + (a.to.s - a.from.s) * e;
    this.view.s = base * (1 - zoomOut) + Math.min(base, a.peak) * zoomOut;
    if (a.t >= a.dur) this.anim = null;
    return true;
  }
  // Land, borders and graticule are rendered into an offscreen cache around the current view
  // and only re-rendered when the camera has moved or zoomed noticeably. Each frame just
  // blits the cache with a transform, then draws pins and the route on top.
  renderBase(W, H, dpr, v) {
    const pad = 1.6;
    const cw = Math.round(W * pad * dpr), ch = Math.round(H * pad * dpr);
    if (!this.cache) this.cache = document.createElement('canvas');
    const c = this.cache;
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    const g = c.getContext('2d');
    const s = v.s * Math.min(W, H) / 120;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#10171c'; g.fillRect(0, 0, cw, ch);
    g.setTransform(s * dpr, 0, 0, s * dpr, (W * pad / 2 - v.x * s) * dpr, (H * pad / 2 - v.y * s) * dpr);
    const px = 1 / s;
    g.fillStyle = '#1c2a32'; g.fill(this.geo.outline);
    g.strokeStyle = 'rgba(190,210,220,0.08)'; g.lineWidth = px; g.stroke(this.geo.grat);
    const fine = v.s > 6 && !this.anim;
    const land = fine ? this.geo.land50 : this.geo.land110;
    g.save(); g.translate(px, 1.4 * px); g.fillStyle = 'rgba(0,0,0,0.35)'; g.fill(land); g.restore();
    g.fillStyle = '#8c7a5a'; g.fill(land);
    g.strokeStyle = 'rgba(30,22,12,0.55)'; g.lineWidth = 1.1 * px; g.stroke(land);
    g.strokeStyle = 'rgba(40,30,18,0.35)'; g.lineWidth = 0.8 * px; g.setLineDash([3 * px, 2 * px]); g.stroke(fine ? this.geo.b50 : this.geo.b110); g.setLineDash([]);
    this.cacheView = { x: v.x, y: v.y, s: v.s, W, H, dpr, pad, fine };
  }

  draw(time = 0) {
    const cv = this.cv, ctx = this.ctx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); this.cacheView = null; }
    const v = this.view;
    const s = v.s * Math.min(W, H) / 120;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#10171c';
    ctx.fillRect(0, 0, cv.width, cv.height);
    if (!this.geo) return;
    const cvw = this.cacheView;
    const cs = cvw ? cvw.s * Math.min(cvw.W, cvw.H) / 120 : 1;
    const offX = cvw ? (v.x - cvw.x) * s : 0, offY = cvw ? (v.y - cvw.y) * s : 0;
    const wantFine = v.s > 6 && !this.anim;
    if (!cvw || cvw.W !== W || cvw.H !== H || Math.abs(s / cs - 1) > 0.06 || Math.abs(offX) > W * 0.25 || Math.abs(offY) > H * 0.25 || cvw.fine !== wantFine) this.renderBase(W, H, dpr, v);
    {
      const c = this.cacheView, k = s / (c.s * Math.min(c.W, c.H) / 120);
      const cxS = W / 2 + (c.x - v.x) * s, cyS = H / 2 + (c.y - v.y) * s;
      const dw = c.W * c.pad * k, dh = c.H * c.pad * k;
      ctx.drawImage(this.cache, (cxS - dw / 2) * dpr, (cyS - dh / 2) * dpr, dw * dpr, dh * dpr);
    }
    ctx.setTransform(s * dpr, 0, 0, s * dpr, (W / 2 - v.x * s) * dpr, (H / 2 - v.y * s) * dpr);
    const px = 1 / s;
    // Route string between missions
    if (this.route.length > 1) {
      ctx.strokeStyle = 'rgba(178,34,34,0.85)'; ctx.lineWidth = 1.6 * px; ctx.lineCap = 'round';
      ctx.beginPath();
      const pts = this.route.map(([lo, la]) => project(lo, la));
      const n = pts.length - 1;
      const progress = Math.max(0, Math.min(1, this.routeProgress));
      const full = Math.floor(n * progress);
      const frac = n * progress - full;
      for (let i = 0; i <= Math.min(full, n); i++) { const [x, y] = pts[i]; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      if (full < n) { const [x0, y0] = pts[full], [x1, y1] = pts[full + 1]; ctx.lineTo(x0 + (x1 - x0) * frac, y0 + (y1 - y0) * frac); }
      ctx.stroke();
    }
    // Pins
    for (const p of this.pins) {
      const [x, y] = project(p.lon, p.lat);
      const r = (p.current ? 4.2 : 2.6) * px;
      if (p.current) {
        const pulse = 1 + 0.35 * Math.sin(time * 4);
        ctx.fillStyle = 'rgba(220,40,30,0.22)'; ctx.beginPath(); ctx.arc(x, y, r * 2.6 * pulse, 0, 6.28); ctx.fill();
      }
      ctx.fillStyle = p.current ? '#d8322a' : p.done ? '#e8dcc0' : '#9a8a6a';
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.28); ctx.fill();
      ctx.strokeStyle = '#1a1208'; ctx.lineWidth = 0.9 * px; ctx.stroke();
      if (p.label && (p.current || v.s > 9)) {
        ctx.font = `${(p.current ? 13 : 10) * px}px 'Special Elite', monospace`;
        ctx.fillStyle = p.current ? '#f6ecd2' : 'rgba(240,230,200,0.75)';
        ctx.strokeStyle = 'rgba(10,8,4,0.85)'; ctx.lineWidth = 3 * px;
        ctx.strokeText(p.label, x + r * 1.8, y - r * 1.4);
        ctx.fillText(p.label, x + r * 1.8, y - r * 1.4);
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}
