import * as THREE from 'three';

// Particles, tracers, flashes and weather.

function softTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.65)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const SOFT = softTexture();

class ParticleLayer {
  constructor(max, additive) {
    this.max = max;
    this.ps = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { tex: { value: SOFT }, uScale: { value: 30 } },
      vertexShader: `attribute vec4 aColor; attribute float aSize; uniform float uScale; varying vec4 vC;
        void main(){ vC = aColor; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uScale; }`,
      fragmentShader: `uniform sampler2D tex; varying vec4 vC; void main(){ vec4 t = texture2D(tex, gl_PointCoord); gl_FragColor = vec4(vC.rgb, vC.a * t.a); }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 7 : 6;
  }
  add(p) { if (this.ps.length < this.max) this.ps.push(p); }
  update(dt) {
    const keep = [];
    for (const p of this.ps) {
      p.t += dt;
      if (p.t >= p.life) continue;
      p.vy += (p.grav || 0) * dt;
      const d = Math.pow(p.drag ?? 0.6, dt);
      p.vx *= d; p.vz *= d; p.vy *= p.grav ? 1 : d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.floor !== undefined && p.y < p.floor) { p.y = p.floor; p.vy *= -0.3; p.vx *= 0.5; p.vz *= 0.5; }
      keep.push(p);
    }
    this.ps = keep;
    const n = this.ps.length;
    for (let i = 0; i < n; i++) {
      const p = this.ps[i], k = p.t / p.life;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      const a = p.c0, b = p.c1 || p.c0;
      this.col[i * 4] = a[0] + (b[0] - a[0]) * k; this.col[i * 4 + 1] = a[1] + (b[1] - a[1]) * k;
      this.col[i * 4 + 2] = a[2] + (b[2] - a[2]) * k;
      const fadeIn = Math.min(1, p.t / (p.fadeIn || 0.05));
      this.col[i * 4 + 3] = (a[3] + (b[3] - a[3]) * k) * fadeIn;
      this.size[i] = p.s0 + (p.s1 - p.s0) * k;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    g.attributes.position.needsUpdate = true; g.attributes.aColor.needsUpdate = true; g.attributes.aSize.needsUpdate = true;
  }
}

export class Fx {
  constructor(scene, terrain, weather, tod) {
    this.scene = scene; this.terrain = terrain;
    this.smoke = new ParticleLayer(2500, false);
    this.fire = new ParticleLayer(2500, true);
    scene.add(this.smoke.points, this.fire.points);
    this.emitters = [];  // persistent: { x, y, kind, rate, acc, until }
    this.tracers = [];
    this.flashes = [];
    this.decals = new THREE.Group(); this.decals.userData.noAO = true; scene.add(this.decals);
    this.flashLight = new THREE.PointLight(0xffb060, 0, 14, 1.6);
    scene.add(this.flashLight);
    this.weather = weather;
    this.tod = tod;
    this.setupWeather(weather);
    this.shake = 0;
  }

  gy(x, z) { return this.terrain.heightAt(x, z); }

  // ---------- one-shot effects ----------
  explosion(x, z, r = 2.4) {
    const y = this.gy(x, z);
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * 6.28, sp = 2 + Math.random() * 5 * r / 2.4;
      this.fire.add({ x, y: y + 0.3, z, vx: Math.cos(a) * sp, vy: 1.5 + Math.random() * 4, vz: Math.sin(a) * sp, t: 0, life: 0.35 + Math.random() * 0.45, s0: 1.8, s1: 0.4, c0: [1, 0.85, 0.5, 1], c1: [1, 0.3, 0.05, 0], drag: 0.08 });
    }
    for (let i = 0; i < 34; i++) {
      const a = Math.random() * 6.28, sp = Math.random() * 2.5;
      this.smoke.add({ x: x + Math.cos(a) * 0.5, y: y + 0.4, z: z + Math.sin(a) * 0.5, vx: Math.cos(a) * sp, vy: 1 + Math.random() * 2.2, vz: Math.sin(a) * sp, t: 0, life: 2.5 + Math.random() * 2.5, s0: 1.2, s1: 4.5, c0: [0.18, 0.16, 0.14, 0.75], c1: [0.4, 0.38, 0.36, 0], drag: 0.4, fadeIn: 0.2 });
    }
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * 6.28, sp = 3 + Math.random() * 6;
      this.smoke.add({ x, y: y + 0.4, z, vx: Math.cos(a) * sp, vy: 4 + Math.random() * 5, vz: Math.sin(a) * sp, t: 0, life: 1.3, s0: 0.25, s1: 0.2, c0: [0.12, 0.1, 0.08, 1], c1: [0.12, 0.1, 0.08, 1], grav: -14, drag: 0.9, floor: y + 0.05 });
    }
    this.flash(x, y + 1.2, z, 1.4, 6 + r * 2);
    const scorch = new THREE.Mesh(new THREE.CircleGeometry(r * 0.75, 20), new THREE.MeshBasicMaterial({ color: 0x0c0a08, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    scorch.rotation.x = -Math.PI / 2; scorch.position.set(x, y + 0.03, z); scorch.renderOrder = 1;
    this.decals.add(scorch);
    this.shake = Math.min(1.2, this.shake + r * 0.25);
  }
  flash(x, y, z, dur, intensity) { this.flashes.push({ x, y, z, t: 0, dur: dur * 0.25, i: intensity }); }
  muzzle(from, to, hit, quiet) {
    const y0 = this.gy(from.x, from.y) + 1.1;
    const y1 = this.gy(to.x, to.y) + (hit ? 0.9 : 0.3);
    const dx = to.x - from.x, dz = to.y - from.y, L = Math.hypot(dx, dz) || 1;
    const mx = from.x + dx / L * 0.6, mz = from.y + dz / L * 0.6;
    if (!quiet) {
      this.fire.add({ x: mx, y: y0, z: mz, vx: 0, vy: 0, vz: 0, t: 0, life: 0.07, s0: 1.1, s1: 0.5, c0: [1, 0.9, 0.6, 1], c1: [1, 0.6, 0.2, 0] });
      this.flash(mx, y0, mz, 0.3, 2.5);
    }
    const missX = hit ? 0 : (Math.random() - 0.5) * 1.5, missZ = hit ? 0 : (Math.random() - 0.5) * 1.5;
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(mx, y0, mz), new THREE.Vector3(to.x + missX, y1, to.y + missZ)]);
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: quiet ? 0x9aa0a8 : 0xffe2a0, transparent: true, opacity: quiet ? 0.25 : 0.85 }));
    this.scene.add(l);
    this.tracers.push({ l, t: 0 });
    if (!hit) this.dust(to.x + missX, to.y + missZ, 3);
  }
  dust(x, z, n = 6, col = [0.55, 0.5, 0.42]) {
    const y = this.gy(x, z);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28;
      this.smoke.add({ x, y: y + 0.1, z, vx: Math.cos(a) * 0.8, vy: 0.5 + Math.random(), vz: Math.sin(a) * 0.8, t: 0, life: 0.8 + Math.random() * 0.6, s0: 0.3, s1: 1.1, c0: [...col, 0.55], c1: [...col, 0], drag: 0.3 });
    }
  }
  splash(x, z) {
    const y = this.gy(x, z) + 0.6;
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * 6.28;
      this.smoke.add({ x, y, z, vx: Math.cos(a) * 1.2, vy: 2 + Math.random() * 2, vz: Math.sin(a) * 1.2, t: 0, life: 0.7, s0: 0.25, s1: 0.5, c0: [0.85, 0.92, 0.95, 0.8], c1: [0.85, 0.92, 0.95, 0], grav: -9 });
    }
  }
  sparkle(x, z) {
    const y = this.gy(x, z) + 0.4;
    this.fire.add({ x, y, z, vx: 0, vy: 0.2, vz: 0, t: 0, life: 0.6, s0: 0.5, s1: 0.1, c0: [1, 0.95, 0.7, 0.9], c1: [1, 0.9, 0.5, 0] });
  }
  firecrackers(x, z) {
    for (let i = 0; i < 6; i++) setTimeout(() => { this.flash(x, this.gy(x, z) + 0.3, z, 0.2, 1.5); this.dust(x + (Math.random() - 0.5), z + (Math.random() - 0.5), 3, [0.7, 0.7, 0.7]); }, i * 110);
  }

  // ---------- persistent emitters ----------
  addFire(x, z, size = 1, until = Infinity, smoke = true) { this.emitters.push({ x, z, kind: 'fire', size, acc: 0, until, smoke }); }
  addSmokeColumn(x, z, size = 1, until = Infinity, color = null) { this.emitters.push({ x, z, kind: 'smoke', size, acc: 0, until, color }); }

  updateEmitters(dt, now) {
    this.emitters = this.emitters.filter((e) => e.until > now);
    for (const e of this.emitters) {
      e.acc += dt;
      const y = this.gy(e.x, e.z);
      if (e.kind === 'fire') {
        while (e.acc > 0.03) {
          e.acc -= 0.03;
          this.fire.add({ x: e.x + (Math.random() - 0.5) * e.size, y: y + 0.15, z: e.z + (Math.random() - 0.5) * e.size, vx: (Math.random() - 0.5) * 0.3, vy: 1.4 + Math.random() * 1.2, vz: (Math.random() - 0.5) * 0.3, t: 0, life: 0.5 + Math.random() * 0.4, s0: 0.9 * e.size, s1: 0.15, c0: [1, 0.7, 0.25, 0.9], c1: [0.9, 0.2, 0.02, 0] });
          if (e.smoke && Math.random() < 0.35) this.smoke.add({ x: e.x, y: y + 1.0 * e.size, z: e.z, vx: 0.25, vy: 1.2, vz: 0.1, t: 0, life: 3.5, s0: 0.8 * e.size, s1: 3.2 * e.size, c0: [0.14, 0.13, 0.12, 0.5], c1: [0.35, 0.34, 0.33, 0], drag: 0.7, fadeIn: 0.3 });
        }
      } else if (e.kind === 'smoke') {
        while (e.acc > 0.12) {
          e.acc -= 0.12;
          const c = e.color;
          this.smoke.add({ x: e.x + (Math.random() - 0.5), y: y + 0.5, z: e.z + (Math.random() - 0.5), vx: 0.35, vy: 1.0, vz: 0.15, t: 0, life: 6, s0: 1.2 * e.size, s1: 5 * e.size, c0: c ? [c[0] * 0.6, c[1] * 0.6, c[2] * 0.6, 0.5] : [0.2, 0.19, 0.18, 0.45], c1: c ? [c[0], c[1], c[2], 0] : [0.42, 0.41, 0.4, 0], drag: 0.8, fadeIn: 0.6 });
        }
      }
    }
  }

  // ---------- weather ----------
  // Swap the weather particles (a mid-mission change: api.weather).
  changeWeather(w) {
    if (w === this.weather) return;
    if (this.rain) { this.scene.remove(this.rain); this.rain.geometry.dispose(); }
    if (this.snow) this.scene.remove(this.snow.points);
    if (this.embers) this.scene.remove(this.embers.points);
    this.weather = w;
    this.setupWeather(w);
  }
  setupWeather(w) {
    this.rain = null; this.snow = null; this.embers = null;
    if (w === 'rain' || w === 'storm') {
      const n = 2200;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
      this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xa8b8c8, transparent: true, opacity: 0.35 }));
      this.rain.frustumCulled = false;
      this.rainDrops = Array.from({ length: n }, () => ({ x: (Math.random() - 0.5) * 70, y: Math.random() * 25, z: (Math.random() - 0.5) * 70, v: 22 + Math.random() * 8 }));
      this.scene.add(this.rain);
    }
    if (w === 'snow' || w === 'blizzard') {
      const n = w === 'blizzard' ? 4000 : 2500;
      this.snow = new ParticleLayer(n, false);
      this.snowFlakes = Array.from({ length: n }, () => ({ x: (Math.random() - 0.5) * 70, y: Math.random() * 25, z: (Math.random() - 0.5) * 70, p: Math.random() * 6, v: 0.8 + Math.random() * 0.8 }));
      this.blizzard = w === 'blizzard';
      this.scene.add(this.snow.points);
    }
    if (w === 'smoke') {
      this.embers = new ParticleLayer(500, true);
      this.scene.add(this.embers.points);
    }
  }

  updateWeather(dt, center, scale) {
    if (this.rain) {
      const pos = this.rain.geometry.attributes.position.array;
      this.rainDrops.forEach((d, i) => {
        d.y -= d.v * dt; d.x -= 2 * dt;
        if (d.y < 0) { d.y = 20 + Math.random() * 5; d.x = (Math.random() - 0.5) * 70; d.z = (Math.random() - 0.5) * 70; }
        const x = center.x + d.x, z = center.z + d.z;
        pos.set([x, d.y, z, x + 0.06, d.y + 0.55, z], i * 6);
      });
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
    if (this.snow) {
      this.snow.ps = this.snowFlakes.map((f) => {
        f.y -= f.v * dt * (this.blizzard ? 1.8 : 1); f.p += dt;
        if (f.y < 0) { f.y = 20 + Math.random() * 5; f.x = (Math.random() - 0.5) * 70; f.z = (Math.random() - 0.5) * 70; }
        const drift = this.blizzard ? f.y * 0.4 - 6 : Math.sin(f.p) * 0.4;
        return { x: center.x + f.x + drift, y: f.y, z: center.z + f.z + Math.cos(f.p * 0.7) * 0.3, vx: 0, vy: 0, vz: 0, t: 0, life: 1e9, s0: 0.14, s1: 0.14, c0: [1, 1, 1, 0.85] };
      });
      this.snow.update(0);
      this.snow.mat.uniforms.uScale.value = scale;
    }
    if (this.embers) {
      if (Math.random() < 0.6) {
        this.embers.add({ x: center.x + (Math.random() - 0.5) * 50, y: 0.5, z: center.z + (Math.random() - 0.5) * 50, vx: 0.6, vy: 0.8 + Math.random(), vz: 0.2, t: 0, life: 5, s0: 0.12, s1: 0.04, c0: [1, 0.6, 0.2, 0.9], c1: [1, 0.3, 0.05, 0] });
      }
      this.embers.update(dt);
      this.embers.mat.uniforms.uScale.value = scale;
    }
  }

  update(dt, now, center, scale) {
    this.updateEmitters(dt, now);
    this.smoke.update(dt); this.fire.update(dt);
    this.smoke.mat.uniforms.uScale.value = scale; this.fire.mat.uniforms.uScale.value = scale;
    this.tracers = this.tracers.filter((tr) => {
      tr.t += dt;
      tr.l.material.opacity *= 0.82;
      if (tr.t > 0.15) { this.scene.remove(tr.l); tr.l.geometry.dispose(); tr.l.material.dispose(); return false; }
      return true;
    });
    let best = null;
    this.flashes = this.flashes.filter((f) => { f.t += dt; if (f.t > f.dur) return false; if (!best || f.i > best.i) best = f; return true; });
    if (best) { this.flashLight.position.set(best.x, best.y, best.z); this.flashLight.intensity = best.i * 8 * (1 - best.t / best.dur); }
    else this.flashLight.intensity = 0;
    this.updateWeather(dt, center, scale);
    this.shake = Math.max(0, this.shake - dt * 2.5);
  }
}
