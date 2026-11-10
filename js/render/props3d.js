import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { seeded } from './kit.js';

// Photoscanned CC0 props (Poly Haven glTF). Models are authored in metres; one game unit is
// about 1.25 m, so they are scaled by 0.8. Rock sets contain several boulders: each node is
// a separate variant.

const UNIT = 0.8;
let MODELS = null;
let MODEL_PRESET = '';

export async function loadModels(onProgress, preset = '') {
  if (MODELS && MODEL_PRESET === preset) return MODELS;
  MODEL_PRESET = preset;
  MODELS = new Map();
  let manifest = {};
  try { manifest = await (await fetch(preset === 'forest' ? 'assets/models/forest/props.json' : 'assets/models/manifest.json')).json(); } catch (e) { return MODELS; }
  const loader = new GLTFLoader();
  await Promise.all(Object.entries(manifest).map(async ([name, info]) => {
    try {
      const gltf = await loader.loadAsync(`assets/models/${info.entry}`);
      const variants = [];
      const meshes = [];
      gltf.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; meshes.push(o); } });
      // Rock sets: every top-level mesh is its own boulder.
      if (name.startsWith('rocks') && meshes.length > 1) for (const m of meshes) variants.push(normalize(m.clone()));
      else variants.push(normalize(gltf.scene));
      MODELS.set(name, variants);
    } catch (e) { console.warn('model failed', name, e); }
  }));
  if (onProgress) onProgress();
  return MODELS;
}

// Centre on x/z, sit on y = 0, scale to game units.
function normalize(obj) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  const holder = new THREE.Group();
  obj.position.sub(new THREE.Vector3(c.x, box.min.y, c.z));
  obj.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z);
  holder.add(obj);
  holder.scale.setScalar(UNIT);
  holder.userData.size = box.getSize(new THREE.Vector3()).multiplyScalar(UNIT);
  return holder;
}

function variant(name, key) {
  const v = MODELS && MODELS.get(name);
  if (!v || !v.length) return null;
  const r = seeded(String(key));
  return v[Math.floor(r() * v.length)].clone(true);
}

// Steel drums from the scan are painted blue; repaint them olive, keeping the scanned relief.
const OLIVE = new Map();
function repaint(obj, hex) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const key = o.material.uuid + hex;
    if (!OLIVE.has(key)) {
      const m = o.material.clone(), tint=new THREE.Color(hex); m.color.set(0xffffff);
      // Keep the actual photographed dents, seams and chipped paint in the albedo.
      m.onBeforeCompile=sh=>{sh.uniforms.njPaint={value:tint};sh.fragmentShader='uniform vec3 njPaint;\n'+sh.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\n diffuseColor.rgb=njPaint*clamp(.45+dot(diffuseColor.rgb,vec3(.2126,.7152,.0722))*2.5,.35,1.35);');};
      m.customProgramCacheKey=()=> 'repaint-scan-'+hex;
      OLIVE.set(key, m);
    }
    o.material = OLIVE.get(key);
  });
  return obj;
}

// Returns a prop built from scans, or null to fall back to the procedural model.
export function scannedProp(t) {
  if (!MODELS || !MODELS.size) return null;
  const id = t.id || `${t.x},${t.y}`;
  const r = seeded(id + 'p');
  const g = new THREE.Group();
  const add = (o, x = 0, y = 0, z = 0, ry = 0, s = 1) => { if (!o) return false; o.position.set(x, y, z); o.rotation.y = ry; o.scale.multiplyScalar(s); g.add(o); return true; };
  switch (t.kind) {
    case 'crate': if (!add(variant('crate_wooden', id), 0, 0, 0, r() * 0.3)) return null; add(variant('crate_wooden', id + 'b'), 0.02, 0.37, 0, r() * 0.4 - 0.2); break;
    case 'crates': if (!add(variant('crate_military', id), 0, 0, 0, 0)) return null; add(variant('crate_military', id + 'b'), 0.05, 0.24, 0.02, 0.08); add(variant('crate_wooden', id + 'c'), 0.2, 0.48, 0, -0.2); break;
    case 'ammo': if (!add(variant('crate_military', id), 0, 0, 0, 0)) return null; add(variant('crate_military', id + 'b'), 0, 0.24, 0, 0.05); add(variant('crate_military', id + 'c'), 0.04, 0.48, 0, -0.06); break;
    case 'barrel': {
      const b = variant('fuel_drum', id); if (!b) return null;
      add(repaint(b, '#6a7050'), 0, 0, 0, r() * 6); break;
    }
    case 'fuel': {
      const ok = [[-0.55, -0.32], [0, -0.32], [0.55, -0.32], [-0.27, 0.32], [0.27, 0.32]].map(([x, z], i) => add(repaint(variant('fuel_drum', id + i), i % 2 ? '#6a7050' : '#7a6a48'), x, 0, z, r() * 6));
      if (!ok[0]) return null;
      add(variant('jerrycan', id + 'j'), 0.75, 0, 0.5, 0.4); add(variant('jerrycan', id + 'k'), 0.9, 0, 0.3, 0.1);
      break;
    }
    case 'rocks': if (!add(variant('rocks_mossy_a', id), 0, 0, 0, r() * 6, 1.6)) return null; add(variant('rocks_mossy_b', id + 'b'), 0.7, 0, 0.5, r() * 6, 1.2); add(variant('rocks_mossy_a', id + 'c'), -0.6, 0, 0.6, r() * 6, 1.0); break;
    case 'rock': if (!add(variant(r() < 0.5 ? 'rocks_mossy_a' : 'rocks_mossy_b', id), 0, 0, 0, r() * 6, 1.3)) return null; break;
    case 'log': if (!add(variant('fallen_log', id), 0, 0, 0, Math.PI / 2 + (r() - 0.5) * 0.2, 0.95)) return null; break;
    case 'stump': if (!add(variant('tree_stump', id), 0, 0, 0, r() * 6, 0.8)) return null; break;
    default: return null;
  }
  return g;
}

// Small scanned debris scattered on the forest floor (no collision).
export function forestDebris(grid, things, heightAt, F, T) {
  const out = new THREE.Group();
  if (!MODELS || !MODELS.size) return out;
  const occupied = new Set(things.map((t) => t.x + ',' + t.y));
  const r = seeded('debris');
  for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) {
    const i = grid.idx(x, y);
    if (grid.terrain[i] !== T.FOREST) continue;
    if (grid.flags[i] & (F.BLOCK | F.ROAD | F.WATER | F.DEEP | F.DOOR)) continue;
    if (occupied.has(x + ',' + y)) continue;
    const p = r();
    let o = null;
    if (p < 0.012) o = variant('tree_stump', x * 31 + y);
    else if (p < 0.02) o = variant(r() < 0.5 ? 'rocks_mossy_a' : 'rocks_mossy_b', x * 17 + y);
    else if (p < 0.024) o = variant('fallen_log', x * 7 + y);
    if (!o) continue;
    o.position.set(x + 0.5, heightAt(x + 0.5, y + 0.5) - 0.03, y + 0.5);
    o.rotation.y = r() * 6.28;
    o.scale.multiplyScalar(o.userData.size && o.userData.size.x > 2 ? 0.6 : 0.55);
    out.add(o);
  }
  return out;
}
