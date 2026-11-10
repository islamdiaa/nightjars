import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { boxUV, SLOTS } from './materials.js';

// The modelling kit. Parts are primitives (or custom geometry) with a PBR material slot and a
// tint; Kit merges all parts that share a slot into one geometry group, so a whole building is a
// single mesh with one draw call per material. UVs are box-projected in metres so textures keep
// a consistent real-world scale across parts.

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const col = new THREE.Color();
let detailed = false;
export function setModelDetail(on) { detailed = !!on; }

// Small real bevels catch light on metalwork and masonry. The silhouette stays
// INSIDE the original bounds; gameplay footprints and the painted pipeline are unchanged.
function edgedBox(w,h,d,radius) {
  const geo=new THREE.BoxGeometry(w,h,d,3,3,3), p=geo.attributes.position, n=geo.attributes.normal;
  const half=[w/2,h/2,d/2], v=new THREE.Vector3(), inner=new THREE.Vector3(), normal=new THREE.Vector3();
  for(let i=0;i<p.count;i++) {
    v.fromBufferAttribute(p,i); inner.set(...half.map((h,j)=>Math.max(-h+radius,Math.min(h-radius,v.getComponent(j)))));
    normal.copy(v).sub(inner).normalize(); v.copy(inner).addScaledVector(normal,radius);
    p.setXYZ(i,v.x,v.y,v.z); n.setXYZ(i,normal.x,normal.y,normal.z);
  }
  return geo;
}

export class Kit {
  constructor() { this.groups = new Map(); this.detailed = detailed; }
  get parts() { return [...this.groups.values()].flat(); }

  add(geo, color, x = 0, y = 0, z = 0, o = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    tmpE.set(o.rx || 0, o.ry || 0, o.rz || 0);
    tmpQ.setFromEuler(tmpE);
    tmpS.set(o.sx || 1, o.sy || 1, o.sz || 1);
    tmpP.set(x, y, z);
    tmpM.compose(tmpP, tmpQ, tmpS);
    g.applyMatrix4(tmpM);
    if (o.post) g.applyMatrix4(o.post);
    if (!g.attributes.normal) g.computeVertexNormals();
    const mat = o.mat || 'plain';
    if (!o.keepUV) boxUV(g, o.tile || (SLOTS[mat] && SLOTS[mat].tile) || 2);
    else if (!g.attributes.uv) boxUV(g, 2);
    // Textured parts take a light tint; plain parts carry their full colour.
    const neutralDefault = SLOTS[mat] && SLOTS[mat].neutral ? SLOTS[mat].color : '#ffffff';
    col.set(o.mat && o.mat !== 'plain' && o.mat !== 'glow' && o.mat !== 'glass' ? (o.tint || neutralDefault) : color);
    if (o.jitter) col.offsetHSL(0, 0, (Math.random() - 0.5) * o.jitter);
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    // A vertical gradient fakes grime and ambient occlusion towards the base of every part.
    const pos = g.attributes.position.array;
    const shade = o.shade ?? 0.18;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 1; i < pos.length; i += 3) { minY = Math.min(minY, pos[i]); maxY = Math.max(maxY, pos[i]); }
    const span = Math.max(1e-3, maxY - minY);
    for (let i = 0; i < n; i++) {
      const k = 1 - shade + shade * ((pos[i * 3 + 1] - minY) / span);
      c[i * 3] = col.r * k; c[i * 3 + 1] = col.g * k; c[i * 3 + 2] = col.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'uv'].includes(k)) g.deleteAttribute(k);
    if(this.motionWheels) {
      const pivot=this.activeWheel||[0,0,0,0],values=new Float32Array(n*4);
      for(let i=0;i<n;i++)values.set(pivot,i*4);
      g.setAttribute('wheelPivot',new THREE.BufferAttribute(values,4));
    }
    if (!this.groups.has(mat)) this.groups.set(mat, []);
    this.groups.get(mat).push(g);
    return this;
  }

  box(w, h, d, x, y, z, color, o = {}) {
    const bevel=detailed && Math.min(w,h,d)>.16 && !['glass','glow','canvas'].includes(o.mat);
    return this.add(bevel ? edgedBox(w,h,d,Math.min(.035,Math.min(w,h,d)*.09)) : new THREE.BoxGeometry(w,h,d),color,x,y,z,o);
  }
  cyl(rt, rb, h, x, y, z, color, o = {}) { return this.add(new THREE.CylinderGeometry(rt, rb, h, o.segs || 10, 1, !!o.open), color, x, y, z, o); }
  cone(r, h, x, y, z, color, o = {}) { return this.add(new THREE.ConeGeometry(r, h, o.segs || 8), color, x, y, z, o); }
  sphere(r, x, y, z, color, o = {}) { return this.add(new THREE.IcosahedronGeometry(r, o.detail ?? 2), color, x, y, z, o); }
  dodeca(r, x, y, z, color, o = {}) { return this.add(new THREE.DodecahedronGeometry(r, o.detail ?? 0), color, x, y, z, o); }
  capsule(r, len, x, y, z, color, o = {}) { return this.add(new THREE.CapsuleGeometry(r, len, o.cap || 3, o.segs || 8), color, x, y, z, o); }
  torus(r, t, x, y, z, color, o = {}) { return this.add(new THREE.TorusGeometry(r, t, 6, o.segs || 12, o.arc || Math.PI * 2), color, x, y, z, o); }
  lathe(points, x, y, z, color, o = {}) { return this.add(new THREE.LatheGeometry(points.map(([a, b]) => new THREE.Vector2(a, b)), o.segs || 14), color, x, y, z, o); }

  // Gable roof as two real slopes with UVs running along the slope (tile rows stay level),
  // plus the triangular gable ends in the wall material. Ridge runs along x.
  roof(len, span, rise, x, y, z, o = {}) {
    const over = o.over ?? 0.3, hl = len / 2 + over, hs = span / 2 + over;
    const riseO = rise * (hs / (span / 2));
    const slope = Math.hypot(hs, riseO);
    const tile = o.tile || 1.6;
    const t = o.thick ?? 0.12;
    const quad = (side) => {
      const g = new THREE.BufferGeometry();
      // Corners: eave (z = side*hs, y = -riseO + rise) to ridge (z = 0, y = rise).
      const yE = rise - riseO;
      const p = [-hl, yE, side * hs, hl, yE, side * hs, hl, rise, 0, -hl, rise, 0];
      const idx = side > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
      const uv = [0, 0, len / tile, 0, len / tile, slope / tile, 0, slope / tile];
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const mat = o.mat || 'roof_tiles';
    for (const side of [1, -1]) {
      const g = quad(side);
      const m = new THREE.Matrix4().makeRotationY(o.ry || 0).setPosition(x, y, z);
      g.applyMatrix4(m);
      this.add(g, '#fff', 0, 0, 0, { mat, keepUV: true, tint: o.tint, shade: 0.05 });
      // Underside so the roof has thickness when seen from below the eaves.
      const u = quad(-side); u.translate(0, -t, 0); u.applyMatrix4(m);
      this.add(u, '#3a2e24', 0, 0, 0, { mat: 'wood', keepUV: true, tint: '#8a7a68', shade: 0 });
    }
    // Ridge cap.
    this.add(new THREE.CylinderGeometry(0.11, 0.11, len + over * 2, 8, 1), '#fff', 0, 0, 0, { mat, tint: o.tint ? shadeHex(o.tint, -0.08) : '#d8c8b8', rz: Math.PI / 2, post: new THREE.Matrix4().makeRotationY(o.ry || 0).setPosition(x, y + rise + 0.02, z) });
    // Gable-end triangles in the wall material.
    if (o.wallMat) {
      const s = new THREE.Shape(); s.moveTo(-span / 2, 0); s.lineTo(span / 2, 0); s.lineTo(0, rise); s.lineTo(-span / 2, 0);
      for (const end of [1, -1]) {
        const g = new THREE.ShapeGeometry(s);
        if (end < 0) g.rotateY(Math.PI);
        g.rotateY(Math.PI / 2);
        g.translate(end * len / 2, 0, 0);
        g.applyMatrix4(new THREE.Matrix4().makeRotationY(o.ry || 0).setPosition(x, y, z));
        this.add(g, '#fff', 0, 0, 0, { mat: o.wallMat, tint: o.wallTint, shade: 0.04 });
      }
    }
    return this;
  }
  // Hipped/pyramid roof.
  pyramid(w, h, d, x, y, z, color, o = {}) {
    const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1);
    g.rotateY(Math.PI / 4);
    g.scale(w, h, d);
    g.translate(0, h / 2, 0);
    return this.add(g, color, x, y, z, o);
  }
  gable(w, h, d, x, y, z, color, o = {}) {
    const s = new THREE.Shape();
    s.moveTo(-d / 2, 0); s.lineTo(d / 2, 0); s.lineTo(0, h); s.lineTo(-d / 2, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
    g.translate(0, 0, -w / 2);
    g.rotateY(Math.PI / 2);
    return this.add(g, color, x, y, z, o);
  }
  extrude(points, h, y, color, o = {}) {
    const s = new THREE.Shape(points.map(([px, pz]) => new THREE.Vector2(px, -pz)));
    const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    return this.add(g, color, 0, y, 0, o);
  }
  // A lumpy boulder: displaced icosphere.
  boulder(r, x, y, z, o = {}) {
    const g = new THREE.IcosahedronGeometry(r, 2);
    const p = g.attributes.position;
    const seed = (o.seed || 1) * 12.9898;
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
      const n = Math.sin(vx * 3.1 + seed) * Math.cos(vz * 2.7 - seed) * 0.5 + Math.sin(vy * 4.3 + seed * 2) * 0.25;
      const k = 1 + n * 0.28;
      p.setXYZ(i, vx * k, vy * k * (o.flat ?? 0.7), vz * k);
    }
    g.computeVertexNormals();
    return this.add(g, '#fff', x, y, z, { mat: o.mat || 'moss_rock', tint: o.tint, shade: 0.35, ry: o.ry });
  }

  // Merge into one geometry with a group per material slot.
  build() {
    const keys = [...this.groups.keys()];
    const geos = keys.map((k) => mergeGeometries(this.groups.get(k), false));
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, true);
    if (geos.length === 1) { merged.clearGroups(); merged.addGroup(0, Infinity, 0); }
    this.groups.forEach((list) => list.forEach((p) => p.dispose()));
    this.groups = new Map();
    merged.computeBoundingSphere();
    return { geometry: merged, slots: keys };
  }
  geometry() { return this.build().geometry; }
  mesh(lib, materialFor) {
    const { geometry, slots } = this.build();
    const mats = slots.map((s) => (materialFor && materialFor(s)) || slotMaterial(lib, s));
    const m = new THREE.Mesh(geometry, mats.length === 1 ? mats[0] : mats);
    if (mats.length === 1) geometry.clearGroups();
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
}

export function slotMaterial(lib, s) {
  if (s === 'plain' || !lib) return MAT.smooth;
  if (s === 'glow') return MAT.glow;
  if (s === 'glass') return MAT.glass;
  if (s === 'flat') return MAT.solid;
  return lib.material(s);
}

export const MAT = {
  solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.02, flatShading: true }),
  smooth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05 }),
  metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 }),
  foliage: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true }),
  glass: new THREE.MeshStandardMaterial({ color: 0x141b22, roughness: 0.08, metalness: 0.6, envMapIntensity: 1.4 }),
  glow: new THREE.MeshBasicMaterial({ color: 0xffd28a }),
};

// Deterministic per-object pseudo random from an id string.
export function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
}

export function shade(hex, k) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, k);
  return '#' + c.getHexString();
}
const shadeHex = shade;
