import * as THREE from 'three';
import { castRay } from '../core/los.js';
import { visionRange, litAt, ambientLight } from '../core/ai.js';
import { beamGrid } from './tells.js';

// Ground overlays: vision cones, selection rings, noise rings, path previews, markers.

const CONE_RAYS = 44;
const LIT_STEP = 0.6;            // tiles per lit-reach cell along a ray
const LIT_CELLS = (CONE_RAYS / 2) * 40;
const LIT_COLOR = new THREE.Color('#ffd27a');
const COLORS = {
  calm: new THREE.Color('#3fd46a'), wary: new THREE.Color('#f2c94c'), alert: new THREE.Color('#ff4a3a'),
  talk: new THREE.Color('#7fb2ff'), ko: new THREE.Color('#888888'),
};

const coneMat = (opacity) => new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });

class Cone {
  constructor() {
    const n = CONE_RAYS + 1;
    this.far = this.makeMesh(n * 2 * 3, 0.2);
    this.near = this.makeMesh(n * 3, 0.36);
    this.lit = this.makeMesh(LIT_CELLS * 2, 0.26);       // extra reach into lit ground (lamps, beams, flares)
    this.edge = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }));
    this.edge.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((n + 2) * 3), 3));
    this.edge.renderOrder = 3;
    this.group = new THREE.Group();
    this.group.add(this.far, this.near, this.edge, this.lit);
  }
  makeMesh(maxTris, opacity) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxTris * 9), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(maxTris * 9), 3));
    const m = new THREE.Mesh(g, coneMat(opacity));
    m.renderOrder = 2; m.frustumCulled = false;
    return m;
  }
}

export class Overlays {
  constructor(scene, world, terrain) {
    this.scene = scene; this.world = world; this.terrain = terrain;
    this.root = new THREE.Group(); this.root.name = 'overlays';
    scene.add(this.root);
    this.cones = []; this.conePool = [];
    this.rings = new Map();
    this.noiseRings = [];
    this.reveals = [];         // binocular reveals: { x, y, r, until }
    this.routeShows = [];      // patrol routes shown: { x, y, r, until }
    this.routeLines = null;
    this.markers = new THREE.Group(); this.root.add(this.markers);
    const ringGeo = new THREE.RingGeometry(0.42, 0.52, 32); ringGeo.rotateX(-Math.PI / 2);
    this.ringGeo = ringGeo;
    const pathGeo = new THREE.CircleGeometry(0.07, 8); pathGeo.rotateX(-Math.PI / 2);
    this.pathDots = new THREE.InstancedMesh(pathGeo, new THREE.MeshBasicMaterial({ color: 0xf6efd9, transparent: true, opacity: 0.8, depthWrite: false }), 400);
    this.pathDots.count = 0; this.pathDots.renderOrder = 4; this.pathDots.frustumCulled = false;
    this.pathDots.userData.keepPainted = true;
    this.root.add(this.pathDots);
    const rangeGeo = new THREE.RingGeometry(0.97, 1, 64); rangeGeo.rotateX(-Math.PI / 2);
    this.rangeRing = new THREE.Mesh(rangeGeo, new THREE.MeshBasicMaterial({ color: 0xf2e6c0, transparent: true, opacity: 0.5, depthWrite: false }));
    this.rangeRing.visible = false; this.rangeRing.renderOrder = 4;
    this.root.add(this.rangeRing);
    const curGeo = new THREE.RingGeometry(0.25, 0.4, 24); curGeo.rotateX(-Math.PI / 2);
    this.cursor = new THREE.Mesh(curGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }));
    this.cursor.visible = false; this.cursor.renderOrder = 5;
    this.root.add(this.cursor);
  }

  h(x, y) {
    const height = this.terrain.heightAt(x, y);
    // Route dots and rings must sit above the water, not vanish into the bed.
    return (this.terrain.opts.preciseWater ? Math.max(-0.12, height) : height) + 0.05;
  }

  // ---------- vision cones ----------
  coneFor(i) {
    if (!this.conePool[i]) { const c = new Cone(); this.conePool[i] = c; this.root.add(c.group); }
    return this.conePool[i];
  }

  updateCones(list, t) {
    let i = 0;
    for (const e of list) {
      if (e.state !== 'ok') continue;
      const c = this.coneFor(i++);
      c.group.visible = true;
      this.fillCone(c, e, t);
    }
    for (; i < this.conePool.length; i++) this.conePool[i].group.visible = false;
  }

  fillCone(c, e, t) {
    const w = this.world, g = w.grid;
    const ai = e.ai;
    const light = ambientLight(w);
    const range = visionRange(w, e) * light;
    const fov = (ai.mode === 'search' || ai.mode === 'alert') ? ai.fov * 1.25 : ai.fov;
    const nearR = range * ai.near;
    let col = COLORS.calm;
    if (ai.mode === 'alert') col = COLORS.alert;
    else if (ai.mode === 'search' || ai.mode === 'investigate' || ai.mode === 'checkBody' || ai.notice) col = COLORS.wary;
    else if (ai.mode === 'distracted') col = COLORS.talk;
    const pulse = ai.mode === 'alert' ? 0.75 + 0.25 * Math.sin(t * 10) : 1;
    const ex = e._rx ?? e.x, ey = e._ry ?? e.y, ea = e._ra ?? e.a;
    const farPts = [], nearPts = [];
    for (let k = 0; k <= CONE_RAYS; k++) {
      const a = ea - fov / 2 + fov * k / CONE_RAYS;
      const dFar = castRay(g, ex, ey, a, range, false);
      const dNear = Math.min(castRay(g, ex, ey, a, nearR, true), dFar);
      farPts.push([ex + Math.cos(a) * dFar, ey + Math.sin(a) * dFar, dFar]);
      nearPts.push([ex + Math.cos(a) * dNear, ey + Math.sin(a) * dNear, dNear]);
    }
    const y0 = this.h(ex, ey);
    // Near zone: triangle fan from the eye.
    {
      const pos = c.near.geometry.attributes.position.array, cl = c.near.geometry.attributes.color.array;
      let p = 0;
      for (let k = 0; k < CONE_RAYS; k++) {
        const A = nearPts[k], B = nearPts[k + 1];
        pos.set([ex, y0, ey, A[0], this.h(A[0], A[1]), A[1], B[0], this.h(B[0], B[1]), B[1]], p);
        for (let v = 0; v < 3; v++) { cl[p + v * 3] = col.r * pulse; cl[p + v * 3 + 1] = col.g * pulse; cl[p + v * 3 + 2] = col.b * pulse; }
        p += 9;
      }
      c.near.geometry.setDrawRange(0, CONE_RAYS * 3);
      c.near.geometry.attributes.position.needsUpdate = true; c.near.geometry.attributes.color.needsUpdate = true;
    }
    // Far zone: band between near and far arcs.
    {
      const pos = c.far.geometry.attributes.position.array, cl = c.far.geometry.attributes.color.array;
      let p = 0;
      for (let k = 0; k < CONE_RAYS; k++) {
        const A = nearPts[k], B = nearPts[k + 1], C = farPts[k], D = farPts[k + 1];
        const yA = this.h(A[0], A[1]), yB = this.h(B[0], B[1]), yC = this.h(C[0], C[1]), yD = this.h(D[0], D[1]);
        pos.set([A[0], yA, A[1], C[0], yC, C[1], D[0], yD, D[1], A[0], yA, A[1], D[0], yD, D[1], B[0], yB, B[1]], p);
        for (let v = 0; v < 6; v++) { cl[p + v * 3] = col.r * pulse; cl[p + v * 3 + 1] = col.g * pulse; cl[p + v * 3 + 2] = col.b * pulse; }
        p += 18;
      }
      c.far.geometry.setDrawRange(0, CONE_RAYS * 6);
      c.far.geometry.attributes.position.needsUpdate = true; c.far.geometry.attributes.color.needsUpdate = true;
    }
    // Lit reach: in the dark a guard's sight is short, but anything standing in light (a lamp's
    // pool, a searchlight beam, a flare, a lantern) he sees out to his full range. Shade those
    // stretches beyond the dark edge so the overlay never promises cover that is not there.
    {
      const fullR = visionRange(w, e);
      const pos = c.lit.geometry.attributes.position.array, cl = c.lit.geometry.attributes.color.array;
      let p = 0, cells = 0;
      if (light < 0.999 && fullR > range + 0.3) {
        const reach = [];
        for (let k = 0; k <= CONE_RAYS; k += 2) {
          const a = ea - fov / 2 + fov * k / CONE_RAYS;
          reach.push({ a, d: castRay(g, ex, ey, a, fullR, false), lit: [] });
        }
        const n = Math.ceil((fullR - range) / LIT_STEP);
        for (const R of reach) for (let i = 0; i < n; i++) {
          const s = range + (i + 0.5) * LIT_STEP;
          R.lit.push(s < R.d && litAt(w, ex + Math.cos(R.a) * s, ey + Math.sin(R.a) * s));
        }
        const pt = (R, s) => { const x = ex + Math.cos(R.a) * Math.min(s, R.d), y = ey + Math.sin(R.a) * Math.min(s, R.d); return [x, this.h(x, y), y]; };
        for (let j = 0; j < reach.length - 1 && cells < LIT_CELLS; j++) {
          const A = reach[j], B = reach[j + 1];
          for (let i = 0; i < n && cells < LIT_CELLS; i++) {
            if (!A.lit[i] && !B.lit[i]) continue;
            const s0 = range + i * LIT_STEP, s1 = s0 + LIT_STEP;
            const a0 = pt(A, s0), a1 = pt(A, s1), b0 = pt(B, s0), b1 = pt(B, s1);
            pos.set([...a0, ...a1, ...b1, ...a0, ...b1, ...b0], p);
            for (let v = 0; v < 6; v++) { cl[p + v * 3] = LIT_COLOR.r; cl[p + v * 3 + 1] = LIT_COLOR.g; cl[p + v * 3 + 2] = LIT_COLOR.b; }
            p += 18; cells++;
          }
        }
      }
      c.lit.geometry.setDrawRange(0, cells * 6);
      c.lit.geometry.attributes.position.needsUpdate = true; c.lit.geometry.attributes.color.needsUpdate = true;
    }
    // Outline of the far edge.
    {
      const pos = c.edge.geometry.attributes.position.array;
      pos.set([ex, y0 + 0.01, ey], 0);
      for (let k = 0; k <= CONE_RAYS; k++) pos.set([farPts[k][0], this.h(farPts[k][0], farPts[k][1]) + 0.01, farPts[k][1]], (k + 1) * 3);
      pos.set([ex, y0 + 0.01, ey], (CONE_RAYS + 2) * 3);
      c.edge.geometry.setDrawRange(0, CONE_RAYS + 3);
      c.edge.geometry.attributes.position.needsUpdate = true;
      c.edge.material.color.copy(col);
    }
  }

  // ---------- sleeping guards ----------
  // A dozing guard sees nothing: instead of a cone, a faint ring shows how close a footstep may come.
  updateSleepers(list) {
    const pool = this.sleepRings || (this.sleepRings = []);
    list.forEach((e, i) => {
      let r = pool[i];
      if (!r) {
        r = new THREE.Mesh(this.sleepGeo || (this.sleepGeo = (() => { const g = new THREE.RingGeometry(2.4, 2.5, 48); g.rotateX(-Math.PI / 2); return g; })()),
          new THREE.MeshBasicMaterial({ color: 0x9fb8e8, transparent: true, opacity: 0.55, depthWrite: false }));
        r.renderOrder = 3; this.root.add(r); pool[i] = r;
      }
      r.visible = true;
      r.position.set(e._rx ?? e.x, this.h(e._rx ?? e.x, e._ry ?? e.y) + 0.02, e._ry ?? e.y);
    });
    for (let i = list.length; i < pool.length; i++) pool[i].visible = false;
  }

  // ---------- searchlight footprints ----------
  // The ground a beam lights, in the cone overlay's language: a pale fill and a dashed outline.
  updateBeams(beams) {
    const pool = this.beamPool || (this.beamPool = []);
    let i = 0;
    for (const b of beams) {
      let o = pool[i];
      if (!o) {
        const NA = 14, NC = 5;
        const fill = new THREE.BufferGeometry();
        fill.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NA * NC * 3), 3));
        const idx = [];
        for (let r = 0; r < NA - 1; r++) for (let c = 0; c < NC - 1; c++) { const a = r * NC + c; idx.push(a, a + NC, a + 1, a + 1, a + NC, a + NC + 1); }
        fill.setIndex(idx);
        const fm = new THREE.Mesh(fill, new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.09, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
        fm.renderOrder = 2; fm.frustumCulled = false;
        const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xfff2c0, dashSize: 0.45, gapSize: 0.3, transparent: true, opacity: 0.85, depthWrite: false }));
        line.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((NA * 2 + NC + 1) * 3), 3));
        line.renderOrder = 3; line.frustumCulled = false;
        o = pool[i] = { fm, line, NA, NC, group: new THREE.Group() };
        o.group.add(fm, line); this.root.add(o.group);
      }
      i++;
      o.group.visible = true;
      const rows = beamGrid(this.world.grid, b, o.NA, o.NC);
      const fp = o.fm.geometry.attributes.position.array;
      let k = 0;
      for (const row of rows) for (const [x, y] of row) { fp.set([x, this.h(x, y) + 0.02, y], k); k += 3; }
      o.fm.geometry.attributes.position.needsUpdate = true;
      o.fm.geometry.computeBoundingSphere();
      const ring = [];
      for (let r = 0; r < o.NA; r++) ring.push(rows[r][0]);
      for (let c = 1; c < o.NC; c++) ring.push(rows[o.NA - 1][c]);
      for (let r = o.NA - 2; r >= 0; r--) ring.push(rows[r][o.NC - 1]);
      ring.push(rows[0][0]);
      const lp = o.line.geometry.attributes.position.array;
      ring.forEach(([x, y], n) => lp.set([x, this.h(x, y) + 0.03, y], n * 3));
      o.line.geometry.setDrawRange(0, ring.length);
      o.line.geometry.attributes.position.needsUpdate = true;
      o.line.computeLineDistances();
    }
    for (; i < pool.length; i++) pool[i].group.visible = false;
  }

  // ---------- selection rings ----------
  updateRings(heroes, selectedIds, t) {
    const seen = new Set();
    for (const h of heroes) {
      seen.add(h.id);
      let r = this.rings.get(h.id);
      if (!r) {
        r = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(h.colors?.accent || '#ffffff'), transparent: true, opacity: 0.9, depthWrite: false }));
        r.renderOrder = 4; this.root.add(r); this.rings.set(h.id, r);
      }
      const hidden = h.hidden && h.hidden.startsWith('b:');
      r.visible = !hidden && h.state !== 'dead';
      const sel = selectedIds.has(h.id);
      r.position.set(h._rx ?? h.x, this.h(h._rx ?? h.x, h._ry ?? h.y), h._ry ?? h.y);
      const s = h.state === 'down' ? 1.2 + 0.25 * Math.sin(t * 8) : sel ? 1.1 : 0.85;
      r.scale.setScalar(s);
      r.material.opacity = sel ? 0.95 : 0.35;
      if (h.state === 'down') r.material.color.set('#ff3b30'); else r.material.color.set(h.colors?.accent || '#ffffff');
    }
    for (const [id, r] of this.rings) if (!seen.has(id)) { this.root.remove(r); this.rings.delete(id); }
  }

  // ---------- noise rings ----------
  addNoise(x, y, r, kind) {
    const geo = new THREE.RingGeometry(0.94, 1, 48); geo.rotateX(-Math.PI / 2);
    const loud = kind === 'shot' || kind === 'explosion';
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: loud ? 0xff7a5a : 0xf6e7b0, transparent: true, opacity: 0.7, depthWrite: false }));
    m.position.set(x, this.h(x, y), y); m.renderOrder = 4;
    this.root.add(m);
    this.noiseRings.push({ m, r, t: 0, dur: loud ? 0.9 : 0.7 });
  }
  updateNoise(dt) {
    this.noiseRings = this.noiseRings.filter((n) => {
      n.t += dt;
      const k = n.t / n.dur;
      if (k >= 1) { this.root.remove(n.m); n.m.geometry.dispose(); n.m.material.dispose(); return false; }
      n.m.scale.setScalar(Math.max(0.01, n.r * (0.25 + 0.75 * k)));
      n.m.material.opacity = 0.7 * (1 - k);
      return true;
    });
  }

  // ---------- path preview ----------
  showRoutePreview(preview) {
    if (!this.previewDots) {
      this.previewDots = new THREE.InstancedMesh(this.pathDots.geometry, new THREE.MeshBasicMaterial({color:0xffffff,depthWrite:false}), 1600);
      this.previewDots.frustumCulled=false; this.previewDots.renderOrder=5;
      this.previewDots.userData.keepPainted=true; this.root.add(this.previewDots);
    }
    const samples=preview?.ok ? preview.samples.slice(0,1600) : [];
    const m=new THREE.Matrix4(), color=new THREE.Color();
    samples.forEach((p,i)=>{ m.makeScale(1.65,1,1.65); m.setPosition(p.x,this.h(p.x,p.y)+.025,p.y); this.previewDots.setMatrixAt(i,m); this.previewDots.setColorAt(i,color.set(p.seen?0xff795c:0xcbbd87)); });
    this.previewDots.count=samples.length; this.previewDots.instanceMatrix.needsUpdate=true;
    if(this.previewDots.instanceColor)this.previewDots.instanceColor.needsUpdate=true;
    this.pathDots.visible=!preview;
  }
  showPath(u) {
    const pts = u && u.path;
    if (!pts || u.pi >= pts.length) { this.pathDots.count = 0; return; }
    const m = new THREE.Matrix4();
    let n = 0;
    let px = u.x, py = u.y;
    for (let i = u.pi; i < pts.length && n < 400; i++) {
      const [qx, qy] = pts[i];
      const L = Math.hypot(qx - px, qy - py);
      const steps = Math.max(1, Math.floor(L / 0.45));
      for (let s = 1; s <= steps && n < 400; s++) {
        const x = px + (qx - px) * s / steps, y = py + (qy - py) * s / steps;
        m.makeTranslation(x, this.h(x, y), y);
        this.pathDots.setMatrixAt(n++, m);
      }
      px = qx; py = qy;
    }
    this.pathDots.count = n;
    this.pathDots.instanceMatrix.needsUpdate = true;
  }

  showRange(u, r) {
    if (!u || !r || r > 100) { this.rangeRing.visible = false; return; }
    this.rangeRing.visible = true;
    this.rangeRing.position.set(u._rx ?? u.x, this.h(u._rx ?? u.x, u._ry ?? u.y), u._ry ?? u.y);
    this.rangeRing.scale.setScalar(r);
  }
  showCursor(p, color = 0xffffff) {
    if (!p) { this.cursor.visible = false; return; }
    this.cursor.visible = true;
    this.cursor.material.color.set(color);
    this.cursor.position.set(p.x, this.h(p.x, p.y), p.y);
  }

  // ---------- patrol routes (Li Mei's scouting) ----------
  showRoutes(enemies) {
    if (this.routeLines) { this.root.remove(this.routeLines); this.routeLines.geometry.dispose(); this.routeLines = null; }
    const segs = [];
    for (const e of enemies) {
      if (!e.ai.route || e.state !== 'ok') continue;
      const r = e.ai.route;
      for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; segs.push(a.x, this.h(a.x, a.y) + 0.02, a.y, b.x, this.h(b.x, b.y) + 0.02, b.y); }
    }
    if (!segs.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
    this.routeLines = new THREE.LineSegments(g, new THREE.LineDashedMaterial({ color: 0xffd36b, dashSize: 0.4, gapSize: 0.25, transparent: true, opacity: 0.85, depthWrite: false }));
    this.routeLines.computeLineDistances();
    this.routeLines.renderOrder = 4;
    this.root.add(this.routeLines);
  }
  hideRoutes() { if (this.routeLines) { this.root.remove(this.routeLines); this.routeLines = null; } }

  // ---------- objective beacons ----------
  setMarkers(list) {
    while (this.markers.children.length) this.markers.remove(this.markers.children[0]);
    for (const mk of list) {
      const g = new THREE.CylinderGeometry(0.06, 0.32, 3.2, 12, 1, true);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: mk.color || 0xffd36b, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
      m.position.set(mk.x, this.h(mk.x, mk.y) + 1.6, mk.y);
      m.userData.base = m.position.y;
      this.markers.add(m);
      if (mk.zone) {
        const z = mk.zone;
        const shape = new THREE.EdgesGeometry(new THREE.PlaneGeometry(z.w, z.h));
        const l = new THREE.LineSegments(shape, new THREE.LineDashedMaterial({ color: mk.color || 0xffd36b, dashSize: 0.35, gapSize: 0.25, transparent: true, opacity: 0.8 }));
        l.rotation.x = -Math.PI / 2;
        l.position.set(z.x + z.w / 2, this.h(z.x + z.w / 2, z.y + z.h / 2) + 0.03, z.y + z.h / 2);
        l.computeLineDistances();
        this.markers.add(l);
      }
    }
  }
  animateMarkers(t) {
    for (const m of this.markers.children) if (m.userData.base !== undefined) { m.position.y = m.userData.base + Math.sin(t * 2) * 0.1; m.material.opacity = 0.25 + 0.15 * Math.sin(t * 3); }
  }
}
