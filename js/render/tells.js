import * as THREE from 'three';
import { trackLife, beamOf } from '../core/env.js';
import { castRay, angleDiff } from '../core/los.js';

// Environmental tells drawn on top of the world: footprints in snow (ground decals that fade as
// falling snow fills them in) and sweeping searchlights (a soft volumetric shaft from the lamp
// head plus a bright pool on the ground). Both read their state from the sim every frame, stay
// live in painted mode and are hidden in plate mode.

const MAX_PRINTS = 400;

// ---------------- footprints ----------------

// Soft-edged ellipse (white on black) for the decal masks.
function blob(g, x, y, rx, ry, a = 1, rot = 0) {
  g.save();
  g.translate(x, y); g.rotate(rot); g.scale(rx, ry);
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, 1);
  grd.addColorStop(0, `rgba(255,255,255,${a})`);
  grd.addColorStop(0.62, `rgba(255,255,255,${a * 0.85})`);
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fill();
  g.restore();
}

// Canvas top = direction of travel.
function maskTexture(kind) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 128);
  g.globalCompositeOperation = 'lighter';
  if (kind === 'boots') {
    // A faintly trodden lane (so a trail reads at a glance), then a left and a right boot a
    // stride apart: sole and heel, each a soft oval.
    const lane = g.createLinearGradient(0, 0, 64, 0);
    lane.addColorStop(0.08, 'rgba(255,255,255,0)'); lane.addColorStop(0.5, 'rgba(255,255,255,0.22)'); lane.addColorStop(0.92, 'rgba(255,255,255,0)');
    g.fillStyle = lane; g.fillRect(0, 0, 64, 128);
    for (const [x, y, r] of [[20, 88, -0.08], [44, 30, 0.08]]) {
      blob(g, x, y - 9, 9.5, 16, 0.8, r);
      blob(g, x + r * 20, y + 16, 7.5, 8, 0.85, r);
    }
  } else {
    // A body dragged through snow: a broad shallow trough with elbow and knee furrows.
    const grd = g.createLinearGradient(0, 0, 64, 0);
    grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.22, 'rgba(255,255,255,0.45)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.6)'); grd.addColorStop(0.78, 'rgba(255,255,255,0.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 128);
    for (const x of [13, 51]) for (let y = 8; y < 128; y += 30) blob(g, x, y, 5, 13, 0.55);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

// Multiplicative decal: darkens whatever is below (the 3D snow or the painted backdrop), so the
// prints read in every light without knowing the ground colour. Premultiplied output:
// dst * (1 - m) + dst * shade * m.
function printMaterial(tex, shade) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, shade: { value: new THREE.Color(...shade) } },
    vertexShader: `attribute float aFade; varying vec2 vUv; varying float vFade;
      void main() {
        vUv = uv; vFade = aFade;
        vec4 p = vec4(position, 1.0);
        #ifdef USE_INSTANCING
        p = instanceMatrix * p;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * p;
      }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 shade; varying vec2 vUv; varying float vFade;
      void main() {
        float m = texture2D(map, vUv).r * vFade;
        if (m < 0.004) discard;
        gl_FragColor = vec4(shade * m, m);
      }`,
    transparent: true, premultipliedAlpha: true, blending: THREE.MultiplyBlending,
    depthWrite: false, depthTest: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
}

class PrintLayer {
  constructor(kind, w, h, shade) {
    const geo = new THREE.PlaneGeometry(w, h);
    geo.rotateX(-Math.PI / 2);
    this.fade = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PRINTS), 1);
    this.fade.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFade', this.fade);
    this.mesh = new THREE.InstancedMesh(geo, printMaterial(maskTexture(kind), shade), MAX_PRINTS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.castShadow = this.mesh.receiveShadow = false;
    this.mesh.userData.noAO = true;
    this.mesh.userData.keepPainted = true;
    this.n = 0;
  }
}

export class Tracks {
  constructor(root, world, terrain) {
    this.world = world; this.terrain = terrain;
    this.boots = new PrintLayer('boots', 0.5, 0.82, [0.5, 0.57, 0.72]);
    this.drag = new PrintLayer('drag', 0.66, 0.95, [0.56, 0.62, 0.76]);
    root.add(this.boots.mesh, this.drag.mesh);
    this.m = new THREE.Matrix4();
  }

  update() {
    const w = this.world, list = w.s.tracks;
    const B = this.boots, D = this.drag;
    B.n = 0; D.n = 0;
    if (list && list.length) {
      const life = trackLife(w), now = w.s.t, m = this.m;
      for (const tr of list) {
        const age = now - tr.t;
        if (age < 0 || age > life) continue;
        const L = tr.prone ? D : B;
        if (L.n >= MAX_PRINTS) continue;
        const k = 1 - age / life;
        // Crisp for the first part of their life, then the snow slowly fills them in.
        const fade = Math.min(1, k * 2.4) * (0.4 + 0.6 * k);
        m.makeRotationY(-tr.a - Math.PI / 2);
        m.setPosition(tr.x, this.terrain.heightAt(tr.x, tr.y) + 0.045, tr.y);
        L.mesh.setMatrixAt(L.n, m);
        L.fade.array[L.n] = fade;
        L.n++;
      }
    }
    for (const L of [B, D]) {
      if (L.mesh.count !== L.n || L.n) {
        L.mesh.count = L.n;
        L.mesh.instanceMatrix.needsUpdate = true;
        L.fade.needsUpdate = true;
      }
    }
  }
}

// ---------------- searchlights ----------------

const ALONG = 26, ACROSS = 9;

// The lit ground of a beam, matching inBeam(): a wedge from the lamp out to its range, at least
// 1.1 tiles wide near the lamp, cut short by sight-blocking walls. Returns rows of [x, y, u, v]
// (u across -1..1, v along 0..1).
export function beamGrid(grid, b, nAlong = ALONG, nAcross = ACROSS, a = b.a) {
  const ca = Math.cos(a), sa = Math.sin(a), tw = Math.tan(b.width / 2);
  const rows = [];
  for (let i = 0; i < nAlong; i++) {
    const v = i / (nAlong - 1);
    const along = 0.5 + v * (b.range - 0.5);
    const half = Math.max(1.1, along * tw);
    const row = [];
    for (let j = 0; j < nAcross; j++) {
      const u = (j / (nAcross - 1)) * 2 - 1;
      let x = along * ca - u * half * sa, y = along * sa + u * half * ca;
      const d = Math.hypot(x, y);
      const lim = castRay(grid, b.x, b.y, Math.atan2(y, x), d);
      if (lim < d) { const s = lim / d; x *= s; y *= s; }
      row.push([b.x + x, b.y + y, u, v]);
    }
    rows.push(row);
  }
  return rows;
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(225,235,255,0.55)'); grd.addColorStop(1, 'rgba(200,215,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const BEAM_COLOR = new THREE.Color('#e4ecff');

function shaftMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uI: { value: 0 }, uCol: { value: BEAM_COLOR.clone() } },
    vertexShader: `varying vec3 vL; varying vec3 vN;
      void main() { vL = position; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uI; uniform vec3 uCol; varying vec3 vL; varying vec3 vN;
      void main() {
        float z = clamp(vL.z, 0.0, 1.0);
        float r = length(vL.xy) / max(z, 1e-3);
        // Soft silhouette: faces seen edge-on vanish, so the shaft has no hard outline.
        float facing = pow(abs(normalize(vN).z), 2.6);
        float a = uI * facing * (1.0 - 0.75 * z) * (1.0 - 0.75 * z) * smoothstep(0.0, 0.05, z) * smoothstep(1.0, 0.8, z);
        gl_FragColor = vec4(uCol * a, 1.0);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, side: THREE.DoubleSide, toneMapped: false,
  });
}

function poolMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uI: { value: 0 }, uCol: { value: BEAM_COLOR.clone() }, uHot: { value: 0.68 } },
    vertexShader: `attribute vec2 aUV; varying vec2 vUV; void main() { vUV = aUV; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uI, uHot; uniform vec3 uCol; varying vec2 vUV;
      void main() {
        float u = abs(vUV.x), v = vUV.y;
        // A faint wash over everything the beam lights (the area that counts in play)...
        float wash = 0.22 * smoothstep(1.0, 0.6, u) * smoothstep(0.0, 0.2, v) * smoothstep(1.0, 0.85, v);
        // ...and the bright, soft-edged ellipse where the beam strikes the ground.
        float d = length(vec2(u / 1.05, (v - uHot) / 0.17));
        float hot = 1.25 * smoothstep(1.0, 0.45, d) + 0.45 * smoothstep(1.7, 0.2, d);
        gl_FragColor = vec4(uCol * uI * (wash + hot), 1.0);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, toneMapped: false,
  });
}

let GLOW = null;

class Beam {
  constructor(root, sl, prop) {
    this.sl = sl; this.prop = prop;
    this.group = new THREE.Group();
    root.add(this.group);
    // Shaft: a unit cone, apex at the origin, opening along +z to radius 1 at z = 1.
    const cg = new THREE.ConeGeometry(1, 1, 36, 10, true);
    cg.translate(0, -0.5, 0); cg.rotateX(-Math.PI / 2);
    this.shaft = new THREE.Mesh(cg, shaftMaterial());
    this.shaft.frustumCulled = false; this.shaft.renderOrder = 6;
    // Ground pool: a deformable grid laid on the terrain every frame.
    const n = ALONG * ACROSS;
    const pg = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(n * 3), 3); this.pos.setUsage(THREE.DynamicDrawUsage);
    this.uv = new THREE.BufferAttribute(new Float32Array(n * 2), 2); this.uv.setUsage(THREE.DynamicDrawUsage);
    pg.setAttribute('position', this.pos); pg.setAttribute('aUV', this.uv);
    const idx = [];
    for (let i = 0; i < ALONG - 1; i++) for (let j = 0; j < ACROSS - 1; j++) {
      const a = i * ACROSS + j, b = a + 1, c = a + ACROSS, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    pg.setIndex(idx);
    this.pool = new THREE.Mesh(pg, poolMaterial());
    this.pool.frustumCulled = false; this.pool.renderOrder = 2;
    if (!GLOW) GLOW = glowTexture();
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: BEAM_COLOR, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.glow.renderOrder = 7;
    for (const o of [this.shaft, this.pool, this.glow]) { o.userData.noAO = true; o.userData.keepPainted = true; this.group.add(o); }
    // Lens glow on the lamp model goes dark with the light.
    this.lens = [];
    if (prop && Array.isArray(prop.material)) prop.material.forEach((m, i) => { if (m && m.isMeshBasicMaterial) this.lens.push(i); });
    this.lensOn = prop && Array.isArray(prop.material) ? this.lens.map((i) => prop.material[i]) : [];
    // A real light too, so soldiers caught in the beam light up (and, in 3D, the ground).
    // It lives outside the group and only dims when the lamp is out, so the light count (and
    // the compiled shaders) never change mid-game.
    this.spot = new THREE.SpotLight(BEAM_COLOR, 0, 30, 0.2, 0.6, 1);
    this.spot.castShadow = false;
    root.add(this.spot, this.spot.target);
    this.a = null;
  }
}

const LENS_OFF = new THREE.MeshStandardMaterial({ color: 0x20242a, roughness: 0.3, metalness: 0.4 });

export class Beams {
  constructor(root, world, terrain, thingViews, opts = {}) {
    this.world = world; this.terrain = terrain;
    this.list = (world.searchlights || []).map((sl) => new Beam(root, sl, thingViews.get(sl.id)));
    // How visible the beam is: haze and darkness make the shaft; bright day all but hides it.
    const tod = world.def.time, wx = world.def.weather;
    const dark = tod === 'night' ? 1 : tod === 'dusk' ? 0.6 : tod === 'dawn' ? 0.45 : 0.12;
    const haze = ['fog', 'smoke', 'snow', 'blizzard', 'rain', 'storm'].includes(wx) ? 1.5 : 1;
    this.shaftI = 0.22 * dark * haze;
    // On painted maps the ground is a picture, so the pool carries all of the light; in 3D the
    // spot light does most of it.
    this.poolI = (opts.painted ? 0.42 : 0.2) * (0.35 + 0.65 * dark);
    this.spotI = 18 * (0.2 + 0.8 * dark);
    this.glowS = 0.9 + dark * 0.8;
  }

  // A beam as drawn this frame: the sim's bearing, eased so 30 Hz steps don't show.
  beams(dt = 0) {
    const out = [];
    for (const B of this.list) {
      const b = beamOf(this.world, B.sl);
      if (B.a === null || !dt) B.a = b.a;
      else B.a += angleDiff(B.a, b.a) * Math.min(1, dt * 18);
      out.push({ ...b, a: B.a, B, destroyed: !!(this.world.s.objs[B.sl.id] || {}).destroyed });
    }
    return out;
  }

  update(dt) {
    const T = this.terrain, g = this.world.grid;
    const list = this.beams(dt);
    for (const b of list) {
      const B = b.B;
      if (B.prop && !b.destroyed) B.prop.rotation.y = -B.a + Math.PI / 2;
      if (B.prop && Array.isArray(B.prop.material)) B.lens.forEach((i, k) => { B.prop.material[i] = b.on ? B.lensOn[k] : LENS_OFF; });
      B.group.visible = b.on;
      B.spot.intensity = b.on ? this.spotI : 0;
      if (!b.on) continue;
      const ca = Math.cos(B.a), sa = Math.sin(B.a);
      // Lamp head: on the model, just in front of the drum.
      const px = B.prop ? B.prop.position.x : b.x, pz = B.prop ? B.prop.position.z : b.y;
      const head = new THREE.Vector3(px + ca * 0.45, T.heightAt(px, pz) + 1.12, pz + sa * 0.45);
      B.glow.position.copy(head);
      B.glow.scale.setScalar(this.glowS);
      // Shaft: aimed at the hot spot, long enough to bury its far end in the ground.
      const reachHot = Math.min(b.range * 0.68, castRay(g, b.x, b.y, B.a, b.range));
      const hx = b.x + ca * reachHot, hy = b.y + sa * reachHot;
      const target = new THREE.Vector3(hx, T.heightAt(hx, hy), hy);
      const dist = Math.max(0.5, head.distanceTo(target));
      const L = dist * 1.25;
      const halfHot = Math.max(1.1, reachHot * Math.tan(b.width / 2));
      const R = halfHot * L / dist;
      B.shaft.position.copy(head);
      B.shaft.lookAt(target);
      B.shaft.scale.set(R, R, L);
      B.shaft.material.uniforms.uI.value = this.shaftI;
      B.spot.position.copy(head);
      B.spot.target.position.copy(target);
      B.spot.angle = Math.min(1.2, Math.atan(halfHot / dist) * 1.35);
      B.spot.distance = b.range * 1.5;
      // Pool.
      const rows = beamGrid(g, { ...b, a: B.a });
      const p = B.pos.array, uv = B.uv.array;
      let k = 0;
      for (const row of rows) for (const [x, y, u, v] of row) {
        p[k * 3] = x; p[k * 3 + 1] = T.heightAt(x, y) + 0.06; p[k * 3 + 2] = y;
        uv[k * 2] = u; uv[k * 2 + 1] = v;
        k++;
      }
      B.pos.needsUpdate = true; B.uv.needsUpdate = true;
      B.pool.material.uniforms.uI.value = this.poolI;
      B.pool.material.uniforms.uHot.value = Math.min(0.68, reachHot / b.range);
    }
    return list;
  }
}

// ---------------- flares and other temporary lights ----------------

function poolDiskMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uI: { value: 0 }, uCol: { value: new THREE.Color('#ffe2b0') } },
    vertexShader: 'varying vec2 vP; void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uI; uniform vec3 uCol; varying vec2 vP;
      void main() { float d = length(vP); float a = uI * smoothstep(1.0, 0.0, d) * (0.45 + 0.55 * smoothstep(1.0, 0.2, d)); gl_FragColor = vec4(uCol * a, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, toneMapped: false,
  });
}

// Flares (api.flare): a burning star drifting down on its parachute, or a fire on the ground,
// lighting a circle that shrinks as it dies. Two real lights are shared by the nearest flares.
class Flares {
  constructor(root, world, terrain, fx) {
    this.world = world; this.terrain = terrain; this.fx = fx; this.root = root;
    this.items = new Map();
    this.lights = [0, 1].map(() => { const p = new THREE.PointLight(0xffd9a0, 0, 20, 1.2); root.add(p); return p; });
    const night = world.def.time === 'night' ? 1 : world.def.time === 'dusk' || world.def.time === 'dawn' ? 0.6 : 0.25;
    this.dark = night;
  }
  update(time) {
    const w = this.world, list = (w.s.flares || []).filter((f) => w.flareReach(f) > 0);
    const live = new Set(list.map((f) => f.id));
    for (const [id, o] of this.items) if (!live.has(id)) { this.root.remove(o.group); this.items.delete(id); }
    for (const f of list) {
      let o = this.items.get(f.id);
      if (!o) {
        if (!GLOW) GLOW = glowTexture();
        const group = new THREE.Group();
        const col = new THREE.Color(f.color || (f.kind === 'fire' ? '#ffb070' : '#fff1d0'));
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        const dg = new THREE.CircleGeometry(1, 40); dg.rotateX(-Math.PI / 2);
        const disk = new THREE.Mesh(dg, poolDiskMaterial()); disk.material.uniforms.uCol.value.copy(col);
        disk.renderOrder = 2; disk.frustumCulled = false;
        for (const m of [sprite, disk]) { m.userData.noAO = true; m.userData.keepPainted = true; group.add(m); }
        this.root.add(group);
        o = { group, sprite, disk, col };
        if (f.kind === 'fire' && this.fx) this.fx.addFire(f.x, f.y, 1.4, time + f.dur);
        this.items.set(f.id, o);
      }
      const reach = w.flareReach(f), k = reach / f.r, age = (w.s.t - f.t0) / f.dur;
      const g = this.terrain.heightAt(f.x, f.y);
      const flick = 0.9 + 0.1 * Math.sin(time * 17 + f.x) * Math.sin(time * 7.3);
      const hy = f.kind === 'fire' ? g + 0.9 : g + 2 + 10 * (1 - age);
      const dx = f.kind === 'fire' ? 0 : Math.sin(age * 3 + f.y) * 0.8;
      o.sprite.position.set(f.x + dx, hy, f.y);
      o.sprite.scale.setScalar((f.kind === 'fire' ? 2.6 : 1.8) * (0.6 + 0.4 * k) * flick);
      o.disk.position.set(f.x + dx, g + 0.07, f.y);
      o.disk.scale.setScalar(Math.max(0.1, reach));
      o.disk.material.uniforms.uI.value = 0.55 * this.dark * k * flick;
      o.light = { x: f.x + dx, y: hy, z: f.y, i: 40 * k * flick, d: f.r * 2.2, col: o.col };
    }
    // The two real lights go to the brightest flares.
    const lit = [...this.items.values()].map((o) => o.light).filter(Boolean).sort((a, b) => b.i - a.i);
    this.lights.forEach((p, i) => {
      const L = lit[i];
      if (!L) { p.intensity = 0; return; }
      p.position.set(L.x, L.y, L.z); p.intensity = L.i * this.dark; p.distance = L.d; p.color.copy(L.col);
    });
  }
}

// Lights people carry: a patrol's lantern, a lorry's or a train's lamps (`lantern` on an
// enemy, `lights` on a vehicle). A warm glow at the hand and a pool on the ground; the two
// nearest to the camera also get a real light.
class Lanterns {
  constructor(root, world, terrain) {
    this.world = world; this.terrain = terrain; this.root = root;
    this.items = new Map();
    this.lights = [0, 1].map(() => { const p = new THREE.PointLight(0xffc27a, 0, 8, 1.4); root.add(p); return p; });
    const t = world.def.time;
    this.dark = t === 'night' ? 1 : t === 'dusk' || t === 'dawn' ? 0.6 : 0.2;
  }
  update(time, views, cam) {
    const w = this.world;
    const list = w.ents.filter((e) => e.lantern && e.state === 'ok' && !(e.hidden && e.hidden.startsWith('b:')));
    const live = new Set(list.map((e) => e.id));
    for (const [id, o] of this.items) if (!live.has(id)) { this.root.remove(o.group); this.items.delete(id); }
    const cands = [];
    for (const e of list) {
      let o = this.items.get(e.id);
      if (!o) {
        if (!GLOW) GLOW = glowTexture();
        const group = new THREE.Group();
        const col = new THREE.Color(e.kind === 'vehicle' ? '#fff0d0' : '#ffc27a');
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        const dg = new THREE.CircleGeometry(1, 32); dg.rotateX(-Math.PI / 2);
        const disk = new THREE.Mesh(dg, poolDiskMaterial()); disk.material.uniforms.uCol.value.copy(col);
        disk.renderOrder = 2; disk.frustumCulled = false;
        for (const m of [sprite, disk]) { m.userData.noAO = true; m.userData.keepPainted = true; group.add(m); }
        this.root.add(group);
        o = { group, sprite, disk, col };
        this.items.set(e.id, o);
      }
      const v = views.get(e.id);
      const x = v ? v.root.position.x : e.x, z = v ? v.root.position.z : e.y, a = e._ra ?? e.a;
      const g = this.terrain.heightAt(x, z);
      const fwd = e.kind === 'vehicle' ? 1.4 : 0.32;
      const hx = x + Math.cos(a) * fwd, hz = z + Math.sin(a) * fwd;
      const flick = e.kind === 'vehicle' ? 1 : 0.92 + 0.08 * Math.sin(time * 11 + e.x * 3);
      o.sprite.position.set(hx, g + (e.kind === 'vehicle' ? 0.9 : 0.85), hz);
      o.sprite.scale.setScalar((e.kind === 'vehicle' ? 1.3 : 0.9) * flick);
      const px = x + Math.cos(a) * e.lantern * 0.35, pz = z + Math.sin(a) * e.lantern * 0.35;
      o.disk.position.set(e.kind === 'vehicle' ? px : x, g + 0.07, e.kind === 'vehicle' ? pz : z);
      o.disk.scale.setScalar(e.lantern);
      o.disk.material.uniforms.uI.value = 0.42 * this.dark * flick;
      cands.push({ x: hx, y: g + 1.0, z: hz, d: cam ? Math.hypot(hx - cam.x, hz - cam.z) : 0, r: e.lantern, col: o.col, i: 6 * flick });
    }
    cands.sort((p, q) => p.d - q.d);
    this.lights.forEach((p, i) => {
      const L = cands[i];
      if (!L) { p.intensity = 0; return; }
      p.position.set(L.x, L.y, L.z); p.intensity = L.i * this.dark; p.distance = L.r * 2; p.color.copy(L.col);
    });
  }
}

// Aircraft crossing the map (api.flyover): the plane model at altitude, banking slightly, its
// shadow on the ground, dust kicked up along a strafing run.
class Planes {
  constructor(root, world, terrain, fx, buildModel) {
    this.world = world; this.terrain = terrain; this.fx = fx; this.root = root; this.build = buildModel;
    this.items = new Map();
    const sg = new THREE.CircleGeometry(1, 24); sg.rotateX(-Math.PI / 2);
    this.shadowGeo = sg;
    this.shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false });
  }
  update(time) {
    const w = this.world, list = w.s.planes || [];
    const live = new Set(list.map((p) => p.id));
    for (const [id, o] of this.items) if (!live.has(id)) { this.root.remove(o.group); this.items.delete(id); }
    for (const p of list) {
      let o = this.items.get(p.id);
      if (!o) {
        const group = new THREE.Group();
        const model = this.build(p.kind);
        if (model) { model.traverse((c) => { if (c.isMesh) { c.castShadow = false; c.userData.noAO = true; } }); group.add(model); }
        const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
        shadow.scale.set(p.kind === 'bomber' ? 3.5 : 2.5, 1, p.kind === 'bomber' ? 2.2 : 1.6);
        shadow.renderOrder = 2; shadow.userData.keepPainted = true;
        this.root.add(group, shadow);
        o = { group, model, shadow };
        this.items.set(p.id, o);
      }
      const P = w.planePos(p);
      const g = this.terrain.heightAt(P.x, P.y);
      o.group.position.set(P.x, g + p.alt, P.y);
      o.group.rotation.set(0, -P.a + Math.PI / 2, Math.sin(time * 0.8 + P.k * 3) * 0.06);
      // The shadow falls a little away from the sun, stretched along the heading.
      o.shadow.position.set(P.x + 1.2, g + 0.08, P.y + 1.2);
      o.shadow.rotation.y = -P.a;
      o.shadow.visible = P.k > 0 && P.k < 1;
    }
  }
}

// Things in flight (stones, grenades, firecrackers, smoke cans): a small object on a lobbed arc,
// and a grenade lying on the ground under a pulsing red warning ring until it goes off.
const PROJ_LOOK = {
  stone: { geo: () => new THREE.IcosahedronGeometry(0.07, 0), color: 0x8a857a },
  grenade: { geo: () => new THREE.CylinderGeometry(0.06, 0.06, 0.16, 8), color: 0x3c4430 },
  firecracker: { geo: () => new THREE.CylinderGeometry(0.035, 0.035, 0.16, 6), color: 0xb02a20 },
  smoke: { geo: () => new THREE.CylinderGeometry(0.06, 0.06, 0.18, 8), color: 0x6a6e66 },
};
class Projectiles {
  constructor(root, world, terrain) {
    this.world = world; this.terrain = terrain; this.root = root;
    this.pool = []; this.rings = [];
    this.geos = {}; this.mats = {};
    for (const [k, v] of Object.entries(PROJ_LOOK)) { this.geos[k] = v.geo(); this.mats[k] = new THREE.MeshStandardMaterial({ color: v.color, roughness: 0.7, metalness: 0.2 }); }
    const rg = new THREE.RingGeometry(0.42, 0.55, 28); rg.rotateX(-Math.PI / 2);
    this.ringGeo = rg;
  }
  mesh(i, kind) {
    let m = this.pool[i];
    if (!m) { m = new THREE.Mesh(this.geos.stone, this.mats.stone); m.castShadow = true; m.userData.noAO = true; m.scale.setScalar(1.8); this.root.add(m); this.pool[i] = m; }
    m.geometry = this.geos[kind] || this.geos.stone; m.material = this.mats[kind] || this.mats.stone;
    m.visible = true;
    return m;
  }
  ring(i) {
    let r = this.rings[i];
    if (!r) { r = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, depthWrite: false })); r.renderOrder = 5; r.userData.keepPainted = true; this.root.add(r); this.rings[i] = r; }
    r.visible = true;
    return r;
  }
  update(time) {
    const H = (x, y) => this.terrain.heightAt(x, y);
    let n = 0, nr = 0;
    for (const p of this.world.s.proj || []) {
      const m = this.mesh(n++, p.kind);
      const landed = p.fuse !== undefined;                 // a grenade on the ground, fuse burning
      const k = landed ? 1 : Math.min(1, p.t / p.dur);
      const x = p.sx + (p.x - p.sx) * k, z = p.sy + (p.y - p.sy) * k;
      const dist = Math.hypot(p.x - p.sx, p.y - p.sy);
      const arc = Math.min(3, 0.6 + dist * 0.22);
      const y0 = H(p.sx, p.sy) + 1.1, y1 = H(p.x, p.y) + 0.06;
      m.position.set(x, landed ? y1 : y0 + (y1 - y0) * k + Math.sin(Math.PI * k) * arc, z);
      m.rotation.set(time * 9 * (landed ? 0 : 1), 0, landed ? Math.PI / 2 : time * 7);
      if (landed && p.kind === 'grenade') {
        const r = this.ring(nr++);
        const left = Math.max(0, p.dur - p.t);
        r.position.set(p.x, y1 + 0.02, p.y);
        r.scale.setScalar(2.2 * (0.85 + 0.15 * Math.sin(time * 18)));
        r.material.opacity = 0.55 + 0.4 * Math.sin(time * (10 + 14 / Math.max(0.2, left)));
      }
    }
    for (let i = n; i < this.pool.length; i++) this.pool[i].visible = false;
    for (let i = nr; i < this.rings.length; i++) this.rings[i].visible = false;
  }
}

// All the tells under one root, so plate mode can hide them together.
export class Tells {
  constructor(scene, world, terrain, thingViews, opts = {}) {
    this.root = new THREE.Group();
    this.root.name = 'tells';
    this.root.userData.noAO = true;
    scene.add(this.root);
    this.tracks = new Tracks(this.root, world, terrain);
    this.beams = new Beams(this.root, world, terrain, thingViews, opts);
    this.flares = new Flares(this.root, world, terrain, opts.fx);
    // Only missions that use carried lights pay for their two extra lights.
    this.lanterns = world.ents.some((e) => e.lantern) || opts.lanterns ? new Lanterns(this.root, world, terrain) : null;
    this.views = opts.views || null;
    this.planes = opts.buildModel ? new Planes(this.root, world, terrain, opts.fx, opts.buildModel) : null;
    this.projectiles = new Projectiles(this.root, world, terrain);
    this.current = [];
    this.time = 0;
  }
  update(dt, time, cam) {
    this.time = time ?? this.time + dt;
    this.tracks.update();
    this.current = this.beams.update(dt);
    this.flares.update(this.time);
    if (this.lanterns) this.lanterns.update(this.time, this.views || new Map(), cam);
    if (this.planes) this.planes.update(this.time);
    this.projectiles.update(this.time);
  }
}
