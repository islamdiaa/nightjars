import * as THREE from 'three';
import { F, T } from '../core/constants.js';
import { TERRAIN_SLOT, SLOTS } from './materials.js';

// Ground: a heightfield whose material blends photoscanned PBR layers per tile in the
// fragment shader (texture arrays, domain-warped organic borders, anti-tiling, normal maps),
// with contact shadows, rain wetness and lamp pools. The mesh extends beyond the playable
// map and fades into darkness so there is never a void at the edges.
// Water is a separate reflective surface just below ground level.

const MAX_LAYERS = 16;

const NOISE = /* glsl */`
float nj_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float nj_noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(nj_hash(i), nj_hash(i + vec2(1.0, 0.0)), u.x), mix(nj_hash(i + vec2(0.0, 1.0)), nj_hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float nj_fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { s += a * nj_noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s / 0.875; }
`;

export class Terrain {
  constructor(renderer, grid, opts = {}) {
    this.renderer = renderer;
    this.grid = grid;
    this.opts = opts;
    this.lib = opts.lib;
    this.margin = opts.margin ?? 22;
    // Layers actually used by this map.
    const used = new Set();
    // On maps that use footprints (some tiles flagged F.SNOW), snow ground without the flag is
    // trodden: roads, paths and yards read as slush so the print-free routes can be seen.
    this.trodden = false;
    for (let i = 0; i < grid.w * grid.h; i++) if (grid.flags[i] & F.SNOW) { this.trodden = true; break; }
    for (let i = 0; i < grid.w * grid.h; i++) used.add(this.slotAt(i));
    this.slots = [...used].slice(0, MAX_LAYERS);
    this.layerOf = new Map(this.slots.map((s, i) => [s, i]));
    this.heights = this.vertexHeights();
    this.layerTex = this.makeLayerTexture();
    this.aoTex = this.makeAO();
    const size = opts.quality === 'low' ? 512 : 1024;
    this.arrays = this.lib.terrainArrays(this.slots, size);
    this.mesh = this.buildMesh(opts);
    this.water = this.buildWater(opts);
  }

  slotAt(i) {
    const g = this.grid, t = g.terrain[i];
    // The fords have a visible photographic gravel bed and gravel approaches.
    // This is visual only: movement still uses the original mission flags.
    if (this.isFord(i % g.w, Math.floor(i / g.w))) return 'gravel';
    if (this.trodden && t === T.SNOW && !(g.flags[i] & F.SNOW)) return 'slush';
    return TERRAIN_SLOT[t] || 'grass';
  }

  isFord(x, y) {
    return this.opts.crossings?.some(c => c.kind === 'ford' && x >= c.x && x < c.x+c.w && y >= c.y && y < c.y+c.h) || false;
  }

  makeLayerTexture() {
    const g = this.grid;
    const d = new Uint8Array(g.w * g.h * 4);
    for (let i = 0; i < g.w * g.h; i++) {
      d[i * 4] = this.layerOf.get(this.slotAt(i)) || 0;
      d[i * 4 + 1] = (g.flags[i] & F.SNOW) || !this.trodden ? 255 : 0;     // where the snow dusting may fall
      d[i * 4 + 3] = 255;
    }
    const t = new THREE.DataTexture(d, g.w, g.h, THREE.RGBAFormat);
    t.magFilter = t.minFilter = THREE.NearestFilter; t.needsUpdate = true;
    return t;
  }

  // Contact shadows: how hemmed-in each tile is by tall, sight-blocking things.
  makeAO() {
    const g = this.grid;
    const out = new Uint8Array(g.w * g.h * 4);
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      let s = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if ((!dx && !dy) || !g.inside(x + dx, y + dy)) continue;
        const f = g.flags[g.idx(x + dx, y + dy)];
        if ((f & F.SIGHT) && (f & F.BLOCK)) s += 1 / (dx * dx + dy * dy);
      }
      const self = (g.flags[g.idx(x, y)] & F.SIGHT) && (g.flags[g.idx(x, y)] & F.BLOCK);
      out[(y * g.w + x) * 4] = Math.round((self ? 0.7 : Math.min(1, s / 3.2)) * 255);
    }
    const t = new THREE.DataTexture(out, g.w, g.h, THREE.RGBAFormat);
    t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
    return t;
  }

  vertexHeights() {
    const g = this.grid, W = g.w + 1, H = g.h + 1;
    const hts = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
        const tx = x + dx, ty = y + dy;
        if (!g.inside(tx, ty)) continue;
        const i = g.idx(tx, ty), f = g.flags[i];
        s += g.height[i] - ((f & F.DEEP) ? 0.75 : (f & F.WATER) ? 0.32 : 0);
        n++;
      }
      hts[y * W + x] = n ? s / n : 0;
    }
    return hts;
  }

  heightAt(x, y) {
    const W = this.grid.w + 1;
    const cx = Math.max(0, Math.min(this.grid.w - 0.001, x)), cy = Math.max(0, Math.min(this.grid.h - 0.001, y));
    const x0 = Math.floor(cx), y0 = Math.floor(cy), fx = cx - x0, fy = cy - y0;
    const h = this.heights;
    const a = h[y0 * W + x0], b = h[y0 * W + x0 + 1], c = h[(y0 + 1) * W + x0], d = h[(y0 + 1) * W + x0 + 1];
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
  }

  buildMesh(opts) {
    const g = this.grid, M = this.margin;
    const detail=opts.preciseWater && opts.quality!=='low' ? 2 : 1;
    const geo = new THREE.PlaneGeometry(g.w + 2 * M, g.h + 2 * M, (g.w + 2 * M)*detail, (g.h + 2 * M)*detail);
    geo.rotateX(-Math.PI / 2);
    geo.translate(g.w / 2, 0, g.h / 2);
    const pos = geo.attributes.position;
    const W = g.w + 1;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const vx = Math.round(x), vz = Math.round(z);
      let h;
      if (x >= 0 && z >= 0 && x <= g.w && z <= g.h) h = detail>1 ? this.heightAt(x,z) : this.heights[vz * W + vx];
      else {
        // Beyond the edge: continue the border height with gentle undulation.
        h = this.heights[Math.max(0, Math.min(g.h, vz)) * W + Math.max(0, Math.min(g.w, vx))];
        const out = Math.max(-vx, vx - g.w, -vz, vz - g.h);
        // Under the sea beyond a water border the bed stays down, below the extended water plane.
        h += Math.sin(vx * 0.35) * Math.cos(vz * 0.31) * (h < -0.2 ? 0.06 : 0.25) * Math.min(1, out / 6);
      }
      pos.setY(i, h);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    const u = {
      tLayer: { value: this.layerTex }, tAO: { value: this.aoTex },
      tDiff: { value: this.arrays.diff }, tNor: { value: this.arrays.nor }, tArm: { value: this.arrays.arm },
      uSize: { value: new THREE.Vector2(g.w, g.h) },
      uTile: { value: Array.from({ length: MAX_LAYERS }, (_, i) => (SLOTS[this.slots[i]] || {}).tile || 3) },
      uMargin: { value: M }, uWet: { value: opts.wet ? 1 : 0 }, uNight: { value: opts.lampGlow ?? (opts.night ? 1 : 0) },
      uLamps: { value: Array.from({ length: 32 }, () => new THREE.Vector4()) },
      uLampCol: { value: Array.from({ length: 32 }, () => new THREE.Color()) },
      uLampCount: { value: 0 },
      uSnow: { value: opts.snowCover || 0 },
      uIceLayer: { value: this.layerOf.has('ice') ? this.layerOf.get('ice') : -1 },
      uFordLayer: { value: opts.preciseWater ? (this.layerOf.get('gravel') ?? -1) : -1 },
      // Detailed mode: living colour on planted ground (moss, leaf litter, sun-dried patches).
      uGrassLayer: { value: opts.preciseWater ? (this.layerOf.get('grass') ?? -1) : -1 },
      uForestLayer: { value: opts.preciseWater ? (this.layerOf.get('forest') ?? -1) : -1 },
    };
    this.uniforms = u;
    this.setLamps(opts.lamps || []);
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = 'varying vec3 vNjWp;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vNjWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = `
precision highp sampler2DArray;
varying vec3 vNjWp;
uniform sampler2D tLayer;
uniform sampler2D tAO;
uniform highp sampler2DArray tDiff;
uniform highp sampler2DArray tNor;
uniform highp sampler2DArray tArm;
uniform vec2 uSize;
uniform float uTile[${MAX_LAYERS}];
uniform float uMargin, uWet, uNight, uSnow;
uniform vec4 uLamps[32];
uniform vec3 uLampCol[32];
uniform int uLampCount;
uniform int uIceLayer, uFordLayer, uGrassLayer, uForestLayer;
vec3 njNormal = vec3(0.0, 0.0, 1.0);
vec3 njArm = vec3(1.0, 0.9, 0.0);
vec3 njGlow = vec3(0.0);
${NOISE}
int njLayer(vec2 p) { ivec2 c = clamp(ivec2(floor(p)), ivec2(0), ivec2(uSize) - 1); return int(texelFetch(tLayer, c, 0).r * 255.0 + 0.5); }
float njTile(int L) { float t = 3.0; for (int i = 0; i < ${MAX_LAYERS}; i++) if (i == L) t = uTile[i]; return t; }
` + sh.fragmentShader
        .replace('#include <map_fragment>', /* glsl */`
  {
    vec2 p = vNjWp.xz;
    vec2 warp = (vec2(nj_fbm(p * 0.42), nj_fbm(p * 0.42 + 31.7)) - 0.5) * 1.1;
    vec2 q = p + warp;
    int Ls[4]; float Ws[4];
    ${opts.preciseWater ? `
    // Continuous weights remove the old visible 25% bands at every texture border.
    // Narrow transitions retain recognisable paths; the domain warp breaks ruler edges.
    vec2 cell = floor(q - 0.5) + 0.5;
    vec2 blend = smoothstep(vec2(0.18), vec2(0.82), fract(q - 0.5));
    Ls[0] = njLayer(cell); Ls[1] = njLayer(cell + vec2(1.0, 0.0));
    Ls[2] = njLayer(cell + vec2(0.0, 1.0)); Ls[3] = njLayer(cell + vec2(1.0));
    Ws[0] = (1.0-blend.x)*(1.0-blend.y); Ws[1] = blend.x*(1.0-blend.y);
    Ws[2] = (1.0-blend.x)*blend.y; Ws[3] = blend.x*blend.y;
    ` : `
    Ls[0] = njLayer(q + vec2(-0.24, -0.24)); Ls[1] = njLayer(q + vec2(0.24, -0.24));
    Ls[2] = njLayer(q + vec2(-0.24, 0.24)); Ls[3] = njLayer(q + vec2(0.24, 0.24));
    for (int i = 0; i < 4; i++) Ws[i] = 0.25;
    `}
    // Merge duplicate layers so each texture is fetched once.
    for (int i = 1; i < 4; i++) for (int j = 0; j < 4; j++) if (j < i && Ls[j] == Ls[i] && Ws[i] > 0.0) { Ws[j] += Ws[i]; Ws[i] = 0.0; }
    vec3 col = vec3(0.0); vec3 nrm = vec3(0.0); vec3 arm = vec3(0.0); float iceW = 0.0;
    float anti = smoothstep(0.35, 0.65, nj_fbm(p * 0.045 + 5.0));
    for (int i = 0; i < 4; i++) {
      if (Ws[i] <= 0.0) continue;
      if (Ls[i] == uIceLayer) iceW += Ws[i];
      float L = float(Ls[i]);
      float tile = njTile(Ls[i]);
      if (Ls[i] == uFordLayer) tile *= 2.2;
      vec2 uv1 = p / tile;
      vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * p / (tile * 1.9) + 0.37;
      vec3 d1 = texture(tDiff, vec3(uv1, L)).rgb;
      vec3 d2 = texture(tDiff, vec3(uv2, L)).rgb;
      vec3 albedo = mix(d1, d2, anti * 0.55);
      if (Ls[i] == uFordLayer) albedo *= vec3(0.48, 0.43, 0.34);
      if (Ls[i] == uForestLayer || Ls[i] == uGrassLayer) {
        albedo *= vec3(0.9, 0.93, 0.8);
        float moss = smoothstep(0.34, 0.62, nj_fbm(p * 0.11 + 21.0));
        float litter = smoothstep(0.5, 0.75, nj_fbm(p * 0.19 + 47.0));
        float lum = dot(albedo, vec3(0.3, 0.55, 0.15));
        vec3 green = (Ls[i] == uForestLayer ? vec3(0.34, 0.47, 0.2) : vec3(0.42, 0.56, 0.24)) * (0.55 + lum * 1.5);
        albedo = mix(albedo, green, (Ls[i] == uForestLayer ? 0.62 : 0.5) * moss);
        albedo = mix(albedo, albedo * vec3(1.12, 0.84, 0.6), 0.5 * litter * (1.0 - moss));
      }
      col += Ws[i] * albedo;
      nrm += Ws[i] * (texture(tNor, vec3(uv1, L)).xyz * 2.0 - 1.0);
      arm += Ws[i] * texture(tArm, vec3(uv1, L)).rgb;
    }
    col *= 0.86 + 0.28 * nj_fbm(p * 0.06 + 3.0);
    float ao = texture2D(tAO, clamp(p / uSize, 0.0, 1.0)).r;
    col *= 1.0 - ao * 0.42;
    // Rain: darker, glossier ground in patches.
    float wet = uWet * smoothstep(0.45, 0.7, nj_fbm(p * 0.35 + 9.0));
    col *= 1.0 - wet * 0.3;
    arm.g = mix(arm.g, 0.5, wet * 0.7);
    // A dusting of snow on the upward-facing bumps.
    if (uSnow > 0.0) {
      float mask = texelFetch(tLayer, clamp(ivec2(floor(p)), ivec2(0), ivec2(uSize) - 1), 0).g;
      float sn = smoothstep(0.35, 0.65, nj_fbm(p * 0.5) + (texture(tNor, vec3(p / 3.0, 0.0)).z - 0.5)) * uSnow * (1.0 - 0.8 * iceW) * mix(0.25, 1.0, mask);
      col = mix(col, vec3(0.86, 0.9, 0.95), sn);
    }
    // Beyond the playable map, fade into darkness.
    float outside = max(max(-p.x, p.x - uSize.x), max(-p.y, p.y - uSize.y));
    col *= mix(1.0, 0.18, smoothstep(0.0, uMargin * 0.85, outside));
    diffuseColor.rgb *= col;
    njNormal = normalize(nrm + vec3(0.0, 0.0, 0.001));
    njArm = arm;
    if (uNight > 0.0) {
      for (int i = 0; i < 32; i++) {
        if (i >= uLampCount) break;
        vec4 L = uLamps[i];
        float d = length(p - L.xy) / L.z;
        // A warm pool that keeps the ground's texture: soft edge, no flat white core.
        njGlow += uLampCol[i] * L.w * smoothstep(1.0, 0.0, d) * (0.55 + 0.3 * smoothstep(1.0, 0.2, d));
      }
    }
  }`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * clamp(njArm.g, 0.05, 1.0);')
        .replace('#include <normal_fragment_maps>', /* glsl */`
  {
    vec3 Tv = normalize((viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
    vec3 Bv = normalize((viewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
    normal = normalize(Tv * njNormal.x * 1.1 + Bv * njNormal.y * 1.1 + normal * njNormal.z);
  }`)
        .replace('#include <aomap_fragment>', /* glsl */`
  float ambientOcclusion = mix(1.0, njArm.r, 0.55);
  reflectedLight.indirectDiffuse *= ambientOcclusion;
  reflectedLight.indirectSpecular *= ambientOcclusion;`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * njGlow * 0.8 * uNight;');
    };
    mat.customProgramCacheKey = () => 'nj-terrain-continuous-v4-' + !!opts.preciseWater;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'ground';
    return mesh;
  }

  setLamps(lamps) {
    const u = this.uniforms;
    const n = Math.min(32, lamps.length);
    for (let i = 0; i < n; i++) {
      const L = lamps[i];
      u.uLamps.value[i].set(L.x, L.y, L.r * 1.15, L.off ? 0 : (L.kind === 'fire' ? 0.95 : 0.75));
      u.uLampCol.value[i].set(L.color || 0xffd28a);
    }
    u.uLampCount.value = n;
  }

  // 2D minimap from the average colour of each layer.
  minimapCanvas(scale = 3) {
    const g = this.grid;
    const avg = this.slots.map((s) => avgColor(this.lib.images.get(`${s}_diff`)) || new THREE.Color((SLOTS[s] || {}).color || '#777'));
    const cv = document.createElement('canvas'); cv.width = g.w * scale; cv.height = g.h * scale;
    const ctx = cv.getContext('2d');
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      const i = g.idx(x, y), f = g.flags[i];
      let c = avg[this.layerOf.get(this.slotAt(i)) || 0].clone();
      if (f & (F.WATER | F.DEEP)) c = new THREE.Color(f & F.DEEP ? '#2a4a58' : '#4a6e74');
      if (f & F.INDOOR) c = new THREE.Color('#6a5444');
      else if ((f & F.SIGHT) && (f & F.BLOCK)) c.multiplyScalar(0.55);
      else if (f & F.BUSH) c.multiplyScalar(0.8);
      ctx.fillStyle = '#' + c.getHexString();
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
    return cv;
  }

  buildWater(opts) {
    const g = this.grid;
    let any = false;
    const raw = new Float32Array(g.w * g.h);
    for (let i = 0; i < g.w * g.h; i++) { const f = g.flags[i]; raw[i] = (f & F.DEEP) ? 1 : (f & F.WATER) ? 0.45 : 0; if (raw[i]) any = true; }
    if (!any) return null;
    const blur = (src) => {
      const out = new Float32Array(src.length);
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { s += src[Math.min(g.h - 1, Math.max(0, y + dy)) * g.w + Math.min(g.w - 1, Math.max(0, x + dx))]; n++; }
        out[y * g.w + x] = s / n;
      }
      return out;
    };
    const m = blur(blur(raw));
    const data = new Uint8Array(g.w * g.h * 4);
    for (let i = 0; i < g.w * g.h; i++) {
      data[i * 4] = Math.round(m[i] * 255);
      data[i * 4 + 1] = Math.round(raw[i] * 255); // unblurred collision-aligned water mask
      data[i * 4 + 2] = this.isFord(i % g.w, Math.floor(i / g.w)) ? 255 : 0;
      data[i * 4 + 3] = 255;
    }
    const shore = new THREE.DataTexture(data, g.w, g.h, THREE.RGBAFormat);
    shore.magFilter = shore.minFilter = THREE.LinearFilter; shore.needsUpdate = true;
    shore.wrapS = shore.wrapT = THREE.ClampToEdgeWrapping;
    this.shoreTexture = shore;
    const u = { uTime: { value: 0 }, tShore: { value: shore }, uSize: { value: new THREE.Vector2(g.w, g.h) }, uIce: { value: opts.ice ? 1 : 0 }, uMargin: { value: this.margin },
      uDeep: { value: new THREE.Color(opts.waterDeep || (opts.preciseWater ? '#101f20' : '#0f2a33')) }, uShallow: { value: new THREE.Color(opts.waterShallow || (opts.preciseWater ? '#405448' : '#3d6a68')) } };
    u.uPrecise = { value: opts.preciseWater ? 1 : 0 };
    this.waterUniforms = u;
    // At night a calm, dark sheen: a rougher surface keeps the moon from scattering white sparks.
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: opts.ice ? 0.35 : opts.night ? 0.45 : 0.06, metalness: 0.05, transparent: true, depthWrite: false, envMapIntensity: opts.night ? 0.3 : 1.2 });
    if (opts.preciseWater) { mat.roughness = opts.night ? .52 : .38; mat.envMapIntensity = opts.night ? .18 : .3; }
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = 'varying vec3 vNjWp;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vNjWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = `varying vec3 vNjWp;\nuniform float uTime, uIce, uMargin, uPrecise;\nuniform sampler2D tShore;\nuniform vec2 uSize;\nuniform vec3 uDeep, uShallow;\n${NOISE}\nfloat njDepth = 0.0;\n` + sh.fragmentShader
        .replace('#include <map_fragment>', /* glsl */`
  {
    vec2 p = vNjWp.xz;
    njDepth = texture2D(tShore, p / uSize).r;
    vec4 cell = texelFetch(tShore, clamp(ivec2(floor(p)), ivec2(0), ivec2(uSize)-1), 0);
    float ford = cell.b * uPrecise;
    if (uPrecise > 0.5) {
      // Blurring the mask used to flood dry banks and the bridge visually.
      // Keep soft ripples, but never draw water on a dry simulation tile.
      if (cell.g < 0.1) discard;
      njDepth = texture2D(tShore, p / uSize).g;
    }
    float t = uTime * (1.0 - uIce);
    vec3 c = mix(uShallow, uDeep, smoothstep(0.2, 0.85, njDepth));
    float foam = smoothstep(0.3, 0.1, njDepth) * smoothstep(0.02, 0.1, njDepth) * smoothstep(0.45, 0.8, nj_noise(p * 3.5 + vec2(t * 0.5, 0.0)) + 0.25 * sin(t * 1.4 + p.x * 2.0));
    c = mix(c, vec3(0.85, 0.9, 0.9), foam * (1.0 - uIce) * 0.8);
    c = mix(c, vec3(0.07, 0.095, 0.06), ford * 0.65);
    if (uIce > 0.5) c = mix(c, vec3(0.75, 0.84, 0.9), 0.7);
    // Past the map edge the sea carries on (the shore map clamps to the border) and darkens
    // with the land around it.
    float outside = max(max(-p.x, p.x - uSize.x), max(-p.y, p.y - uSize.y));
    c *= mix(1.0, 0.18, smoothstep(0.0, uMargin * 0.85, outside));
    diffuseColor.rgb = c;
    diffuseColor.a = mix(0.55, 0.94, smoothstep(0.05, 0.6, njDepth)) * smoothstep(0.0, 0.06, njDepth);
    // Let the gravel bed show through at the only two wading crossings.
    diffuseColor.a = mix(diffuseColor.a, 0.24, ford);
  }`)
        .replace('#include <normal_fragment_maps>', /* glsl */`
  {
    vec2 p = vNjWp.xz;
    float t = uTime * (1.0 - uIce);
    float e = 0.15;
    float h0 = nj_noise(p * 1.3 + vec2(t * 0.35, t * 0.2)) + 0.5 * nj_noise(p * 3.1 - vec2(t * 0.25, -t * 0.4));
    float hx = nj_noise((p + vec2(e, 0.0)) * 1.3 + vec2(t * 0.35, t * 0.2)) + 0.5 * nj_noise((p + vec2(e, 0.0)) * 3.1 - vec2(t * 0.25, -t * 0.4));
    float hz = nj_noise((p + vec2(0.0, e)) * 1.3 + vec2(t * 0.35, t * 0.2)) + 0.5 * nj_noise((p + vec2(0.0, e)) * 3.1 - vec2(t * 0.25, -t * 0.4));
    float wave = mix(.18,.075,uPrecise);
    vec3 nW = normalize(vec3(-(hx - h0) / e * wave, 1.0, -(hz - h0) / e * wave));
    normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
  }`);
    };
    mat.customProgramCacheKey = () => 'nj-water';
    const M = this.margin;
    const geo = new THREE.PlaneGeometry(g.w + 2 * M, g.h + 2 * M, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(g.w / 2, -0.12, g.h / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 1;
    mesh.receiveShadow = true;
    mesh.name = 'water';
    return mesh;
  }

  // A night (or a scripted nightfall) wants a calm, dark sheen on the water, not glitter.
  setWaterNight(night) {
    if (!this.water) return;
    const m = this.water.material;
    m.roughness = this.opts.ice ? 0.35 : night ? 0.45 : 0.06;
    m.envMapIntensity = night ? 0.3 : 1.2;
    if (this.opts.preciseWater) { m.roughness = night ? .52 : .38; m.envMapIntensity = night ? .18 : .3; }
  }

  dispose() {
    this.layerTex.dispose(); this.aoTex.dispose();
    for (const k of ['diff', 'nor', 'arm']) this.arrays[k].dispose();
    this.mesh.geometry.dispose(); this.mesh.material.dispose();
    if (this.water) { this.water.geometry.dispose(); this.water.material.dispose(); this.shoreTexture.dispose(); }
  }
}

function avgColor(img) {
  if (!img) return null;
  const c = document.createElement('canvas'); c.width = c.height = 8;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, 8, 8);
  const d = g.getImageData(0, 0, 8, 8).data;
  let r = 0, gg = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
  return new THREE.Color().setRGB(r / 64 / 255, gg / 64 / 255, b / 64 / 255, THREE.SRGBColorSpace);
}
