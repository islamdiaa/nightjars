import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { F, T } from '../core/constants.js';
import { seeded, shade } from './kit.js';
import { buildGroundCover } from './groundcover.js';

// Trees, bushes and grass. Trunks are textured bark; foliage is alpha-cutout cards textured
// with leaf / needle / frond atlases, with normals pointing out from the crown so canopies
// shade as soft volumes. Everything is instanced and sways in the wind.

export const windUniforms = { uTime: { value: 0 }, uWind: { value: 1 } };
// See-through holes: screen positions (px), depth and radius of soldiers the canopy would hide.
export const MAX_HOLES = 32;
export const holeUniforms = { uHoles: { value: Array.from({ length: MAX_HOLES }, () => new THREE.Vector4()) }, uHoleCount: { value: 0 } };

function card(w, h, { uv = [0, 0, 1, 1] } = {}) {
  const g = new THREE.PlaneGeometry(w, h);
  const a = g.attributes.uv;
  for (let i = 0; i < a.count; i++) a.setXY(i, uv[0] + a.getX(i) * (uv[2] - uv[0]), uv[1] + a.getY(i) * (uv[3] - uv[1]));
  return g;
}

// Re-point normals away from a centre (crown) so lighting wraps around the whole canopy.
function crownNormals(g, cx, cy, cz, upBias = 0.35) {
  const p = g.attributes.position, n = g.attributes.normal;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i) - cx, p.getY(i) - cy, p.getZ(i) - cz).normalize();
    v.y += upBias; v.normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}
function tint(g, hex, topLighten = 0.12) {
  const c = new THREE.Color(hex);
  const p = g.attributes.position;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < p.count; i++) { minY = Math.min(minY, p.getY(i)); maxY = Math.max(maxY, p.getY(i)); }
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = 0.78 + topLighten * 2 * ((p.getY(i) - minY) / Math.max(0.01, maxY - minY));
    col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
const clean = (g) => { const x = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) x.deleteAttribute(k); return x; };
const place = (g, x, y, z, rx = 0, ry = 0, rz = 0, s = 1) => { g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(s, s, s))); return g; };

function trunk(h, r0, r1, x = 0, z = 0, lean = 0, segs = 8) {
  const g = new THREE.CylinderGeometry(r1, r0, h, segs, 3, true);
  g.translate(0, h / 2, 0);
  if (lean) g.applyMatrix4(new THREE.Matrix4().makeRotationZ(lean));
  g.translate(x, 0, z);
  // Bark UVs: wrap around once, ~1 m per repeat vertically.
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.5, uv.getY(i) * h / 1.2);
  return tint(clean(g), '#ffffff', 0.05);
}

// ---------- tree templates: { bark: geometry, leaves: geometry, atlas, barkSlot } ----------
const TEMPLATES = new Map();
function template(kind, snowy, detailed = false, variant = 0) {
  const key = kind + (snowy ? ':snow' : '') + (detailed ? ':photo'+variant : '');
  if (TEMPLATES.has(key)) return TEMPLATES.get(key);
  const r = seeded(key);
  const leaves = [], barks = [];
  let atlas = 'leaves_broad', barkSlot = 'bark_oak';
  const leafTint = (base) => (snowy ? '#e8eef0' : base);
  switch (kind) {
    case 'pine': case 'spruce': {
      atlas = 'leaves_pine'; barkSlot = 'bark_pine';
      barks.push(trunk(5.6, 0.16, 0.04));
      const tiers = 8;
      for (let i = 0; i < tiers; i++) {
        const y = 1.1 + i * 0.6, R = 1.55 * (1 - i / (tiers + 1.2)) + 0.2;
        const n = 7 - Math.floor(i / 3);
        for (let j = 0; j < n; j++) {
          const a = (j / n) * Math.PI * 2 + i * 0.7 + r() * 0.4;
          const g = card(R * 1.25, 0.9);
          g.translate(R * 0.55, 0, 0);
          place(g, 0, y, 0, -Math.PI / 2 + 0.35 + r() * 0.2, a, 0);
          const v = card(R * 1.1, 0.8); v.translate(R * 0.5, -0.1, 0); place(v, 0, y, 0, 0, a, -0.25);
          for (const q of [g, v]) leaves.push(tint(crownNormals(clean(q), 0, y + 0.4, 0, 0.5), leafTint(i % 2 ? '#c8d8c0' : '#b8c8b0')));
        }
      }
      for (let j = 0; j < 3; j++) { const g = card(0.8, 1.2); place(g, 0, 6.0, 0, 0, j * Math.PI / 3, 0); leaves.push(tint(crownNormals(clean(g), 0, 5.6, 0), leafTint('#c8d8c0'))); }
      break;
    }
    case 'birch': case 'poplar': case 'cypress': case 'olive': case 'oak': case 'jungle': case 'bamboo': default: {
      const shape = {
        oak: { trunkH: 2.6, tr: 0.22, c: [0, 3.4, 0], rad: [1.9, 1.5, 1.9], n: 70, size: 1.15, tint: '#a8b490', bark: 'bark_oak' },
        birch: { trunkH: 3.6, tr: 0.11, c: [0, 4.0, 0], rad: [1.2, 1.6, 1.2], n: 52, size: 0.95, tint: '#b8c4a0', bark: 'bark_birch' },
        poplar: { trunkH: 2.0, tr: 0.13, c: [0, 4.0, 0], rad: [0.85, 2.8, 0.85], n: 56, size: 0.9, tint: '#aab894', bark: 'bark_oak' },
        cypress: { trunkH: 1.0, tr: 0.12, c: [0, 3.0, 0], rad: [0.65, 2.6, 0.65], n: 30, size: 1.0, tint: '#7a9070', bark: 'bark_oak' },
        olive: { trunkH: 1.3, tr: 0.15, c: [0, 2.0, 0], rad: [1.5, 0.95, 1.5], n: 30, size: 1.3, tint: '#b8c0a0', bark: 'bark_oak' },
        jungle: { trunkH: 3.4, tr: 0.28, c: [0, 4.3, 0], rad: [2.4, 1.4, 2.4], n: 84, size: 1.4, tint: '#98b088', bark: 'bark_oak' },
        bamboo: { trunkH: 3.6, tr: 0.05, c: [0, 3.6, 0], rad: [0.9, 1.4, 0.9], n: 24, size: 1.0, tint: '#d0e0a0', bark: 'bark_birch' },
      }[kind] || { trunkH: 2.6, tr: 0.2, c: [0, 3.4, 0], rad: [1.8, 1.4, 1.8], n: 40, size: 1.6, tint: '#c0d0a0', bark: 'bark_oak' };
      barkSlot = shape.bark;
      if (detailed && !['bamboo','cypress'].includes(kind)) {
        // Individual photographed leaves around real branching limbs, not a
        // textured sphere with metre-wide leaf silhouettes. Three irregular crowns.
        atlas='leaves_detail';
        barks.push(trunk(shape.trunkH+shape.rad[1]*.6,shape.tr,shape.tr*.32));
        const [cx,cy,cz]=shape.c,[rx,ry,rz]=shape.rad;
        for(let branch=0;branch<9;branch++) {
          const a=branch*2.399+variant*.8, spread=branch===8?.12:.48+r()*.35;
          const centre=new THREE.Vector3(cx+Math.cos(a)*rx*spread,cy+(r()-.35)*ry,cz+Math.sin(a)*rz*spread);
          const start=new THREE.Vector3(0,shape.trunkH*(.65+r()*.25),0), direction=centre.clone().sub(start);
          const limb=new THREE.CylinderGeometry(.018,shape.tr*.45,direction.length(),7,1);
          limb.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),direction.clone().normalize()));
          limb.translate(...start.add(centre).multiplyScalar(.5).toArray());
          barks.push(tint(clean(limb),'#ffffff',.08));
          if(snowy && ['oak','birch','poplar'].includes(kind)) {
            // Deciduous winter silhouettes, not green crowns painted white.
            for(let twig=0;twig<6;twig++) {
              const end=centre.clone().add(new THREE.Vector3((r()-.5)*rx,.2+r()*.7,(r()-.5)*rz));
              const direction=end.clone().sub(centre),geo=new THREE.CylinderGeometry(.006,.022,direction.length(),5,1);
              geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),direction.clone().normalize()));
              geo.translate(...end.add(centre).multiplyScalar(.5).toArray());barks.push(tint(clean(geo),'#ffffff',.06));
            }
            continue;
          }
          for(let j=0;j<120;j++) {
            const angle=r()*6.283, v=r()*2-1, radial=Math.sqrt(1-v*v), spreadLeaf=Math.cbrt(r());
            const px=centre.x+Math.cos(angle)*radial*rx*.48*spreadLeaf;
            const py=centre.y+v*ry*.5*spreadLeaf;
            const pz=centre.z+Math.sin(angle)*radial*rz*.48*spreadLeaf;
            const cell=Math.floor(r()*9), u=(cell%3)/3, vv=Math.floor(cell/3)/3;
            const size=.16+r()*.1;
            const g=card(size*.86,size,{uv:[u+.006,vv+.006,u+1/3-.006,vv+1/3-.006]});
            place(g,px,py,pz,-.5-r()*1.8,r()*6.283,r()*3);
            leaves.push(tint(crownNormals(clean(g),centre.x,centre.y-.5,centre.z,.6),leafTint('#c6c6b4'),.08));
          }
        }
        break;
      }
      if (kind === 'bamboo') for (let i = 0; i < 7; i++) barks.push(trunk(3.4 + r(), 0.05, 0.04, Math.cos(i * 1.1) * 0.3, Math.sin(i * 1.1) * 0.3, (r() - 0.5) * 0.12, 6));
      else {
        barks.push(trunk(shape.trunkH + shape.rad[1] * 0.6, shape.tr, shape.tr * 0.35));
        for (let i = 0; i < 4; i++) { const a = i * 1.6 + r(); const b = trunk(shape.rad[0] * 0.9, shape.tr * 0.45, shape.tr * 0.15, 0, 0, 0.9 + r() * 0.3, 6); place(b, 0, shape.trunkH * 0.8, 0, 0, a, 0); barks.push(b); }
      }
      // Leaf cards on a jittered Fibonacci ellipsoid, facing outwards.
      const [cx, cy, cz] = shape.c, [rx, ry, rz] = shape.rad;
      // A leafy core so the crown never looks hollow or papery.
      {
        const core = new THREE.IcosahedronGeometry(1, 2);
        core.scale(rx * 0.62, ry * 0.62, rz * 0.62);
        core.translate(cx, cy, cz);
        const uv = core.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 2);
        leaves.push(tint(crownNormals(clean(core), cx, cy - ry * 0.3, cz, 0.3), leafTint(shade(shape.tint, -0.12))));
      }
      for (let i = 0; i < shape.n; i++) {
        const t = (i + 0.5) / shape.n, phi = Math.acos(1 - 2 * t), th = Math.PI * (1 + Math.sqrt(5)) * i;
        const k = 0.55 + r() * 0.4;
        const px = cx + Math.sin(phi) * Math.cos(th) * rx * k, py = cy + Math.cos(phi) * ry * k, pz = cz + Math.sin(phi) * Math.sin(th) * rz * k;
        const g = card(shape.size * (0.8 + r() * 0.4), shape.size * (0.8 + r() * 0.4));
        const m = new THREE.Matrix4().lookAt(new THREE.Vector3(px, py, pz), new THREE.Vector3(cx, cy, cz), new THREE.Vector3(0, 1, 0));
        g.applyMatrix4(new THREE.Matrix4().makeRotationZ(r() * Math.PI * 2));
        g.applyMatrix4(m);
        g.translate(px, py, pz);
        leaves.push(tint(crownNormals(clean(g), cx, cy - ry * 0.3, cz, 0.3), leafTint(shape.tint)));
      }
      break;
    }
    case 'palm': {
      atlas = 'leaves_palm'; barkSlot = 'bark_pine';
      let x = 0, y = 0;
      for (let i = 0; i < 7; i++) { const seg = trunk(0.62, 0.13 - i * 0.008, 0.12 - i * 0.008, 0, 0, -0.07 * i, 7); seg.translate(x, y, 0); barks.push(seg); x += Math.sin(0.07 * i) * 0.62; y += Math.cos(0.07 * i) * 0.6; }
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + r() * 0.3;
        const inner = card(1.6, 0.8); inner.translate(0.8, 0, 0); place(inner, x, y, 0, 0, a, 0.35 + r() * 0.2);
        const outer = card(1.6, 0.8); outer.translate(0.8, 0, 0); place(outer, 0, 0, 0, 0, 0, -0.55); place(outer, x + Math.cos(-a) * 1.45, y + 0.55, Math.sin(-a) * 1.45, 0, a, 0);
        for (const q of [inner, outer]) leaves.push(tint(crownNormals(clean(q), x, y - 0.5, 0, 0.6), leafTint('#c8d8b0')));
      }
      break;
    }
    case 'dead': {
      barkSlot = 'bark_oak';
      barks.push(trunk(3.2, 0.16, 0.04));
      for (let i = 0; i < 5; i++) { const b = trunk(1.2 + r(), 0.06, 0.015, 0, 0, 0.9 + r() * 0.5, 5); place(b, 0, 1.4 + i * 0.35, 0, 0, i * 1.9, 0); barks.push(b); }
      break;
    }
    case 'bush': case 'scrub': case 'hedge': case 'fern': case 'reeds': case 'crop': {
      atlas = kind === 'fern' ? 'fern' : kind === 'crop' ? 'wheat' : kind === 'reeds' ? 'grass_blades' : 'leaves_broad';
      const n = kind === 'hedge' ? 16 : kind === 'crop' ? 6 : kind === 'fern' || kind === 'reeds' ? 4 : 11;
      for (let i = 0; i < n; i++) {
        let g;
        if (kind === 'crop') { g = card(1.1, 1.75); place(g, (r() - 0.5) * 0.3, 0.86, (r() - 0.5) * 0.3, (r() - 0.5) * 0.12, (i / n) * Math.PI + r() * 0.3, 0); }
        else if (kind === 'fern' || kind === 'reeds') { g = card(1.2, kind === 'reeds' ? 1.3 : 0.9); place(g, 0, kind === 'reeds' ? 0.62 : 0.4, 0, kind === 'fern' ? -0.5 : 0, (i / n) * Math.PI, 0); }
        else if (kind === 'hedge') { g = card(0.9, 0.9); const px = -0.45 + (i % 8) / 7 * 0.9, py = 0.35 + Math.floor(i / 8) * 0.45; place(g, px, py, (r() - 0.5) * 0.4, (r() - 0.5) * 0.8, r() * 3, r() * 3); }
        else { const a = r() * Math.PI * 2, rr = 0.25 + r() * 0.25; g = card(0.75, 0.75); place(g, Math.cos(a) * rr, 0.38 + r() * 0.35, Math.sin(a) * rr, (r() - 0.5) * 1.2, a, r() * 3); }
        const tintC = kind === 'scrub' ? '#d8c890' : kind === 'reeds' ? '#e0d8a0' : kind === 'crop' ? '#ffffff' : kind === 'hedge' ? '#98a888' : '#a4ae8c';
        leaves.push(tint(crownNormals(clean(g), 0, 0.1, 0, 0.4), leafTint(tintC)));
      }
      barkSlot = null;
      break;
    }
  }
  const tpl = {
    bark: barks.length ? mergeGeometries(barks, false) : null,
    leaves: leaves.length ? mergeGeometries(leaves, false) : null,
    atlas, barkSlot,
  };
  TEMPLATES.set(key, tpl);
  return tpl;
}

// Foliage material: alpha-tested cards, double-sided without flipping the crown normals,
// a touch of translucency, and vertex-shader wind sway.
const FOL_MATS = new Map();
export function foliageMaterial(lib, atlas, sway = 1, holes = true) {
  const key = atlas + sway + holes + lib.detailed;
  if (FOL_MATS.has(key)) return FOL_MATS.get(key);
  const m = new THREE.MeshStandardMaterial({ map: lib.foliage(atlas), alphaTest: 0.42, side: THREE.DoubleSide, vertexColors: true, roughness: 0.88, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = windUniforms.uTime;
    sh.uniforms.uWind = windUniforms.uWind;
    sh.uniforms.uHoles = holeUniforms.uHoles;
    sh.uniforms.uHoleCount = holeUniforms.uHoleCount;
    sh.vertexShader = 'uniform float uTime;\nuniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        vec3 ip = vec3(0.0);
        #ifdef USE_INSTANCING
          ip = instanceMatrix[3].xyz;
        #endif
        float h = max(0.0, position.y);
        float sway = (sin(uTime * 1.7 + ip.x * 0.37 + ip.z * 0.21) * 0.6 + sin(uTime * 3.1 + ip.x * 1.3 + position.x * 2.0) * 0.25) * uWind * ${(0.022 * sway).toFixed(4)};
        transformed.x += sway * h;
        transformed.z += sway * h * 0.6;
      }`);
    sh.fragmentShader = `uniform vec4 uHoles[${MAX_HOLES}];\nuniform int uHoleCount;\n` + sh.fragmentShader
      .replace('#include <clipping_planes_fragment>', !holes ? '#include <clipping_planes_fragment>' : `#include <clipping_planes_fragment>
      for (int i = 0; i < ${MAX_HOLES}; i++) {
        if (i >= uHoleCount) break;
        vec4 hl = uHoles[i];
        float dist = length(gl_FragCoord.xy - hl.xy) / hl.w;
        if (dist < 1.0 && gl_FragCoord.z < hl.z) {
          float n = fract(sin(dot(floor(gl_FragCoord.xy * 0.5), vec2(12.9898, 78.233))) * 43758.5453);
          if (dist < 0.7 || n > (dist - 0.7) / 0.3) discard;
        }
      }`)
      .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0'))
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.06;');
  };
  m.customProgramCacheKey = () => 'fol' + sway + holes;
  FOL_MATS.set(key, m);
  return m;
}

// Build instanced trees and bushes for every vegetation thing (plus decorative extras).
export function buildVegetation(things, heightAt, { snowy = false, lib }) {
  const groups = new Map();
  for (const t of things) {
    if (t.type !== 'tree' && t.type !== 'bush') continue;
    let kind = t.type === 'bush' ? (t.kind || 'bush') : (t.kind || 'pine');
    const variant=lib.detailed && t.type==='tree' ? Math.floor(seeded(t.id+':crown')()*3) : 0;
    const key=kind+':'+variant;
    if (!groups.has(key)) groups.set(key, {kind,variant,list:[]});
    groups.get(key).list.push(t);
  }
  const out = new THREE.Group();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  for (const {kind,variant,list} of groups.values()) {
    const tpl = template(kind, snowy,lib.detailed,variant);
    const parts = [];
    if (tpl.bark) parts.push([tpl.bark, lib.material(tpl.barkSlot, { vertexColors: true })]);
    const isTree = !['bush', 'scrub', 'hedge', 'fern', 'reeds', 'crop'].includes(kind);
    if (tpl.leaves) parts.push([tpl.leaves, foliageMaterial(lib, tpl.atlas, kind === 'hedge' ? 0.3 : 1, isTree)]);
    for (const [geo, mat] of parts) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((t, i) => {
        const r = seeded(t.id);
        const sc = (t.scale || 1) * (0.85 + r() * 0.3);
        const jitter=lib.detailed && isTree ? 0 : .3;
        p.set(t.x + 0.5 + (r() - 0.5) * jitter, heightAt(t.x + 0.5, t.y + 0.5) - 0.05, t.y + 0.5 + (r() - 0.5) * jitter);
        q.setFromAxisAngle(up, t.rot ?? r() * 6.28);
        s.set(sc, sc * (0.9 + r() * 0.25), sc);
        m4.compose(p, q, s);
        im.setMatrixAt(i, m4);
        c.setHSL(0.02 * (r() - 0.5), 0, 0.82 + r() * 0.3);
        c.setRGB(c.r || 1, c.g || 1, c.b || 1);
        const v = 0.82 + r() * 0.3; c.setRGB(v * (0.95 + r() * 0.1), v, v * (0.9 + r() * 0.1));
        im.setColorAt(i, c);
      });
      im.castShadow = !['reeds', 'fern', 'crop'].includes(kind);
      im.receiveShadow = true;
      im.userData.kind = kind;
      out.add(im);
    }
  }
  return out;
}

// Grass: thousands of crossed alpha cards scattered over soft ground.
const GRASS_DENSITY = { [T.GRASS]: 2.4, [T.FIELD]: 1.6, [T.FOREST]: 0.55, [T.DIRT]: 0.25, [T.SAND]: 0.12, [T.MUD]: 0.2, [T.PADDY]: 1.2, [T.DUNE]: 0.05, [T.SNOW]: 0.05 };
const GRASS_TINT = { [T.GRASS]: '#b8c890', [T.FIELD]: '#e8d898', [T.FOREST]: '#a0a880', [T.DIRT]: '#c8c090', [T.SAND]: '#e0d0a0', [T.MUD]: '#a0a070', [T.PADDY]: '#b8d898', [T.DUNE]: '#e8d8a8', [T.SNOW]: '#e8ece8' };
export function buildGrass(grid, heightAt, lib, { density = 1, snowy = false } = {}) {
  if (lib.detailed) return buildGroundCover(grid, heightAt, foliageMaterial(lib, 'grass_blades', 1.8, false), {density, snowy});
  const geo = mergeGeometries([0, 1, 2].map((i) => { const g = card(0.85, 0.55); g.translate(0, 0.27, 0); g.rotateY(i * Math.PI / 3); return tint(crownNormals(clean(g), 0, -0.6, 0, 0.8), '#ffffff', 0.18); }), false);
  const spots = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) {
    const f = grid.flags[grid.idx(x, y)];
    if (f & (F.BLOCK | F.ROAD | F.WATER | F.DEEP | F.INDOOR | F.DOOR)) continue;
    const ter = grid.terrain[grid.idx(x, y)];
    let d = (GRASS_DENSITY[ter] || 0) * density;
    if (snowy && ter !== T.SNOW) d *= 0.3;
    while (d > 0) { if (rnd() < d) spots.push([x + rnd(), y + rnd(), ter]); d -= 1; }
  }
  if (!spots.length) return null;
  const im = new THREE.InstancedMesh(geo, foliageMaterial(lib, 'grass_blades', 2.2, false), spots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  spots.forEach(([x, y, ter], i) => {
    p.set(x, heightAt(x, y) - 0.02, y);
    q.setFromAxisAngle(up, rnd() * 6.28);
    const sc = 0.6 + rnd() * 0.7;
    s.set(sc, sc * (ter === T.FIELD ? 1.5 : 1) * (0.8 + rnd() * 0.5), sc);
    m4.compose(p, q, s);
    im.setMatrixAt(i, m4);
    c.set(GRASS_TINT[ter] || '#c0c890').offsetHSL((rnd() - 0.5) * 0.03, 0, (rnd() - 0.5) * 0.12);
    im.setColorAt(i, c);
  });
  im.castShadow = false; im.receiveShadow = true;
  im.frustumCulled = false;
  return im;
}
