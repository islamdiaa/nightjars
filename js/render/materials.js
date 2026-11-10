import * as THREE from 'three';
import { T } from '../core/constants.js';

// PBR material library. Texture slots are CC0 photoscans (Poly Haven / ambientCG) stored as
// assets/tex/<slot>_diff.jpg, _nor.jpg (OpenGL) and _arm.jpg (R = AO, G = roughness, B = metal,
// which is exactly three.js's aoMap/roughnessMap/metalnessMap channel convention).
// Missing files fall back to procedural textures so the game always runs.

export const SLOTS = {
  // ground                                     tile: metres covered by one texture repeat
  grass: { color: '#5f7a3a', rough: 0.95, tile: 3.2 }, forest: { color: '#4a4a2c', rough: 0.95, tile: 3 },
  leaves: { color: '#6a5232', rough: 0.9, tile: 3 }, dirt: { color: '#7a6143', rough: 0.95, tile: 3 },
  mud: { color: '#4b3d2d', rough: 0.6, tile: 3 }, sand: { color: '#c8b07e', rough: 0.95, tile: 3 },
  snow: { color: '#e4e9ef', rough: 0.7, tile: 4 }, rock: { color: '#7a766d', rough: 0.85, tile: 4 },
  gravel: { color: '#857d70', rough: 0.9, tile: 2.5 }, cobble: { color: '#6c6862', rough: 0.85, tile: 2.5 },
  asphalt: { color: '#4f4c48', rough: 0.9, tile: 4 }, planks: { color: '#6a5843', rough: 0.85, tile: 2.5 },
  concrete: { color: '#8a8984', rough: 0.9, tile: 4 }, field: { color: '#6e5c3e', rough: 0.95, tile: 3 },
  ash: { color: '#3a3630', rough: 0.95, tile: 3 },
  ice: { color: '#9cb2c2', rough: 0.12, tile: 7, procedural: true },
  slush: { color: '#9a958e', rough: 0.6, tile: 5, procedural: true },
  // buildings and materials
  plaster: { color: '#d8cdb4', rough: 0.9, tile: 2.5 }, plaster_old: { color: '#c9b99c', rough: 0.9, tile: 2.5 },
  brick: { color: '#8a4a38', rough: 0.9, tile: 2 }, stone_wall: { color: '#8a857a', rough: 0.9, tile: 2.5 },
  wood_wall: { color: '#6e5a42', rough: 0.85, tile: 2 }, logs: { color: '#6b5a44', rough: 0.85, tile: 2 },
  concrete_wall: { color: '#8c8a82', rough: 0.9, tile: 3 }, roof_tiles: { color: '#8a4a32', rough: 0.75, tile: 2 },
  roof_slate: { color: '#3d3f42', rough: 0.6, tile: 2 }, roof_thatch: { color: '#a08c58', rough: 0.95, tile: 2.5 },
  roof_metal: { color: '#6a5a48', rough: 0.6, tile: 2, metal: 0.4 }, wood: { color: '#6b5640', rough: 0.8, tile: 1.5 },
  metal: { color: '#5a5e50', rough: 0.55, tile: 2, metal: 0.5 }, canvas: { color: '#6b6650', rough: 0.95, tile: 1.5 },
  burlap: { color: '#8a7a58', rough: 0.95, tile: 1 }, fabric: { color: '#7a7a70', rough: 0.95, tile: 0.6 },
  bark_pine: { color: '#5a4434', rough: 0.95, tile: 1.2 }, bark_birch: { color: '#d8d4c8', rough: 0.85, tile: 1.2 },
  bark_oak: { color: '#4e4032', rough: 0.95, tile: 1.2 }, moss_rock: { color: '#6f7060', rough: 0.9, tile: 2 },
};

// Real-world texture sizes (metres) from the CC0 sources; converted to game units on load.
const TILE_METRES = { grass: 2.0, forest: 2.0, dirt: 2.0, mud: 2.25, sand: 2.0, snow: 2.5, rock: 2.0, gravel: 2.0, cobble: 2.0, asphalt: 2.08,
  planks: 2.0, concrete: 3.0, field: 2.0, leaves: 1.5, ash: 1.0, plaster: 2.0, plaster_old: 1.8, brick: 1.4, stone_wall: 2.0, wood_wall: 1.0,
  logs: 1.25, concrete_wall: 1.8, roof_tiles: 2.6, roof_slate: 2.0, roof_thatch: 2.5, roof_metal: 2.0, wood: 0.5, metal: 1.0, canvas: 0.6,
  burlap: 0.4, fabric: 0.35, bark_pine: 2.0, bark_birch: 1.0, bark_oak: 2.15, moss_rock: 3.0 };
const UNITS_PER_METRE = 0.8;
const GROUND = new Set(['grass', 'forest', 'leaves', 'dirt', 'mud', 'sand', 'snow', 'rock', 'gravel', 'cobble', 'asphalt', 'planks', 'concrete', 'field', 'ash']);
for (const [k, m] of Object.entries(TILE_METRES)) if (SLOTS[k]) SLOTS[k].tile = m * UNITS_PER_METRE * (GROUND.has(k) ? 1.25 : 1);

SLOTS.grass.ao = 0.45; SLOTS.forest.ao = 0.45; SLOTS.leaves.ao = 0.55;
// Cloth scans give weave and relief, while the colour comes from the uniform or canvas tint.
for (const k of ['fabric', 'burlap']) SLOTS[k].albedo = false;
// Tintable scans: rescaled to a light neutral average so the tint sets the real paint colour
// and the scan keeps only its wear, grain and weathering.
for (const k of ['metal', 'canvas', 'wood', 'wood_wall', 'logs', 'roof_metal']) SLOTS[k].neutral = true;

function neutralize(img) {
  const S = Math.min(1024, img.width);
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, S, S);
  const d = g.getImageData(0, 0, S, S);
  const px = d.data;
  let r = 0, gg = 0, b = 0;
  const n = px.length / 4;
  for (let i = 0; i < px.length; i += 4) { r += px[i]; gg += px[i + 1]; b += px[i + 2]; }
  r /= n; gg /= n; b /= n;
  const lum = (r + gg + b) / 3;
  const target = 228;
  for (let i = 0; i < px.length; i += 4) {
    // Keep luminance variation, drop the source hue.
    const l = (px[i] + px[i + 1] + px[i + 2]) / 3;
    const v = Math.min(255, (l / lum) * target);
    const sat = 0.25;
    px[i] = Math.min(255, v * (1 - sat) + (px[i] / r) * target * sat);
    px[i + 1] = Math.min(255, v * (1 - sat) + (px[i + 1] / gg) * target * sat);
    px[i + 2] = Math.min(255, v * (1 - sat) + (px[i + 2] / b) * target * sat);
  }
  g.putImageData(d, 0, 0);
  return c;
}

// Lake and river ice: grey-blue, glossy, clouded with trapped air, crossed by cracks (white
// fractures with a dark core). Painted once per size; diff, normal and ARM share the crack map.
const ICE_CACHE = new Map();
function iceCanvas(kind, size) {
  const key = kind + size;
  if (ICE_CACHE.has(key)) return ICE_CACHE.get(key);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const cracks = [];
  for (let i = 0; i < 14; i++) {
    let x = rnd() * size, y = rnd() * size, a = rnd() * Math.PI * 2;
    const pts = [[x, y]], n = 6 + Math.floor(rnd() * 10);
    for (let k = 0; k < n; k++) { a += (rnd() - 0.5) * 1.1; const L = size * (0.02 + rnd() * 0.05); x += Math.cos(a) * L; y += Math.sin(a) * L; pts.push([x, y]); }
    cracks.push({ pts, w: 0.6 + rnd() * 1.6 });
  }
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const stroke = (style, wMul) => {
    g.strokeStyle = style; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const cr of cracks) for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      g.lineWidth = cr.w * wMul * size / 512; g.beginPath();
      cr.pts.forEach(([px, py], i) => (i ? g.lineTo(px + ox, py + oy) : g.moveTo(px + ox, py + oy)));
      g.stroke();
    }
  };
  if (kind === 'diff') {
    g.fillStyle = '#93aabb'; g.fillRect(0, 0, size, size);
    for (let i = 0; i < 70; i++) {
      const x = rnd() * size, y = rnd() * size, r = size * (0.04 + rnd() * 0.16), light = rnd() < 0.5;
      for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
        const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        grd.addColorStop(0, light ? 'rgba(214,228,236,0.35)' : 'rgba(60,84,104,0.28)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd; g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
    stroke('rgba(236,244,250,0.75)', 3.2);
    stroke('rgba(38,56,72,0.8)', 1);
  } else if (kind === 'nor') {
    g.fillStyle = 'rgb(128,128,255)'; g.fillRect(0, 0, size, size);
    stroke('rgb(118,138,232)', 2.4);
  } else {
    g.fillStyle = 'rgb(255,34,0)'; g.fillRect(0, 0, size, size);       // glassy
    stroke('rgb(220,150,0)', 3.2);                                       // rough, frosted cracks
  }
  ICE_CACHE.set(key, c);
  return c;
}

// Trodden snow: grey-brown slush with packed white between, crossed by boot and wheel tracks.
const SLUSH_CACHE = new Map();
function slushCanvas(kind, size) {
  const key = kind + size;
  if (SLUSH_CACHE.has(key)) return SLUSH_CACHE.get(key);
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const blobs = Array.from({ length: 90 }, () => ({ x: rnd() * size, y: rnd() * size, r: size * (0.03 + rnd() * 0.1), light: rnd() < 0.55 }));
  const tracks = Array.from({ length: 16 }, () => ({ x: rnd() * size, w: 2 + rnd() * 6, wob: rnd() * 6 }));
  const paint = (fill, light, dark, trackCol) => {
    g.fillStyle = fill; g.fillRect(0, 0, size, size);
    for (const b of blobs) for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      const grd = g.createRadialGradient(b.x + ox, b.y + oy, 0, b.x + ox, b.y + oy, b.r);
      grd.addColorStop(0, b.light ? light : dark); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(b.x + ox - b.r, b.y + oy - b.r, b.r * 2, b.r * 2);
    }
    g.strokeStyle = trackCol;
    for (const t of tracks) { g.lineWidth = t.w * size / 512; g.beginPath(); for (let y = -8; y <= size + 8; y += 16) { const x = t.x + Math.sin(y * 0.02 + t.wob) * 6; y < 0 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke(); }
  };
  if (kind === 'diff') paint('#8f8a83', 'rgba(222,226,230,0.75)', 'rgba(92,82,70,0.45)', 'rgba(70,64,58,0.35)');
  else if (kind === 'nor') paint('rgb(128,128,255)', 'rgba(140,140,255,0.4)', 'rgba(116,120,250,0.4)', 'rgba(110,128,240,0.6)');
  else paint('rgb(255,150,0)', 'rgba(255,190,0,0.6)', 'rgba(255,70,0,0.5)', 'rgba(255,90,0,0.6)');   // wet slush is glossier
  SLUSH_CACHE.set(key, c);
  return c;
}

export const TERRAIN_SLOT = {
  [T.GRASS]: 'grass', [T.DIRT]: 'dirt', [T.ROAD]: 'asphalt', [T.COBBLE]: 'cobble', [T.SAND]: 'sand', [T.SNOW]: 'snow',
  [T.MUD]: 'mud', [T.ROCK]: 'rock', [T.FIELD]: 'field', [T.FLOOR]: 'planks', [T.WATER]: 'mud', [T.DEEP]: 'mud',
  [T.DOCK]: 'planks', [T.CONCRETE]: 'concrete', [T.GRAVEL]: 'gravel', [T.ICE]: 'ice', [T.FOREST]: 'forest',
  [T.PADDY]: 'mud', [T.ASH]: 'ash', [T.DUNE]: 'sand',
};

const imageCache = new Map();
function loadImage(url) {
  if (imageCache.has(url)) return imageCache.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
  imageCache.set(url, p);
  return p;
}

function noiseCanvas(hex, size = 256, amp = 0.18) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const col = new THREE.Color(hex);
  const img = g.createImageData(size, size);
  let s = 1;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  // Two octaves of blocky noise give some texture without obvious tiling.
  const coarse = Array.from({ length: 17 * 17 }, rnd);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const cx = (x / size) * 16, cy = (y / size) * 16, ix = Math.floor(cx), iy = Math.floor(cy), fx = cx - ix, fy = cy - iy;
    const a = coarse[iy * 17 + ix], b = coarse[iy * 17 + ix + 1], c2 = coarse[(iy + 1) * 17 + ix], d = coarse[(iy + 1) * 17 + ix + 1];
    const n = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c2 * (1 - fx) * fy + d * fx * fy;
    const k = 1 + (n - 0.5) * amp * 2 + (rnd() - 0.5) * amp;
    const i = (y * size + x) * 4;
    img.data[i] = Math.min(255, col.r * 255 * k); img.data[i + 1] = Math.min(255, col.g * 255 * k); img.data[i + 2] = Math.min(255, col.b * 255 * k); img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
function flatCanvas(rgb) { const c = document.createElement('canvas'); c.width = c.height = 4; const g = c.getContext('2d'); g.fillStyle = rgb; g.fillRect(0, 0, 4, 4); return c; }

export class MaterialLib {
  constructor(renderer, quality = 'high', detailed = false) {
    this.detailed = detailed;
    this.r = renderer;
    this.quality = quality;
    this.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.tex = new Map();
    this.mats = new Map();
    this.images = new Map();
  }

  // Load the images for the given slots (diff, nor, arm). Missing ones resolve to null.
  async preload(slots) {
    const jobs = [];
    for (const s of new Set(slots)) for (const k of ['diff', 'nor', 'arm']) {
      const key = `${s}_${k}`;
      if (this.images.has(key) || (SLOTS[s] || {}).procedural) continue;
      jobs.push(loadImage(`assets/tex/${key}.jpg`).then((img) => this.images.set(key, img)));
    }
    // Palms have no photo atlas yet; their card is drawn procedurally.
    for (const f of ['leaves_broad', 'leaves_pine', 'grass_blades', 'fern']) {
      if (this.images.has(f)) continue;
      jobs.push(loadImage(`assets/tex/${f}_diff.png`).then((img) => this.images.set(f, img)));
    }
    await Promise.all(jobs);
  }

  texture(slot, kind) {
    const key = `${slot}_${kind}`;
    if (this.tex.has(key)) return this.tex.get(key);
    const img = this.images.get(key);
    let t;
    if (img && kind === 'diff' && (SLOTS[slot] || {}).neutral) t = new THREE.CanvasTexture(neutralize(img));
    else if (img) t = new THREE.Texture(img);
    else if (kind === 'diff') t = new THREE.CanvasTexture(noiseCanvas((SLOTS[slot] || {}).color || '#888888'));
    else if (kind === 'nor') t = new THREE.CanvasTexture(flatCanvas('rgb(128,128,255)'));
    else t = new THREE.CanvasTexture(flatCanvas(`rgb(255,${Math.round(((SLOTS[slot] || {}).rough ?? 0.9) * 255)},${Math.round(((SLOTS[slot] || {}).metal ?? 0) * 255)})`));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = this.aniso;
    t.colorSpace = kind === 'diff' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.needsUpdate = true;
    t.userData.real = !!img;
    this.tex.set(key, t);
    return t;
  }

  // A textured standard material. Vertex colours (if present) tint the albedo.
  material(slot, opts = {}) {
    const key = slot + JSON.stringify(opts);
    if (this.mats.has(key)) return this.mats.get(key);
    if(slot.startsWith('vehicle_')) {
      const body=slot.startsWith('vehicle_paint'),gloss=slot.includes('_gloss'),glass=slot==='vehicle_glass',lens=slot==='vehicle_lens',rubber=slot==='vehicle_rubber';
      const m=new THREE.MeshPhysicalMaterial({vertexColors:true,roughness:body ? (gloss ? .4 : .68) : glass ? .28 : lens ? .25 : rubber ? .94 : .29,
        metalness:body ? .2 : glass ? .08 : rubber ? 0 : .65,clearcoat:body ? (gloss ? .22 : .035) : glass ? .22 : 0,clearcoatRoughness:.3,
        side:slot.endsWith('_double')||glass?THREE.DoubleSide:THREE.FrontSide,
        color:glass?0x172329:0xffffff,envMapIntensity:glass ? .35 : .6});
      if(body){m.map=this.texture('metal','diff');m.normalMap=this.texture('metal','nor');m.normalScale.set(.16,.16);m.roughnessMap=this.texture('metal','arm');}
      if(rubber){m.normalMap=this.texture('canvas','nor');m.normalScale.set(.12,.12);}
      this.mats.set(key,m);return m;
    }
    const info = SLOTS[slot] || { rough: 0.9 };
    const arm = this.texture(slot, 'arm');
    const m = new THREE.MeshStandardMaterial({
      map: this.texture(slot, 'diff'),
      normalMap: this.texture(slot, 'nor'),
      normalScale: new THREE.Vector2(opts.normal ?? 1, opts.normal ?? 1),
      roughnessMap: arm, metalnessMap: arm, aoMap: arm, aoMapIntensity: info.ao ?? 0.8,
      roughness: 1, metalness: info.metal ? 1 : 0,
      vertexColors: opts.vertexColors !== false,
      side: opts.side || THREE.FrontSide,
      flatShading: !!opts.flat,
    });
    if (info.albedo === false || opts.albedo === false) m.map = null;
    if (!arm.userData.real) { m.roughnessMap = null; m.metalnessMap = null; m.aoMap = null; m.roughness = info.rough; m.metalness = info.metal || 0; }
    if (this.detailed && !GROUND.has(slot) && !slot.startsWith('bark')) {
      // Macro weathering complements, rather than replaces, the photographic PBR
      // detail: damp at the foot, subtle vertical runoff, variable paint wear.
      m.onBeforeCompile = sh => {
        sh.vertexShader = 'varying vec3 njSurface;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n njSurface = position;');
        sh.fragmentShader = `varying vec3 njSurface;
          float surfaceHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
          float surfaceNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(surfaceHash(i),surfaceHash(i+vec2(1,0)),f.x),mix(surfaceHash(i+vec2(0,1)),surfaceHash(i+vec2(1)),f.x),f.y);}
          ` + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
          float damp = (1.0-smoothstep(0.0,.85,njSurface.y)) * (.12 + .13*surfaceNoise(njSurface.xz*2.0));
          float runoff = surfaceNoise(vec2((njSurface.x+njSurface.z)*4.0,njSurface.y*.18));
          diffuseColor.rgb *= 1.0-damp-.07*runoff;
          `);
      };
      m.customProgramCacheKey = () => 'nj-photo-weathering-v1';
    }
    this.mats.set(key, m);
    return m;
  }

  // Terrain texture arrays: one layer per slot, all at `size` px. Returns { diff, nor, arm, layers }.
  terrainArrays(slots, size = 1024) {
    const n = slots.length;
    const make = (kind, srgb) => {
      const data = new Uint8Array(size * size * 4 * n);
      const cv = document.createElement('canvas'); cv.width = cv.height = size;
      const g = cv.getContext('2d', { willReadFrequently: true });
      slots.forEach((slot, i) => {
        const img = this.images.get(`${slot}_${kind}`);
        g.clearRect(0, 0, size, size);
        if (slot === 'ice') g.drawImage(iceCanvas(kind, size), 0, 0, size, size);
        else if (slot === 'slush') g.drawImage(slushCanvas(kind, size), 0, 0, size, size);
        else if (img) g.drawImage(img, 0, 0, size, size);
        else if (kind === 'diff') g.drawImage(noiseCanvas((SLOTS[slot] || {}).color || '#888888', 256), 0, 0, size, size);
        else if (kind === 'nor') { g.fillStyle = 'rgb(128,128,255)'; g.fillRect(0, 0, size, size); }
        else { g.fillStyle = `rgb(255,${Math.round(((SLOTS[slot] || {}).rough ?? 0.9) * 255)},0)`; g.fillRect(0, 0, size, size); }
        data.set(g.getImageData(0, 0, size, size).data, i * size * size * 4);
      });
      const t = new THREE.DataArrayTexture(data, size, size, n);
      t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = this.aniso;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.needsUpdate = true;
      return t;
    };
    return { diff: make('diff', true), nor: make('nor', false), arm: make('arm', false), layers: slots };
  }

  // Alpha-cutout foliage atlas: a CC0 photo atlas if present, else painted procedurally.
  foliage(kind) {
    const key = 'fol_' + kind;
    if (this.tex.has(key)) return this.tex.get(key);
    const img = this.images.get(kind === 'leaves_detail' ? 'leaves_broad' : kind);
    let t;
    if (img && kind === 'leaves_detail') t = new THREE.Texture(img);
    else if (img && kind === 'leaves_broad') t = new THREE.CanvasTexture(composeLeafSpray(img));
    else if (img && kind === 'leaves_pine') t = new THREE.CanvasTexture(composePineBranch(img));
    else t = img ? new THREE.Texture(img) : new THREE.CanvasTexture(paintFoliage(kind));
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = this.aniso;
    t.needsUpdate = true;
    this.tex.set(key, t);
    return t;
  }
}

// ---------- procedural foliage painting (fallback when no CC0 atlas is available) ----------
function rng(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

export function paintFoliage(kind) {
  const S = 512;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const r = rng(kind.length * 7919 + 13);
  const greens = {
    leaves_broad: ['#3f5a24', '#4d6a2c', '#5b7a34', '#6b8a3c', '#35501f'],
    leaves_pine: ['#22341c', '#2b4022', '#33492a', '#3c5430'],
    leaves_palm: ['#4a6a2a', '#56782f', '#3e5c24'],
    grass_blades: ['#5a7034', '#6a803c', '#7a8a44', '#8a9450', '#4c6230'],
    wheat: ['#c8a85a', '#d8b868', '#b89848', '#e0c478', '#a88a40'],
    fern: ['#3a5a26', '#46682c', '#527632'],
  }[kind] || ['#4d6a2c'];
  const pick = () => greens[Math.floor(r() * greens.length)];
  if (kind === 'leaves_broad') {
    // A dense cluster of individual leaves with a darker core.
    for (let i = 0; i < 260; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * S * 0.42;
      const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d * 0.95;
      const len = 26 + r() * 22, w = len * 0.45, rot = r() * Math.PI * 2;
      g.save(); g.translate(x, y); g.rotate(rot);
      const shadeK = 0.65 + 0.35 * (d / (S * 0.42));
      const col = new THREE.Color(pick()).multiplyScalar(shadeK + r() * 0.15);
      g.fillStyle = '#' + col.getHexString();
      g.beginPath(); g.moveTo(0, -len / 2); g.quadraticCurveTo(w, 0, 0, len / 2); g.quadraticCurveTo(-w, 0, 0, -len / 2); g.fill();
      g.strokeStyle = 'rgba(20,30,10,0.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, -len / 2); g.lineTo(0, len / 2); g.stroke();
      g.restore();
    }
  } else if (kind === 'leaves_pine') {
    // A drooping conifer branch: twig plus thousands of needles.
    g.lineCap = 'round';
    for (let b = 0; b < 3; b++) {
      const y0 = S * (0.2 + b * 0.3);
      g.strokeStyle = '#3a2a1c'; g.lineWidth = 4; g.beginPath(); g.moveTo(S * 0.04, y0); g.quadraticCurveTo(S * 0.5, y0 - 10, S * 0.96, y0 + 30); g.stroke();
      for (let i = 0; i < 900; i++) {
        const t = r(), x = S * (0.04 + t * 0.92), y = y0 + t * t * 30 - 5 * t;
        const len = (1 - t * 0.6) * (30 + r() * 26), side = r() < 0.5 ? -1 : 1;
        const a = side * (0.6 + r() * 0.7) + 0.3;
        g.strokeStyle = pick(); g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len); g.stroke();
      }
    }
  } else if (kind === 'leaves_palm') {
    g.strokeStyle = '#5a4a2a'; g.lineWidth = 5; g.beginPath(); g.moveTo(S * 0.05, S * 0.5); g.quadraticCurveTo(S * 0.5, S * 0.42, S * 0.97, S * 0.56); g.stroke();
    for (let i = 0; i < 120; i++) {
      const t = i / 120, x = S * (0.07 + t * 0.88), y = S * (0.5 - 0.05 * Math.sin(t * Math.PI) + t * 0.05);
      const len = (1 - Math.abs(t - 0.4)) * S * 0.38;
      for (const side of [-1, 1]) {
        g.strokeStyle = pick(); g.lineWidth = 4;
        g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + len * 0.25, y + side * len * 0.5, x + len * 0.35, y + side * len); g.stroke();
      }
    }
  } else if (kind === 'grass_blades') {
    for (let i = 0; i < 220; i++) {
      const x = S * (0.05 + r() * 0.9), h = S * (0.45 + r() * 0.5), lean = (r() - 0.5) * S * 0.25;
      const grd = g.createLinearGradient(0, S, 0, S - h);
      const col = pick();
      grd.addColorStop(0, '#2a3418'); grd.addColorStop(0.4, col); grd.addColorStop(1, new THREE.Color(col).offsetHSL(0.02, 0, 0.12).getStyle());
      g.fillStyle = grd;
      g.beginPath(); g.moveTo(x - 3, S); g.quadraticCurveTo(x + lean * 0.3, S - h * 0.6, x + lean, S - h); g.quadraticCurveTo(x + lean * 0.3 + 2, S - h * 0.6, x + 3, S); g.fill();
    }
  } else if (kind === 'wheat') {
    // Tall ripe stalks with heavy ears: wheat, maize tassels, cane, elephant grass.
    for (let i = 0; i < 160; i++) {
      const x = S * (0.05 + r() * 0.9), h = S * (0.6 + r() * 0.38), lean = (r() - 0.5) * S * 0.12;
      const col = pick();
      g.strokeStyle = new THREE.Color(col).offsetHSL(0, -0.1, -0.12).getStyle(); g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(x, S); g.quadraticCurveTo(x + lean * 0.4, S - h * 0.6, x + lean, S - h); g.stroke();
      g.fillStyle = col;
      g.save(); g.translate(x + lean, S - h); g.rotate(lean / S * 2); g.beginPath(); g.ellipse(0, 10, 4.5, 15, 0, 0, Math.PI * 2); g.fill(); g.restore();
      if (r() < 0.5) { g.strokeStyle = col; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x + lean * 0.6, S - h * 0.55); g.lineTo(x + lean * 0.6 + (r() - 0.5) * 30, S - h * 0.4); g.stroke(); }
    }
  } else if (kind === 'fern') {
    for (let f = 0; f < 5; f++) {
      const a = -Math.PI / 2 + (f - 2) * 0.45;
      const L = S * 0.46;
      for (let i = 0; i < 40; i++) {
        const t = i / 40, x = S / 2 + Math.cos(a) * L * t, y = S * 0.95 + Math.sin(a) * L * t * 1.9;
        const len = (1 - t) * 34 + 6;
        g.strokeStyle = pick(); g.lineWidth = 3;
        for (const side of [-1, 1]) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a + side * 1.3) * len, y + Math.sin(a + side * 1.3) * len); g.stroke(); }
      }
    }
  }
  return c;
}

// Box-projected UVs in world units: every part of a model shares one texture scale, so bricks
// and planks line up across merged parts. `tile` is metres per texture repeat.
export function boxUV(geo, tile = 2) {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    let u, v;
    if (ny >= nx && ny >= nz) { u = x; v = z; } else if (nx >= nz) { u = z; v = y; } else { u = x; v = y; }
    uv[i * 2] = u / tile; uv[i * 2 + 1] = v / tile;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

// ---------- photo foliage composition ----------
// The CC0 broadleaf atlas is a 3x3 sheet of single beech leaves; real game foliage needs
// cards that each carry a whole spray of leaves on twigs. Build one at load time.
export function composeLeafSpray(img, seed = 3) {
  const S = 1024, cell = img.width / 3;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const tmp = document.createElement('canvas'); tmp.width = tmp.height = 256;
  const tg = tmp.getContext('2d');
  const r = rng(seed * 7919);
  // Twigs radiating from the lower centre.
  g.lineCap = 'round';
  const tips = [];
  for (let b = 0; b < 7; b++) {
    const a = -Math.PI / 2 + (b - 3) * 0.42 + (r() - 0.5) * 0.2;
    const len = S * (0.32 + r() * 0.14);
    const x0 = S / 2, y0 = S * 0.92;
    const x1 = x0 + Math.cos(a) * len, y1 = y0 + Math.sin(a) * len;
    g.strokeStyle = '#4a3a2a'; g.lineWidth = 7 - Math.abs(b - 3);
    g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2 + (r() - 0.5) * 60, (y0 + y1) / 2, x1, y1); g.stroke();
    for (let k = 0; k < 9; k++) { const tt = 0.25 + k / 10; tips.push([x0 + (x1 - x0) * tt + (r() - 0.5) * 50, y0 + (y1 - y0) * tt + (r() - 0.5) * 50, a]); }
  }
  // Leaves: back layer darker, front layer lighter, each a random cell of the atlas.
  for (let pass = 0; pass < 2; pass++) {
    for (const [x, y, a] of tips) {
      for (let n = 0; n < 2; n++) {
        const ci = Math.floor(r() * 9), cx = (ci % 3) * cell, cy = Math.floor(ci / 3) * cell;
        const size = S * (0.13 + r() * 0.07);
        tg.clearRect(0, 0, 256, 256);
        tg.globalCompositeOperation = 'source-over';
        tg.drawImage(img, cx, cy, cell, cell, 0, 0, 256, 256);
        const dark = pass === 0 ? 0.32 + r() * 0.2 : r() * 0.18;
        tg.globalCompositeOperation = 'source-atop';
        tg.fillStyle = `rgba(${pass ? 30 : 10},${pass ? 40 : 25},10,${dark})`; tg.fillRect(0, 0, 256, 256);
        g.save();
        g.translate(x + (r() - 0.5) * 40, y + (r() - 0.5) * 40);
        g.rotate(a + Math.PI / 2 + (r() - 0.5) * 1.6);
        g.drawImage(tmp, -size / 2, -size, size, size);
        g.restore();
      }
    }
  }
  return c;
}

// The conifer atlas holds three sprigs in rows; fan many of them into one drooping branch.
export function composePineBranch(img, seed = 5) {
  const W = 1024, H = 512;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const r = rng(seed * 104729);
  const rows = [[0.3, 0.64], [0.63, 0.98]];
  g.strokeStyle = '#3a2a1c'; g.lineWidth = 9; g.lineCap = 'round';
  g.beginPath(); g.moveTo(10, H * 0.45); g.quadraticCurveTo(W * 0.5, H * 0.35, W - 20, H * 0.6); g.stroke();
  for (let i = 0; i < 26; i++) {
    const t = i / 26;
    const x = 10 + t * (W - 60), y = H * (0.45 - 0.1 * Math.sin(t * Math.PI) + 0.15 * t * t);
    const [r0, r1] = rows[Math.floor(r() * 2)];
    const sw = img.width, sh = img.height * (r1 - r0);
    const len = (1 - t * 0.55) * W * 0.36;
    const side = i % 2 ? -1 : 1;
    g.save(); g.translate(x, y); g.rotate(side * (0.55 + r() * 0.35) + 0.15);
    g.globalAlpha = 0.95;
    g.drawImage(img, 0, img.height * r0, sw, sh, 0, -len * (sh / sw) / 2, len, len * (sh / sw));
    g.restore();
  }
  g.globalAlpha = 1;
  return c;
}
