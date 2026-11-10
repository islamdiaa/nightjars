import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { F, T } from '../core/constants.js';
import { Terrain } from './terrain.js';
import { MaterialLib, SLOTS } from './materials.js';
import { buildBuilding, buildProp, buildBarrier, CHARRED_MAT } from './models.js';
import { buildVegetation, buildGrass, windUniforms, holeUniforms, MAX_HOLES } from './foliage.js';
import { Figure, setFigureLib } from './humanoid.js';
import { VehicleView } from './vehicles.js';
import { loadCharacters, characterIdFor, characterIdsFor, hasCharacter, SkinnedFigure } from './characters.js';
import { Overlays } from './overlays.js';
import { Fx } from './fx.js';
import { Tells } from './tells.js';
import { seeded, setModelDetail } from './kit.js';
import { loadModels, forestDebris } from './props3d.js';
import { prepareForest, buildForest, buildUnderstory, updateForest, disposeForest } from './forest.js';
import { prepareArchitecture, clearFacadeCache } from './architecture.js';
import { FacadeBatches } from './facade-batches.js';

// Time-of-day lighting: sun, sky fill, HDRI, fog and colour grade.
const LIGHTING = {
  dawn:    { sun: '#ffb27a', sunI: 2.4, elev: 14, az: 120, hemiSky: '#9aa6c4', hemiGround: '#4a3c30', hemiI: 0.35, env: 0.55, hdri: 'dawn', fog: '#b9aca2', exposure: 1.15, bg: '#2a2622', grade: { sat: 0.92, contrast: 1.05, tint: [1.04, 0.98, 0.92], vig: 0.3 } },
  morning: { sun: '#fff0d8', sunI: 3.0, elev: 32, az: 135, hemiSky: '#b8cbe6', hemiGround: '#55483a', hemiI: 0.3, env: 0.7, hdri: 'day', fog: '#b8c4cc', exposure: 1.0, bg: '#2a2a28', grade: { sat: 0.95, contrast: 1.06, tint: [1.02, 1.0, 0.96], vig: 0.38 } },
  day:     { sun: '#fff4e2', sunI: 3.2, elev: 52, az: 150, hemiSky: '#c4d6ee', hemiGround: '#5d5040', hemiI: 0.3, env: 0.75, hdri: 'day', fog: '#c2ccd2', exposure: 0.95, bg: '#2a2a28', grade: { sat: 0.95, contrast: 1.05, tint: [1.02, 1.0, 0.97], vig: 0.26 } },
  dusk:    { sun: '#ff8d4e', sunI: 2.2, elev: 9, az: 250, hemiSky: '#6e5f8c', hemiGround: '#3a2c26', hemiI: 0.3, env: 0.5, hdri: 'dusk', fog: '#8a6a62', exposure: 1.05, bg: '#221c1c', grade: { sat: 0.95, contrast: 1.08, tint: [1.05, 0.96, 0.9], vig: 0.45 } },
  // Night is moonlit, Commandos-style: dark and blue but legible everywhere, lamps as warm accents.
  night:   { sun: '#a9c0ff', sunI: 1.7, elev: 48, az: 210, hemiSky: '#5a6fa8', hemiGround: '#262634', hemiI: 0.85, env: 0.28, hdri: 'night', fog: '#121826', exposure: 1.4, bg: '#0a0c12', grade: { sat: 0.72, contrast: 1.04, tint: [0.9, 0.97, 1.1], vig: 0.42 } },
};
LIGHTING.overcast = { ...LIGHTING.day, sunI: 1.2, env: 1.0, hdri: 'overcast', hemiI: 0.5 };

// Snow under a moon is bright already: lift the dark less there.
function nightLift(L, def) {
  if (L !== LIGHTING.night) return L;
  const snowy = /snow|ice|fjord/.test(def.biome || '') || def.weather === 'snow' || def.weather === 'blizzard';
  return snowy ? { ...L, sunI: 0.85, hemiI: 0.4, exposure: 1.22 } : L;
}

const PITCH = 40 * Math.PI / 180;
const DECK = { barge: 0.85, ship: 1.45, warship: 1.7, uboat: 1.2 };
const MAX_CONES = 40;
const VEH_GREY = '#5c6268';
const OCCLUDING_PROPS = ['ship', 'warship', 'tank', 'truck', 'tower', 'crane', 'locomotive', 'wagon', 'fueltank', 'bunker', 'pillbox', 'tent', 'uboat', 'halftrack'];

// Colour grade applied in linear HDR before tone mapping.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uSat: { value: 1 }, uContrast: { value: 1 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uVig: { value: 0.4 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uSat, uContrast, uVig; uniform vec3 uTint; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = max(c.rgb, vec3(0.0));
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col = 0.18 * pow(col / 0.18 + 1e-5, vec3(uContrast));
      col *= uTint;
      float d = length((vUv - 0.5) * vec2(1.2, 1.0));
      col *= mix(1.0, 1.0 - uVig, smoothstep(0.3, 0.9, d));
      gl_FragColor = vec4(col, c.a);
    }`,
};

const hdrCache = new Map();
let paintedIndex = null;

export class GameRenderer {
  // Load textures and lighting, then build the scene.
  static async create(container, world, built, opts = {}, onProgress = () => {}) {
    const q = new URLSearchParams(location.search);
    const world3d = q.get('world') === '3d' || (window.NJ_RELEASE || {}).world === '3d';
    const forest = world.def.id === 'm01' && world3d;
    if (world3d) opts = { ...opts, detailed: true, post: false };
    if (forest) opts = { ...opts, forest: true, post: false };
    let painted = null;
    if (!world3d && !q.get('plate') && q.get('painted') !== '0') {
      // assets/painted/index.json lists the published paintings ({ "m01": ["dawn"], … }), so
      // unpainted missions never probe for a manifest that isn't there.
      try {
        if (!paintedIndex) paintedIndex = fetch('assets/painted/index.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
        const idx = await paintedIndex;
        if ((idx[world.def.id] || []).includes(world.def.time)) {
          const res = await fetch(`assets/painted/${world.def.id}/${world.def.time}/manifest.json`);
          if (res.ok) painted = await res.json();
        }
      } catch (e) { painted = null; }
    }
    const r = new THREE.WebGLRenderer({ antialias: !!painted || world3d, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve });
    const lib = new MaterialLib(r, opts.quality, world3d);
    onProgress('Loading textures…');
    // Rigged character models for every unit that will appear (heroes, garrison, NPCs, disguises).
    const charIds = characterIdsFor(world);
    await Promise.all([lib.preload(Object.keys(SLOTS)), loadModels(null, world3d ? 'forest' : ''), loadCharacters(charIds), world3d ? prepareForest() : null, world3d ? prepareArchitecture(built.things) : null]);
    const L = LIGHTING[world.def.weather === 'overcast' ? 'overcast' : world.def.time] || LIGHTING.day;
    onProgress('Lighting the scene…');
    let hdr = null;
    try {
      if (!hdrCache.has(L.hdri)) hdrCache.set(L.hdri, new HDRLoader().loadAsync(`assets/hdri/${L.hdri}.hdr`).catch(() => null));
      hdr = await hdrCache.get(L.hdri);
    } catch (e) { hdr = null; }
    if (painted) {
      onProgress('Unrolling the painted map…');
      const loader = new THREE.TextureLoader();
      painted.textures = await Promise.all(painted.tiles.map((tile) => loader.loadAsync(`assets/painted/${world.def.id}/${world.def.time}/${tile.file}`).catch(() => null)));
    }
    onProgress('Building the battlefield…');
    return new GameRenderer(container, world, built, { ...opts, painted }, r, lib, hdr);
  }

  constructor(container, world, built, opts, renderer, lib, hdr) {
    this.container = container;
    this.world = world;
    this.built = built;
    this.opts = opts;
    this.lib = lib;
    setModelDetail(opts.detailed);
    setFigureLib(lib);
    const r = this.renderer = renderer;
    const high = opts.quality !== 'low';
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? (opts.detailed ? 1.25 : 1.5) : 1));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(r.domElement);
    r.domElement.className = 'game-canvas';

    this.scene = new THREE.Scene();
    this.views = new Map();
    this.unitCullEnabled=!!opts.detailed;
    this.unitFrustum=new THREE.Frustum();this.unitProjection=new THREE.Matrix4();this.unitBounds=new THREE.Sphere();
    this.thingViews = new Map();
    this.labels = new Map();
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'labels';
    container.appendChild(this.labelLayer);

    const def = world.def;
    const baseLight = nightLift(LIGHTING[def.weather === 'overcast' ? 'overcast' : def.time] || LIGHTING.day, def);
    const L = opts.forest ? { ...baseLight, sun: '#ffe0b2', sunI: 2.2, elev: 24, hemiSky: '#b5bda6', hemiI: .7, env: .5, exposure: 1.1 } : baseLight;
    this.L = L;
    this.isNight = def.time === 'night';
    // Street lamps, marker lights and searchlights burn from dusk to dawn (vision uses them then too).
    this.lampsLit = this.isNight || def.time === 'dusk' || def.time === 'dawn';
    r.toneMappingExposure = L.exposure;
    this.scene.background = new THREE.Color(L.bg);
    this.setupEnvironment(hdr, L);

    // Camera
    const g = world.grid;
    this.camTarget = new THREE.Vector3(g.w / 2, 0, g.h / 2);
    this.yaw = Math.PI / 4;
    this.pitch = opts.detailed ? 50 * Math.PI / 180 : PITCH;
    this.yawTarget = this.yaw;
    this.zoom = opts.zoom || 20;
    this.zoomTarget = this.zoom;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    this.follow = null;

    // Lights
    this.hemi = new THREE.HemisphereLight(L.hemiSky, L.hemiGround, L.hemiI);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(L.sun, L.sunI);
    this.sun.castShadow = true;
    const ss = high && !opts.detailed ? 4096 : 2048;
    this.sun.shadow.mapSize.set(ss, ss);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 2.5;
    this.scene.add(this.sun, this.sun.target);
    const el = L.elev * Math.PI / 180, az = L.az * Math.PI / 180;
    this.sunDir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();

    // Fog
    this.fogDensity = { fog: 0.82, smoke: 0.75, blizzard: 0.9, snow: 0.35, rain: 0.35, storm: 0.5 }[def.weather] || 0;
    this.scene.fog = new THREE.Fog(L.fog, 60, 260);

    // Terrain & world
    const lamps = built.lights.map((l) => ({ ...l, off: !!(l.id && (world.s.objs[l.id] || {}).lightOff) }));
    const snowy = /snow/.test(def.biome || '') || def.weather === 'snow' || def.weather === 'blizzard';
    this.terrain = new Terrain(r, g, { lib, seed: def.seed, night: this.isNight, lampGlow: this.isNight ? 1 : def.time === 'dusk' ? 0.8 : this.lampsLit ? 0.6 : 0, wet: def.weather === 'rain' || def.weather === 'storm', lamps, ice: def.ice, waterDeep: def.waterDeep, waterShallow: def.waterShallow, quality: opts.quality, snowCover: snowy ? 0.6 : 0, preciseWater: opts.detailed, crossings: def.crossings });
    this.scene.add(this.terrain.mesh);
    if (this.terrain.water) this.scene.add(this.terrain.water);
    this.buildStatic(snowy, high);

    if (this.terrain.water) this.terrain.water.userData.noAO = true;
    this.overlays = new Overlays(this.scene, world, this.terrain);
    this.overlays.root.userData.noAO = true;
    this.fx = new Fx(this.scene, this.terrain, def.weather, def.time);
    this.lampLights = [];
    this.buildLamps();
    if (def.fires) for (const [x, y, s] of def.fires) this.fx.addFire(x, y, s || 1);

    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.occluders = [];
    this.thingViews.forEach((v) => { if (v.userData.occluder) this.occluders.push(v); });
    this.frame = 0;
    this.time = 0;
    this.shownCones = new Set();
    this.hoverEnemy = null;
    this.reveals = [];
    if (opts.painted) this.applyPainted(opts.painted); else this.setupPost(high, L);
    // Footprints and searchlight beams: live in every mode except plates.
    this.tellsOpts = { painted: !!opts.painted, fx: this.fx, views: this.views,
      buildModel: (kind) => buildProp({ kind: kind === 'bomber' ? 'bomber' : 'plane', id: 'air' + kind }, null, this.lib) };
    this.tells = new Tells(this.scene, world, this.terrain, this.thingViews, this.tellsOpts);
    this.resize();
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    for (const e of world.ents) this.addView(e);
  }

  // Image-based lighting from a CC0 HDRI (or a painted sky gradient if none is available).
  setupEnvironment(hdr, L) {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    let env;
    if (hdr) { hdr.mapping = THREE.EquirectangularReflectionMapping; env = pmrem.fromEquirectangular(hdr).texture; }
    else {
      const sky = new THREE.Scene();
      const geo = new THREE.SphereGeometry(10, 32, 16);
      const top = new THREE.Color(L.hemiSky), bot = new THREE.Color(L.hemiGround);
      const col = [];
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) { const k = (p.getY(i) / 10 + 1) / 2; const c = bot.clone().lerp(top, Math.pow(k, 0.7)); col.push(c.r, c.g, c.b); }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      sky.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
      env = pmrem.fromScene(sky, 0.04).texture;
    }
    this.scene.environment = env;
    this.scene.environmentIntensity = L.env;
    pmrem.dispose();
  }

  setupPost(high, L) {
    this.composer = null;
    if (this.opts.post === false) return;
    try {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
      const c = new EffectComposer(this.renderer, rt);
      c.addPass(new RenderPass(this.scene, this.camera));
      if (high) {
        const ao = new GTAOPass(this.scene, this.camera, size.x, size.y);
        ao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 12 });
        ao.blendIntensity = 0.85;
        c.addPass(ao);
        this.gtao = ao;
      }
      // Bloom only on real highlights (lamp heads, fire, flashes), never on lit ground.
      const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), this.isNight ? 0.32 : 0.28, 0.5, this.isNight ? 0.92 : 0.88);
      c.addPass(bloom);
      this.bloom = bloom;
      const grade = new ShaderPass(GradeShader);
      this.grade = grade;
      grade.uniforms.uSat.value = L.grade.sat; grade.uniforms.uContrast.value = L.grade.contrast;
      grade.uniforms.uTint.value.set(...L.grade.tint); grade.uniforms.uVig.value = L.grade.vig;
      c.addPass(grade);
      c.addPass(new OutputPass());
      this.composer = c;
    } catch (e) {
      console.warn('Post-processing unavailable, rendering directly', e);
      this.composer = null;
    }
  }

  // ---------- static world ----------
  buildStatic(snowy, high) {
    const w = this.world, H = (x, y) => this.terrain.heightAt(x, y);
    const style = w.def.style || 'europe';
    const edges = this.edgeForest().filter(t => !this.opts.detailed || (t.x >= -7 && t.y >= -7 && t.x <= w.grid.w + 7 && t.y <= w.grid.h + 7));
    const vegThings = [...this.built.things, ...edges];
    const importedBush = t => t.type === 'bush' && (t.kind === 'fern' || (this.opts.forest && (!t.kind || t.kind === 'bush')));
    const importedTree = t => t.type === 'tree' && (this.opts.forest || !t.kind || ['pine','spruce'].includes(t.kind));
    this.vegetation = buildVegetation(this.opts.detailed ? vegThings.filter(t => !importedTree(t) && !importedBush(t)) : vegThings, H, { snowy, lib: this.lib });
    this.scene.add(this.vegetation);
    if (this.opts.detailed) {
      // Temper the legacy undergrowth atlas to match the photographed pine palette.
      this.vegetation.traverse(o => { if (o.isMesh) {
        const source = o.material, material = source.clone();
        const compile = source.onBeforeCompile;
        material.onBeforeCompile = shader => {
          compile(shader);
          shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(.2126,.7152,.0722))), diffuseColor.rgb, .68) * .85;');
        };
        material.customProgramCacheKey = () => 'forest-undergrowth-v1' + source.customProgramCacheKey();
        o.material = material;
      }});
      this.forest = buildForest(vegThings.filter(importedTree), H, snowy);
      this.scene.add(this.forest);
      this.understory = buildUnderstory(vegThings.filter(importedBush),H);
      this.scene.add(this.understory);
    }
    const grass = buildGrass(w.grid, H, this.lib, { density: high ? 1 : 0.45, snowy });
    if (grass) this.scene.add(grass);
    this.debris = forestDebris(w.grid, this.built.things, H, F, T);
    this.scene.add(this.debris);
    for (const t of this.built.things) {
      let obj = null;
      if (t.type === 'building') {
        obj = buildBuilding(t, t.style || style, this.lib);
        obj.position.set(t.x + t.w / 2, minHeight(this.terrain, t), t.y + t.h / 2);
        obj.userData.occluder = true;
        if (!this.isNight) obj.children.forEach((c) => { if (c.userData.windows) c.visible = false; });
      } else if (t.type === 'barrier' || t.type === 'fence') {
        obj = buildBarrier(t, H, this.lib);
      } else if (t.type === 'door') {
        // A second door: a door leaf set in the wall, half a tile in from the doorway tile.
        obj = buildProp({ ...t, kind: 'door', w: 1, h: 1 }, null, this.lib);
        if (obj) {
          const off = { n: [0, 0.45], s: [0, -0.45], e: [-0.45, 0], w: [0.45, 0] }[t.side] || [0, 0];
          obj.position.set(t.x + 0.5 + off[0], H(t.x + 0.5, t.y + 0.5), t.y + 0.5 + off[1]);
          obj.rotation.y = t.side === 'e' || t.side === 'w' ? Math.PI / 2 : 0;
        }
      } else if (t.type === 'prop' || t.type === 'target' || t.type === 'gate' || t.type === 'item') {
        obj = buildProp(t, t.color, this.lib);
        if (!obj && t.type === 'gate') obj = buildProp({ ...t, kind: 'roadblock' }, null, this.lib);
        if (!obj && t.type === 'item') obj = buildProp({ ...t, kind: 'satchel' }, null, this.lib);
        if (obj) {
          obj.position.set(t.x + t.w / 2, H(t.x + t.w / 2, t.y + t.h / 2), t.y + t.h / 2);
          obj.rotation.y = -(t.rot || 0) * Math.PI / 2;
          if (['ship', 'warship', 'boat', 'barge', 'uboat', 'rubberboat'].includes(t.kind)) obj.position.y = Math.max(obj.position.y, -0.35);
          // A bridge rests on its highest bank, never in the water it spans.
          if (t.kind === 'bridge') obj.position.y = Math.max(0, ...[[t.x, t.y], [t.x + t.w, t.y], [t.x, t.y + t.h], [t.x + t.w, t.y + t.h]].map(([x, y]) => H(x, y)));
          if (OCCLUDING_PROPS.includes(t.kind)) obj.userData.occluder = true;
        }
      }
      if (obj) {
        obj.userData.thing = t.id;
        this.scene.add(obj);
        this.thingViews.set(t.id, obj);
        this.syncThing(t);
      }
    }
    if(this.opts.detailed)this.facadeBatches=new FacadeBatches(this.scene,this.thingViews);
    clearFacadeCache();
    for (const t of this.built.things) if (t.type === 'cliff' || (t.interact && t.interact.kind === 'rope')) this.syncRope(t);
    this._pendingHazards = true;
    for (const d of this.built.decor) {
      const o = buildProp({ kind: d.kind, color: d.color, id: 'decor' + d.x + '_' + d.y }, null, this.lib);
      if (!o) continue;
      o.position.set(d.x, H(d.x, d.y), d.y); o.rotation.y = d.rot; o.scale.setScalar(d.scale);
      o.castShadow = false;
      (this.decorMeshes || (this.decorMeshes = [])).push(o);
      this.scene.add(o);
    }
  }

  // Decorative trees beyond the map edge, continuing whatever woods touch the border. None in
  // harbours, deserts and towns, and none off a stretch of border that is water, road or sand.
  // A mission can force it either way with `edgeForest: true | false`.
  edgeForest() {
    const w = this.world, g = w.grid, M = this.terrain.margin, def = w.def;
    if (def.edgeForest === false) return [];
    const bare = /harbou?r|desert|city|urban|docks|port|naval|paris|sewer|uboat|airfield/.test(def.biome || '') || ['urban', 'desert'].includes(def.style);
    if (bare && def.edgeForest !== true) return [];
    const trees = this.built.things.filter((t) => t.type === 'tree');
    if (!trees.length) return [];
    const near = (x, y, r) => trees.filter((t) => Math.abs(t.x - x) <= r && Math.abs(t.y - y) <= r);
    // Border ground that can carry trees: not water, road, sand, dock or concrete, nearby either.
    const NO_TREE_T = new Set([T.WATER, T.DEEP, T.ROAD, T.SAND, T.DOCK, T.CONCRETE, T.DUNE, T.ICE, T.COBBLE]);
    const fertile = (ex, ey) => {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = Math.max(0, Math.min(g.w - 1, Math.round(ex) + dx)), y = Math.max(0, Math.min(g.h - 1, Math.round(ey) + dy));
        if ((g.base[g.idx(x, y)] & (F.WATER | F.DEEP | F.ROAD)) || NO_TREE_T.has(g.ter(x, y))) return false;
      }
      return true;
    };
    const out = [];
    const r = seeded('edge' + w.def.id);
    let n = 0;
    const tryAt = (x, y, ex, ey) => {
      if (!fertile(ex, ey)) { r(); return; }
      const local = near(ex, ey, 4);
      const density = Math.min(0.55, local.length / 22 + 0.06);
      if (r() > density) return;
      const kinds = local.length ? local.map((t) => t.kind) : ['pine'];
      out.push({ id: 'edge' + n++, type: 'tree', kind: kinds[Math.floor(r() * kinds.length)], x: Math.floor(x), y: Math.floor(y), scale: 0.85 + r() * 0.5, rot: r() * 6.28 });
    };
    for (let d = 1; d < M - 2; d += 1.3) {
      for (let x = -M; x < g.w + M; x += 1.3) { tryAt(x + r(), -d - r(), Math.max(0, Math.min(g.w - 1, x)), 0); tryAt(x + r(), g.h + d + r(), Math.max(0, Math.min(g.w - 1, x)), g.h - 1); }
      for (let y = 0; y < g.h; y += 1.3) { tryAt(-d - r(), y + r(), 0, y); tryAt(g.w + d + r(), y + r(), g.w - 1, y); }
    }
    return out;
  }

  buildLamps() {
    const glowTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const gg = c.getContext('2d'); const grd = gg.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255,220,160,1)'); grd.addColorStop(0.3, 'rgba(255,190,110,0.35)'); grd.addColorStop(1, 'rgba(255,170,80,0)');
      gg.fillStyle = grd; gg.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    this.lampSprites = [];
    for (const l of this.built.lights) {
      const y = this.terrain.heightAt(l.x, l.y) + (l.kind === 'fire' ? 0.5 : 2.62);
      if (l.kind === 'fire') this.fx.addFire(l.x, l.y, 0.7, Infinity, true);
      // A soft halo, not a white disc: the flames themselves are particles.
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: l.color, transparent: true, opacity: l.kind === 'fire' ? 0.45 : 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.position.set(l.x, y, l.y); s.scale.setScalar(l.kind === 'fire' ? 2.4 : 2.0);
      s.userData.lamp = l;
      this.scene.add(s);
      this.lampSprites.push(s);
    }
    // Fires flicker with real light at any time of day; at night lamps get lights near the camera.
    // Always at least two (dark until needed), so a fire that starts later never changes the
    // light count and recompiles every shader mid-game.
    const n = this.lampsLit ? 6 : Math.max(2, Math.min(3, this.built.lights.filter((l) => l.kind === 'fire').length));
    for (let i = 0; i < n; i++) { const p = new THREE.PointLight(0xffc27a, 0, 10, 1.6); this.scene.add(p); this.lampLights.push(p); }
  }

  // World events that change what the static world looks like. The play screen forwards every
  // event here as it handles it (it clears the queue before the frame is drawn).
  worldEvent(ev) {
    const w = this.world;
    switch (ev.type) {
      case 'destroyed': case 'item': case 'cut': case 'gate': case 'rope': { const t = w.thingById.get(ev.thing); if (t) this.syncThing(t); break; }
      case 'despawn': this.removeView(ev.id); break;
      case 'thing-visual': { const t = w.thingById.get(ev.thing); if (t) this.syncThing(t); break; }
      case 'weather': this.applyWeather(ev.weather); break;
      case 'tod': this.applyTimeOfDay(ev.time, ev.dur); break;
      case 'flags': for (const t of this.built.things) if (t.type === 'fence' || t.type === 'gate' || t.type === 'barrier') this.syncThing(t); break;
      case 'hazard': this.hazardFx(w.s.hazards && w.s.hazards.find((h) => h.id === ev.id)); break;
      default: break;
    }
  }

  // Smoke, gas or burning oil over a hazard's circle, for as long as it lasts (drifting with it).
  hazardFx(h) {
    if (!h) return;
    const until = this.time + Math.max(0, h.dur - (this.world.s.t - h.t0));
    const n = Math.max(1, Math.round(h.r * h.r * 0.5));
    const list = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.7, d = i === 0 ? 0 : h.r * (0.35 + 0.45 * ((i * 0.618) % 1));
      const ox = Math.cos(a) * d, oz = Math.sin(a) * d;
      if (h.kind === 'fire') this.fx.addFire(h.x + ox, h.y + oz, 1.1, until);
      else this.fx.addSmokeColumn(h.x + ox, h.y + oz, 0.7 + h.r * 0.12, until, h.kind === 'gas' ? [0.62, 0.66, 0.38] : null);
      list.push({ em: this.fx.emitters[this.fx.emitters.length - 1], ox, oz });
    }
    if (h.drift) (this.drifting || (this.drifting = new Map())).set(h.id, list);
  }

  // The light changes mid-mission (api.timeOfDay: moonrise, dawn breaking): sun or moon, sky,
  // exposure, grade, lamps and beams follow. A painted backdrop keeps its painting.
  applyTimeOfDay(tod, dur = 0) {
    const def = this.world.def;
    const L = nightLift(LIGHTING[this.world.weather === 'overcast' ? 'overcast' : tod] || LIGHTING.day, { ...def, time: tod });
    // A transition (api.time(tod, seconds)) eases every light setting across in step with the sim.
    if (dur > 0 && this.L) { this.todAnim = { from: this.L, to: L, tod, t0: this.world.s.t, dur }; return; }
    this.todAnim = null;
    this.isNight = tod === 'night'; this.lampsLit = this.isNight || tod === 'dusk' || tod === 'dawn';
    this.applyLighting(L);
    this.terrain.setWaterNight(this.isNight);
    this.terrain.uniforms.uNight.value = this.isNight ? 1 : tod === 'dusk' ? 0.8 : this.lampsLit ? 0.6 : 0;
    for (const t of this.built.things) {
      const o = t.type === 'building' && this.thingViews.get(t.id);
      if (o && !this.painted) o.children.forEach((c) => { if (c.userData.windows) c.visible = this.isNight; });
    }
    this.scene.remove(this.tells.root);
    this.tells = new Tells(this.scene, this.world, this.terrain, this.thingViews, this.tellsOpts);
    this.applyCamera();
  }
  stepTimeOfDay() {
    const a = this.todAnim;
    if (!a) return;
    const k = Math.min(1, Math.max(0, (this.world.s.t - a.t0) / a.dur));
    if (k >= 1) { this.applyTimeOfDay(a.tod); return; }
    const mix = (x, y) => (typeof x === 'number' ? x + (y - x) * k : '#' + new THREE.Color(x).lerp(new THREE.Color(y), k).getHexString());
    const L = {};
    for (const key of Object.keys(a.to)) if (key !== 'grade' && key !== 'hdri') L[key] = mix(a.from[key] ?? a.to[key], a.to[key]);
    L.grade = { sat: mix(a.from.grade.sat, a.to.grade.sat), contrast: mix(a.from.grade.contrast, a.to.grade.contrast), vig: mix(a.from.grade.vig, a.to.grade.vig), tint: a.to.grade.tint.map((v, i) => mix(a.from.grade.tint[i], v)) };
    this.applyLighting(L, true);
  }
  // Sun or moon, sky, exposure, environment, fog and colour grade from a lighting preset.
  applyLighting(L, partial = false) {
    if (!partial) this.L = L;
    this.renderer.toneMappingExposure = L.exposure;
    if (this.backdropScene) this.backdropScene.background = new THREE.Color(L.bg); else this.scene.background = new THREE.Color(L.bg);
    this.hemi.color.set(L.hemiSky); this.hemi.groundColor.set(L.hemiGround); this.hemi.intensity = L.hemiI;
    this.sun.color.set(L.sun); this.sun.intensity = L.sunI;
    const el = L.elev * Math.PI / 180, az = L.az * Math.PI / 180;
    this.sunDir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    this.scene.environmentIntensity = L.env;
    if (this.scene.fog) this.scene.fog.color.set(L.fog);
    if (this.grade) { const u = this.grade.uniforms; u.uSat.value = L.grade.sat; u.uContrast.value = L.grade.contrast; u.uTint.value.set(...L.grade.tint); u.uVig.value = L.grade.vig; }
    if (this.bloom) { this.bloom.strength = this.isNight ? 0.32 : 0.28; this.bloom.threshold = this.isNight ? 0.92 : 0.88; }
  }

  // Weather changed mid-mission: particles, haze and wet ground follow.
  applyWeather(wx) {
    this.fx.changeWeather(wx);
    this.fogDensity = { fog: 0.82, smoke: 0.75, blizzard: 0.9, snow: 0.35, rain: 0.35, storm: 0.5 }[wx] || 0;
    if (this.terrain.uniforms) this.terrain.uniforms.uWet.value = wx === 'rain' || wx === 'storm' ? 1 : 0;
  }

  // A rope fixed on a cliff (or a wall, a hull, girders): hung at the interaction point, from the
  // high ground down to the low, or over the obstacle when both sides are level.
  syncRope(t) {
    const st = this.world.s.objs[t.id] || {};
    this.ropes = this.ropes || new Map();
    if (!st.rope || this.ropes.has(t.id) || !t.tiles || !t.tiles.length) return;
    const g = this.world.grid, H = (x, y) => this.terrain.heightAt(x, y);
    const at = t.interact && t.interact.at ? { x: t.interact.at[0] + 0.5, y: t.interact.at[1] + 0.5 } : (() => { const [x, y] = t.tiles[Math.floor(t.tiles.length / 2)]; return { x: x + 0.5, y: y + 0.5 }; })();
    const near = t.tiles.filter(([x, y]) => Math.hypot(x + 0.5 - at.x, y + 0.5 - at.y) < 2.6);
    if (!near.length) return;
    let hi = null, lo = null;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const x = Math.floor(at.x) + dx, y = Math.floor(at.y) + dy;
      if (!g.inside(x, y) || Math.hypot(dx, dy) > 3) continue;
      const h = g.height[g.idx(x, y)];
      if (!hi || h > hi.h) hi = { x: x + 0.5, y: y + 0.5, h };
      if (!lo || h < lo.h) lo = { x: x + 0.5, y: y + 0.5, h };
    }
    const pts = [];
    if (hi.h - lo.h >= 0.6) {
      const top = new THREE.Vector3(hi.x, H(hi.x, hi.y) + 0.15, hi.y), bot = new THREE.Vector3(lo.x, H(lo.x, lo.y) + 0.03, lo.y);
      const mid = top.clone().lerp(bot, 0.5); mid.y -= 0.25;
      pts.push(top, mid, bot);
    } else {
      const c = near.reduce((a, [x, y]) => ({ x: a.x + (x + 0.5) / near.length, y: a.y + (y + 0.5) / near.length }), { x: 0, y: 0 });
      const far = { x: 2 * c.x - at.x, y: 2 * c.y - at.y };
      const top = Math.max(H(c.x, c.y), H(at.x, at.y)) + 1.5;
      pts.push(new THREE.Vector3(at.x, H(at.x, at.y) + 0.03, at.y), new THREE.Vector3((at.x + c.x) / 2, top - 0.2, (at.y + c.y) / 2),
        new THREE.Vector3(c.x, top, c.y), new THREE.Vector3((far.x + c.x) / 2, top - 0.2, (far.y + c.y) / 2), new THREE.Vector3(far.x, H(far.x, far.y) + 0.03, far.y));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const rope = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.035, 6, false), new THREE.MeshStandardMaterial({ color: 0xb89a6a, roughness: 0.9 }));
    rope.castShadow = true;
    const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.5, 6), rope.material);
    stake.position.copy(pts[0]).add(new THREE.Vector3(0, 0.2, 0));
    const grp = new THREE.Group(); grp.add(rope, stake);
    this.scene.add(grp);
    this.ropes.set(t.id, grp);
  }

  // Things already destroyed when the map loads (a wreck placed with state.destroyed, a saved
  // game) are drawn charred but cold: no fresh fire or smoke, and no effects system needed yet.
  get fxSafe() {
    return this.fx || { addFire() {}, addSmokeColumn() {} };
  }

  syncThing(t) {
    if (t.type === 'cliff' || (t.interact && t.interact.kind === 'rope')) this.syncRope(t);
    const obj = this.thingViews.get(t.id);
    if (!obj) return;
    this.facadeBatches?.release(obj);
    const st = this.world.s.objs[t.id] || {};
    if (st.destroyed && !obj.userData.charred && (t.type === 'fence' || t.type === 'barrier' || t.type === 'gate')) {
      obj.userData.charred = true;
      obj.visible = false;
      const c = t.tiles[Math.floor(t.tiles.length / 2)] || [t.x, t.y];
      this.fxSafe.addSmokeColumn(c[0] + 0.5, c[1] + 0.5, 0.6, this.time + 60);
    }
    if (st.destroyed && !obj.userData.charred && t.kind === 'bridge') {
      // The span breaks and drops into the gap.
      obj.userData.charred = true;
      obj.traverse((c) => { if (c.isMesh) c.material = CHARRED_MAT; });
      obj.position.y -= 1.3; obj.rotation.x += 0.18; obj.rotation.z -= 0.08;
      this.fxSafe.addSmokeColumn(t.x + t.w / 2, t.y + t.h / 2, 1.2, this.time + 120);
    }
    if (st.destroyed && !obj.userData.charred) {
      obj.userData.charred = true;
      obj.traverse((c) => { if (c.isMesh) c.material = CHARRED_MAT; });
      obj.rotation.z += 0.08; obj.position.y -= 0.15;
      if (t.type !== 'building') this.fxSafe.addFire(t.x + t.w / 2, t.y + t.h / 2, Math.min(2.2, 0.6 + (t.w * t.h) / 8), this.time + 90);
      this.fxSafe.addSmokeColumn(t.x + t.w / 2, t.y + t.h / 2, 1, this.time + 240);
    }
    if (t.type === 'item') obj.visible = !st.taken;
    // Cut wire disappears (and comes back if a script closes the gap again).
    if (t.type === 'fence' && !st.destroyed) obj.visible = !st.cut;
    if (t.type === 'gate' && !st.destroyed) obj.rotation.y = -(t.rot || 0) * Math.PI / 2 + (st.open ? Math.PI / 2 : 0);
    // Script-driven pose (api.thingVisual), relative to the model as built.
    const base = obj.userData.base || (obj.userData.base = { y: obj.position.y, rx: obj.rotation.x, ry: obj.rotation.y, rz: obj.rotation.z, s: obj.scale.x });
    if (st.visual || obj.userData.hadVisual) {
      const v = st.visual || {};
      obj.userData.hadVisual = !!st.visual;
      obj.position.y = base.y + (v.y || 0);
      obj.rotation.set(base.rx + (v.rx || 0), (t.type === 'gate' ? obj.rotation.y : base.ry) + (v.ry || 0), base.rz + (v.rz || 0));
      const sc = v.scale ?? 1; if (Array.isArray(sc)) obj.scale.set(base.s * sc[0], base.s * sc[1], base.s * sc[2]); else obj.scale.setScalar(base.s * sc);
      obj.visible = !v.hidden;
    }
  }

  // ---------- entity views ----------
  // Rigged model when one exists for what the unit wears now, else the procedural figure.
  wantsSkinned(e) {
    if (this.noChars === undefined) this.noChars = new URLSearchParams(location.search).get('chars') === '0';
    return !this.noChars && hasCharacter(characterIdFor(e));
  }
  addView(e) {
    if (this.views.has(e.id)) return;
    const f = e.kind === 'vehicle' ? new VehicleView(e, this.lib) : this.wantsSkinned(e) ? new SkinnedFigure(e) : new Figure(e);
    // An enemy patrol boat: the crewman stands in his boat.
    if (e.kind === 'enemy' && e.boat) { const b = buildProp({ kind: e.boat, id: 'pb' + e.id }, VEH_GREY, this.lib); if (b) { b.position.y = -0.3; f.root.add(b); } }
    this.scene.add(f.root);
    this.views.set(e.id, f);
  }
  // A change of clothes (uniform, civilian dress) can move a unit between a rigged model and the
  // procedural figure.
  refreshView(e, v) {
    if (e.kind === 'vehicle' || (v instanceof SkinnedFigure) === this.wantsSkinned(e)) return v;
    this.scene.remove(v.root);
    this.views.delete(e.id);
    this.addView(e);
    return this.views.get(e.id);
  }
  removeView(id) {
    const f = this.views.get(id);
    if (f) { this.scene.remove(f.root); this.views.delete(id); }
    const lb = this.labels.get(id);
    if (lb) { lb.el.remove(); this.labels.delete(id); }
  }

  // Units on towers stand on the platform; deck crews stand on deck.
  standHeight(e) {
    const g = this.world.grid;
    const tx = Math.floor(e.x), ty = Math.floor(e.y);
    const oi = g.inside(tx, ty) ? g.owner[g.idx(tx, ty)] : -1;
    const t = oi >= 0 ? this.built.things[oi] : null;
    if (e.kind === 'enemy' && e.boat) return Math.max(this.terrain.heightAt(e.x, e.y), -0.2) + 0.3 + Math.sin(this.time * 1.6 + e.x) * 0.04;
    if (t && t.kind === 'tower') return this.terrain.heightAt(e.x, e.y) + 2.65;
    if (t && t.kind === 'bridge' && !(this.world.s.objs[t.id] || {}).destroyed) { const v = this.thingViews.get(t.id); if (v) return v.position.y + 0.33; }
    // Walkable decks (a barge or ship placed with flags that let units on board).
    if (t && !(t.flags & F.BLOCK) && DECK[t.kind] !== undefined) return Math.max(this.terrain.heightAt(t.x + t.w / 2, t.y + t.h / 2), -0.35) + DECK[t.kind];
    if (t && (t.kind === 'ship' || t.kind === 'uboat') && e.kind !== 'hero') return 1.45;
    if (t && t.kind === 'warship' && e.kind !== 'hero') return 1.7;
    if (e.deck !== undefined) return e.deck;
    if (e.kind === 'vehicle' && e.boat) return Math.max(this.terrain.heightAt(e.x, e.y), -0.2) + Math.sin(this.time * 1.6 + e.x) * 0.04;
    return this.terrain.heightAt(e.x, e.y);
  }

  // ---------- camera ----------
  resize() {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    this.width = w; this.height = h;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    if (this.composer) {
      const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.composer.setSize(w, h);
      if (this.gtao) this.gtao.setSize(s.x, s.y);
    }
    this.applyCamera();
  }
  applyCamera() {
    const aspect = this.width / Math.max(1, this.height);
    const hh = this.zoom / 2;
    const c = this.camera;
    c.left = -hh * aspect; c.right = hh * aspect; c.top = hh; c.bottom = -hh;
    c.updateProjectionMatrix();
    const dist = 90;
    const shake = this.fx ? this.fx.shake : 0;
    const sx = shake ? (Math.random() - 0.5) * shake * 0.4 : 0, sz = shake ? (Math.random() - 0.5) * shake * 0.4 : 0;
    // On painted maps the view is kept inside the painting without moving the follow target.
    const t = this.paintCover && !this.plateMode ? this.clampToPainting((this._viewT || (this._viewT = new THREE.Vector3())).copy(this.camTarget)) : this.camTarget;
    c.position.set(t.x + sx + Math.cos(this.pitch) * Math.sin(this.yaw) * dist, t.y + Math.sin(this.pitch) * dist, t.z + sz + Math.cos(this.pitch) * Math.cos(this.yaw) * dist);
    c.lookAt(t.x + sx, t.y, t.z + sz);
    // Shadow frustum follows the view.
    const s = this.sun;
    const span = this.opts.forest ? this.zoom * Math.max(1, aspect) * .55 + 4 : this.zoom * aspect * 0.72 + 7;
    s.shadow.camera.left = -span; s.shadow.camera.right = span; s.shadow.camera.top = span; s.shadow.camera.bottom = -span;
    s.shadow.camera.near = 1; s.shadow.camera.far = 170;
    s.shadow.camera.updateProjectionMatrix();
    s.position.copy(t).addScaledVector(this.sunDir, 75);
    s.target.position.copy(t);
    if (this.scene.fog) {
      const f = this.fogDensity;
      this.scene.fog.near = dist - 10 + (1 - f) * 120;
      this.scene.fog.far = dist + 30 + (1 - f) * 260;
    }
  }
  pan(dx, dy) {
    const perPx = this.zoom / this.height;
    const fx = Math.cos(this.yaw), fz = -Math.sin(this.yaw);
    const ux = -Math.sin(this.yaw), uz = -Math.cos(this.yaw);
    this.camTarget.x += (-dx * fx * perPx) + (-dy * ux * perPx / Math.sin(this.pitch));
    this.camTarget.z += (-dx * fz * perPx) + (-dy * uz * perPx / Math.sin(this.pitch));
    this.clampTarget();
    if (this.paintCover) this.clampToPainting(this.camTarget);
    this.follow = null;
  }
  panWorld(dx, dz) { this.camTarget.x += dx; this.camTarget.z += dz; this.clampTarget(); if (this.paintCover) this.clampToPainting(this.camTarget); this.follow = null; }
  clampTarget() {
    const g = this.world.grid;
    this.camTarget.x = Math.max(0, Math.min(g.w, this.camTarget.x));
    this.camTarget.z = Math.max(0, Math.min(g.h, this.camTarget.z));
  }
  // Painted maps cover a screen-aligned rectangle: keep the whole view inside it.
  clampToPainting(t) {
    const c = this.paintCover;
    const hw = this.zoom * this.width / Math.max(1, this.height) / 2, hh = this.zoom / 2;
    const a = t.dot(c.R), b = t.dot(c.U);
    const fit = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));
    const da = fit(a, c.minA + hw, c.maxA - hw) - a, db = fit(b, c.minB + hh, c.maxB - hh) - b;
    if (da || db) t.addScaledVector(c.R, da).addScaledVector(c.F, db / c.fu);
    return t;
  }
  zoomBy(f) { const [lo, hi] = this.zoomLimits || [8, 46]; this.zoomTarget = Math.max(lo, Math.min(hi, this.zoomTarget * f)); }
  rotate(dir) { if (this.painted) return; this.yawTarget += dir * Math.PI / 2; }
  focus(x, y, zoom) { this.camTarget.set(x, this.terrain.heightAt(x, y), y); if (zoom) this.zoomTarget = zoom; this.clampTarget(); }
  screenAxes() { return { rx: Math.cos(this.yaw), rz: -Math.sin(this.yaw), dx: -Math.sin(this.yaw), dz: -Math.cos(this.yaw) }; }

  // ---------- picking ----------
  toNdc(sx, sy) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((sx - rect.left) / rect.width) * 2 - 1, -((sy - rect.top) / rect.height) * 2 + 1);
    return this.ndc;
  }
  groundAt(sx, sy) {
    this.raycaster.setFromCamera(this.toNdc(sx, sy), this.camera);
    const hit = this.raycaster.intersectObject(this.terrain.mesh, false)[0];
    // Water taps refer to the visible surface, not the submerged bed behind it.
    // Otherwise the oblique ray can turn a deep-water tap into a bank/ford order.
    if (this.terrain.opts.preciseWater && this.terrain.water) {
      const p = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.12), p)) {
        const g = this.world.grid;
        if ((!hit || this.raycaster.ray.origin.distanceTo(p) <= hit.distance + 0.001) &&
            g.inside(Math.floor(p.x), Math.floor(p.z)) && g.has(Math.floor(p.x), Math.floor(p.z), F.WATER | F.DEEP)) return { x: p.x, y: p.z };
      }
    }
    if (hit) return { x: hit.point.x, y: hit.point.z };
    const p = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p);
    return { x: p.x, y: p.z };
  }
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (v.x + 1) / 2 * this.width, y: (1 - v.y) / 2 * this.height, behind: v.z > 1 };
  }
  pickUnit(sx, sy, radius = 30, filter = null) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const px = sx - rect.left, py = sy - rect.top;
    let best = null, bd = radius;
    for (const e of this.world.ents) {
      if (filter && !filter(e)) continue;
      if (e.hidden && (e.hidden.startsWith('b:') || e.hidden.startsWith('v:'))) continue;
      if (e.kind === 'enemy' && e.hidden === 'water') continue;
      const view = this.views.get(e.id);
      if (!view) continue;
      const h = view.root.position.y + (e.state === 'ok' && e.stance !== 'prone' ? 0.75 : 0.15);
      const p = this.project(view.root.position.x, h, view.root.position.z);
      const d = Math.hypot(p.x - px, p.y - py);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  pickThing(sx, sy) {
    const p = this.groundAt(sx, sy);
    const g = this.world.grid;
    const tx = Math.floor(p.x), ty = Math.floor(p.y);
    if (!g.inside(tx, ty)) return null;
    let best = null, bd = 1.3;
    for (const t of this.world.things) {
      if (!t.interact && !t.destructible && !t.limpet && !(t.type === 'fence' && t.cuttable)) continue;
      const st = this.world.s.objs[t.id] || {};
      if (t.type === 'item' && st.taken) continue;
      let d;
      if (t.type === 'fence') d = Math.min(...t.tiles.map(([x, y]) => Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y)));
      else {
        const dx = Math.max(t.x - p.x, 0, p.x - (t.x + t.w)), dy = Math.max(t.y - p.y, 0, p.y - (t.y + t.h));
        d = Math.hypot(dx, dy);
      }
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  // ---------- labels ----------
  label(id, text, kind, dur) {
    let lb = this.labels.get(id);
    if (!lb) { const el = document.createElement('div'); this.labelLayer.appendChild(el); lb = { el, until: 0 }; this.labels.set(id, lb); }
    lb.el.className = 'lbl lbl-' + kind;
    lb.el.textContent = text;
    lb.until = this.time + dur;
    lb.kind = kind;
  }

  // ---------- per-frame ----------
  render(dt, alpha, ui) {
    dt = Math.max(0, Math.min(0.25, dt || 0));      // never backwards, never a giant leap
    this.time += dt;
    this.frame++;
    const w = this.world;
    windUniforms.uTime.value = this.time;
    this.yaw += (this.yawTarget - this.yaw) * Math.min(1, dt * 8);
    this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, dt * 10);
    if (this.follow) {
      const e = w.ent(this.follow);
      if (e) { this.camTarget.x += (e.x - this.camTarget.x) * Math.min(1, dt * 4); this.camTarget.z += (e.y - this.camTarget.z) * Math.min(1, dt * 4); }
    }
    this.camTarget.y += (this.terrain.heightAt(this.camTarget.x, this.camTarget.z) - this.camTarget.y) * Math.min(1, dt * 3);
    this.stepTimeOfDay();
    this.applyCamera();
    if (this.forest) updateForest(this.forest, this.camera);

    // Rigged meshes deliberately disable their own bind-pose frustum culling. Cull the
    // whole actor against BOTH view and sun-shadow frusta instead, with a generous
    // animated envelope. Off-screen AI/animation still advances; shadows entering view
    // remain present, even for a caster outside the camera. No gameplay visibility change.
    if(this.unitCullEnabled){
      this.camera.updateMatrixWorld(true);
      this.unitFrustum.setFromProjectionMatrix(this.unitProjection.multiplyMatrices(this.camera.projectionMatrix,this.camera.matrixWorldInverse));
      this.sun.updateMatrixWorld(true);this.sun.target.updateMatrixWorld(true);this.sun.shadow.updateMatrices(this.sun);
    }
    this.unitDrawStats={total:w.ents.length,visible:0,culled:0};

    // Units
    for (const e of w.ents) {
      let v = this.views.get(e.id);
      if (!v) { this.addView(e); v = this.views.get(e.id); }
      if (e.kind === 'hero') v = this.refreshView(e, v);
      const p = e._prev;
      const x = p ? p.x + (e.x - p.x) * alpha : e.x, y = p ? p.y + (e.y - p.y) * alpha : e.y;
      let a = e.a;
      if (p) { let d = e.a - p.a; d = Math.atan2(Math.sin(d), Math.cos(d)); a = p.a + d * alpha; }
      e._rx = x; e._ry = y; e._ra = a;
      const speed = p ? Math.hypot(e.x - p.x, e.y - p.y) / (1 / 30) : 0;
      if (e.carriedBy) {
        const c = w.ent(e.carriedBy);
        const cv = c && this.views.get(c.id);
        if (cv) { v.root.position.copy(cv.root.position); v.root.rotation.y = cv.root.rotation.y; }
      } else {
        v.root.position.set(x, this.standHeight(e), y);
        v.root.rotation.y = -a + Math.PI / 2;
      }
      const hiddenInBuilding = e.hidden && (e.hidden.startsWith('b:') || e.hidden.startsWith('v:'));
      v.root.visible = !this.plateMode && !hiddenInBuilding && !(e.kind === 'enemy' && e.hidden === 'water');
      if(v.root.visible&&this.unitCullEnabled){
        this.unitBounds.center.copy(v.root.position);this.unitBounds.center.y+=.8;
        this.unitBounds.radius=e.kind==='vehicle'?6:2.4;
        if(!this.unitFrustum.intersectsSphere(this.unitBounds)&&!this.sun.shadow.getFrustum().intersectsSphere(this.unitBounds)){
          v.root.visible=false;this.unitDrawStats.culled++;
        }
      }
      if(v.root.visible)this.unitDrawStats.visible++;
      v.update(e, ui?.paused || ui?.overlayOpen ? 0 : dt, speed);
      const ghost = (e.kind === 'hero' && (e.hidden === 'bush' || (e.camo && e.stance === 'prone'))) || (e.kind === 'enemy' && e.hidden === 'bush');
      if (v.ghost !== ghost) {
        v.ghost = ghost;
        v.root.traverse((c) => {
          if (!c.isMesh || c.renderOrder === 10) return;
          if (!c.userData.orig) c.userData.orig = c.material;
          c.material = ghost ? GHOST : c.userData.orig;
        });
      }
    }
    // X-ray silhouettes for heroes hidden behind buildings.
    if (this.frame % 3 === 0) {
      for (const e of w.ents) {
        const v = this.views.get(e.id);
        if (!v || !v.xrayMeshes.length) continue;
        let occluded = false;
        if (v.root.visible && e.state !== 'dead') {
          const from = this.camera.position.clone();
          const to = v.root.position.clone(); to.y += 0.7;
          const dir = to.clone().sub(from); const dist = dir.length(); dir.normalize();
          this.raycaster.set(from, dir); this.raycaster.far = dist - 0.4;
          occluded = this.raycaster.intersectObjects(this.occluders, true).length > 0;
          this.raycaster.far = Infinity;
        }
        v.setXray(occluded);
      }
    }
    if (this._pendingHazards) {
      this._pendingHazards = false;
      for (const h of w.s.hazards || []) this.hazardFx(h);
      if (w.s.weather && w.s.weather !== w.def.weather) this.applyWeather(w.s.weather);
      if (w.s.tod && w.s.tod !== w.def.time) this.applyTimeOfDay(w.s.tod);
    }
    if (this.drifting) for (const [id, list] of this.drifting) {
      const h = (w.s.hazards || []).find((q) => q.id === id);
      if (!h) { this.drifting.delete(id); continue; }
      for (const o of list) { o.em.x = h.x + o.ox; o.em.z = h.y + o.oz; }
    }
    for (const ev of w.events) this.worldEvent(ev);

    // Overlays
    const sel = ui.selectedSet();
    this.overlays.updateRings(w.heroes(), sel, this.time);
    this.overlays.updateNoise(dt);
    this.overlays.animateMarkers(this.time);
    const coneList = [], sleepers = [];
    const now = this.time;
    this.reveals = this.reveals.filter((r) => r.until > now);
    for (const e of w.ents) {
      if (e.kind !== 'enemy' || e.state !== 'ok') continue;
      if (ui.showAllCones || this.shownCones.has(e.id) || this.hoverEnemy === e.id || e.ai.mode === 'alert' ||
          this.reveals.some((r) => Math.hypot(r.x - e.x, r.y - e.y) <= r.r)) (e.ai.asleep ? sleepers : coneList).push(e);
    }
    // With dozens of guards, draw the ones that matter: pinned, hovered and alert first, then those
    // on screen nearest the middle of the view. Cones wholly off screen are skipped.
    const cx = this.camTarget.x, cz = this.camTarget.z, reach = this.zoom * 1.2;
    const rank = (e) => (this.shownCones.has(e.id) || this.hoverEnemy === e.id || e.ai.mode === 'alert' ? 0 : 1e6) + Math.hypot(e.x - cx, e.y - cz);
    const picked = coneList.filter((e) => e.ai.mode === 'alert' || this.shownCones.has(e.id) || Math.hypot(e.x - cx, e.y - cz) < reach + e.ai.range)
      .sort((a, b) => rank(a) - rank(b)).slice(0, MAX_CONES);
    this.overlays.updateCones(picked, this.time);
    this.overlays.updateSleepers(sleepers.filter((e) => Math.hypot(e.x - cx, e.y - cz) < reach + 4));
    // Searchlight footprints join the cone overlay: all of them with every cone shown, else the
    // beams whose crew's cone is showing.
    this.tells.update(dt, this.time, this.camTarget);
    const shown = new Set(coneList.map((e) => e.tag).filter(Boolean));
    this.overlays.updateBeams(this.tells.current.filter((b) => b.on && (ui.showAllCones || (b.B.sl.crew && shown.has(b.B.sl.crew)))));
    const selHero = ui.primary();
    this.overlays.showPath(selHero && (selHero.order || selHero.path) ? selHero : null);

    // Lamps switched on or off by a script: their pools on the ground follow.
    if (this.frame % 15 === 0 && this.built.lights.some((l) => l.id)) {
      const sig = this.built.lights.map((l) => (l.id && (w.s.objs[l.id] || {}).lightOff ? 1 : 0)).join('');
      if (sig !== this._lampSig) {
        if (this._lampSig !== undefined) this.terrain.setLamps(this.built.lights.map((l) => ({ ...l, off: !!(l.id && (w.s.objs[l.id] || {}).lightOff) })));
        this._lampSig = sig;
      }
    }
    // Fire and lamp lights near the camera; wrecks and buildings set burning light up too.
    if (this.lampLights.length) {
      const dyn = this.fx.emitters.filter((e) => e.kind === 'fire' && e.until !== Infinity).map((e) => ({ x: e.x, y: e.z, kind: 'fire', color: 0xffa860 }));
      const lamps = this.built.lights.filter((l) => !(l.id && (w.s.objs[l.id] || {}).lightOff) && (this.lampsLit || l.kind === 'fire')).concat(dyn)
        .map((l) => ({ l, d: Math.hypot(l.x - this.camTarget.x, l.y - this.camTarget.z) })).sort((a, b) => a.d - b.d);
      this.lampLights.forEach((p, i) => {
        const o = lamps[i];
        if (!o) { p.intensity = 0; return; }
        p.position.set(o.l.x, this.terrain.heightAt(o.l.x, o.l.y) + (o.l.kind === 'fire' ? 0.8 : 2.4), o.l.y);
        p.color.set(o.l.color);
        p.intensity = o.l.kind === 'fire' ? 6 + Math.sin(this.time * 13 + i) * 1.5 + Math.sin(this.time * 7.3) * 1 : 4.5;
      });
      for (const s of this.lampSprites) { const l = s.userData.lamp; s.visible = !this.plateMode && (this.lampsLit || l.kind === 'fire') && !(l.id && (w.s.objs[l.id] || {}).lightOff); }
    }

    const scale = this.height * this.renderer.getPixelRatio() / this.zoom;
    this.fx.update(dt, this.time, this.camTarget, scale);
    if (this.terrain.waterUniforms) this.terrain.waterUniforms.uTime.value = this.time;

    // Labels
    for (const [id, lb] of this.labels) {
      const e = w.ent(id);
      if (!e || lb.until < this.time) { lb.el.remove(); this.labels.delete(id); continue; }
      const v = this.views.get(id);
      if (!v || !v.root.visible) { lb.el.style.display = 'none'; continue; }
      const p = this.project(v.root.position.x, v.root.position.y + 1.9, v.root.position.z);
      lb.el.style.display = '';
      lb.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
    }
    for (const e of w.ents) {
      if (e.kind !== 'enemy' || e.state !== 'ok') continue;
      const ai = e.ai;
      const susp = Math.max(0, ...Object.values(ai.susp));
      const lb = this.labels.get(e.id);
      if (ai.asleep) { if (!lb || lb.kind === 'z') this.label(e.id, 'z z', 'z', 0.25); continue; }
      if (ai.mode === 'alert') { if (!lb || lb.kind === 'q' || lb.kind === 'z') this.label(e.id, '!', 'bang', 0.25); else if (lb.kind === 'bang') lb.until = this.time + 0.25; }
      else if ((susp > 0.25 || ai.notice || ai.mode === 'investigate' || ai.mode === 'search' || ai.mode === 'checkBody') && (!lb || lb.kind === 'q')) {
        this.label(e.id, '?', 'q', 0.25);
      }
    }

    this.updateHoles();
    if (this.composer) this.composer.render(dt);
    else if (this.backdropScene) {
      const r = this.renderer;
      r.autoClear = false;
      r.clear();
      r.render(this.backdropScene, this.camera);
      r.clearDepth();
      r.render(this.scene, this.camera);
    } else this.renderer.render(this.scene, this.camera);
  }

  // ---------- painted maps ----------
  // The static world is a set of repainted tiles drawn as a camera-aligned backdrop. 3D geometry
  // stays as invisible depth stand-ins (so soldiers pass behind painted buildings), the ground
  // becomes a shadow catcher, and anything that changes during play stays live.
  applyPainted(p) {
    this.painted = p;
    this.composer = null;
    this.scene.fog = null;
    this.yaw = this.yawTarget = Math.PI / 4;
    this.terrain.mesh.material = new THREE.ShadowMaterial({ opacity: 0.32, depthWrite: true });
    this.terrain.mesh.renderOrder = -60;
    if (this.terrain.water) this.terrain.water.visible = false;
    this.scene.traverse((o) => { if (o.isInstancedMesh && !o.userData.keepPainted) o.visible = false; });
    for (const d of this.decorMeshes || []) d.visible = false;
    if (this.debris) this.debris.visible = false;
    for (const s of this.lampSprites || []) s.visible = false;
    const PROXY = new THREE.MeshBasicMaterial({ colorWrite: false });
    for (const t of this.built.things) {
      const o = this.thingViews.get(t.id);
      if (!o || GameRenderer.isDynamic(t)) continue;
      o.traverse((c) => { if (c.isMesh) { c.material = PROXY; c.castShadow = false; c.renderOrder = -50; } });
    }
    // Backdrop tiles, in raster order; each later tile crossfades over its earlier neighbours.
    this.applyCamera();
    this.camera.updateMatrixWorld(true);
    const feather = Math.max(0.05, (p.overlap || 0.2) * 0.85);
    const tiles = p.tiles.map((tile, k) => ({ tile, tex: p.textures[k] })).filter((x) => x.tex).sort((a, b) => a.tile.j - b.tile.j || a.tile.i - b.tile.i);
    this.backdrop = new THREE.Group();
    tiles.forEach(({ tile, tex }, n) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const geo = new THREE.PlaneGeometry(tile.cam.zoom * tile.cam.aspect, tile.cam.zoom);
      const mat = new THREE.ShaderMaterial({
        uniforms: { map: { value: tex }, fl: { value: tile.i > 0 ? feather : 0 }, ft: { value: tile.j > 0 ? feather : 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform sampler2D map; uniform float fl, ft; varying vec2 vUv;
          void main(){
            vec4 c = texture2D(map, vUv);
            float a = (fl > 0.0 ? smoothstep(0.0, fl, vUv.x) : 1.0) * (ft > 0.0 ? smoothstep(0.0, ft, 1.0 - vUv.y) : 1.0);
            gl_FragColor = vec4(c.rgb, a);
            #include <colorspace_fragment>
          }`,
        transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(tile.cam.x, tile.cam.y, tile.cam.z);
      m.quaternion.copy(this.camera.quaternion);
      m.renderOrder = -100 + n * 0.01;
      m.frustumCulled = false;
      m.userData.noAO = true;
      this.backdrop.add(m);
    });
    // The backdrop gets its own scene, drawn first; the live world is drawn over it.
    this.backdropScene = new THREE.Scene();
    this.backdropScene.background = this.scene.background;
    this.scene.background = null;
    this.backdropScene.add(this.backdrop);
    // The painted area in screen-plane coordinates (R right, U up); F moves the target along the ground.
    const R = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const U = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const F = new THREE.Vector3(U.x, 0, U.z).normalize();
    const inset = 0.4;
    const cover = { R, U, F, fu: F.dot(U), minA: Infinity, maxA: -Infinity, minB: Infinity, maxB: -Infinity };
    for (const { tile } of tiles) {
      const c = new THREE.Vector3(tile.cam.x, tile.cam.y, tile.cam.z), w = tile.cam.zoom * tile.cam.aspect / 2, h = tile.cam.zoom / 2;
      cover.minA = Math.min(cover.minA, c.dot(R) - w + inset); cover.maxA = Math.max(cover.maxA, c.dot(R) + w - inset);
      cover.minB = Math.min(cover.minB, c.dot(U) - h + inset); cover.maxB = Math.max(cover.maxB, c.dot(U) + h - inset);
    }
    if (tiles.length) this.paintCover = cover;
    this.zoomLimits = [Math.max(8, p.zoom * 0.6), p.zoom * 1.5];
  }

  // Things that change during play stay live 3D objects: they are left out of painted plates.
  static isDynamic(t) {
    return t.type === 'item' || t.type === 'target' || t.type === 'gate' || (t.type === 'fence' && t.cuttable) || t.dynamic || (t.light && t.id && t.state);
  }

  // Plate mode: only the static world is drawn, ready to be repainted.
  setPlateMode(on) {
    this.plateMode = on;
    this.overlays.root.visible = !on;
    if (this.tells) this.tells.root.visible = !on;
    this.labelLayer.style.display = on ? 'none' : '';
    for (const t of this.built.things) { const o = this.thingViews.get(t.id); if (o && GameRenderer.isDynamic(t)) o.visible = !on; }
    for (const s of this.lampSprites || []) s.visible = !on;
    this.fx.smoke.points.visible = this.fx.fire.points.visible = !on;
    if (this.fx.rain) this.fx.rain.visible = !on;
    if (this.fx.snow) this.fx.snow.points.visible = !on;
    if (this.gtao) this.gtao.enabled = true;
  }

  // Render one plate: camera focused on a ground point at a zoom; returns the exact camera target.
  renderPlate(x, z, zoom) {
    this.yaw = this.yawTarget = Math.PI / 4;
    this.camTarget.set(x, this.terrain.heightAt(x, z), z);
    this.zoom = this.zoomTarget = zoom;
    this.follow = null;
    this.applyCamera();
    for (let i = 0; i < 2; i++) { if (this.composer) this.composer.render(0.016); else this.renderer.render(this.scene, this.camera); }
    // Read the frame in the same task it was drawn, before the browser clears the buffer.
    const png = this.renderer.domElement.toDataURL('image/png');
    return { x: this.camTarget.x, y: this.camTarget.y, z: this.camTarget.z, zoom, aspect: this.width / this.height, png };
  }

  // Tile the whole map (plus a margin) in view space at a given zoom, with overlap.
  plateTiles(zoom, overlap = 0.2, margin = 4) {
    const g = this.world.grid;
    this.yaw = Math.PI / 4;
    this.camTarget.set(g.w / 2, 0, g.h / 2);
    this.zoom = zoom;
    this.applyCamera();
    this.camera.updateMatrixWorld(true);
    const inv = this.camera.matrixWorldInverse;
    const pts = [[-margin, -margin], [g.w + margin, -margin], [-margin, g.h + margin], [g.w + margin, g.h + margin]]
      .map(([x, z]) => new THREE.Vector3(x, 0, z).applyMatrix4(inv));
    const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
    const aspect = this.width / this.height, tw = zoom * aspect, th = zoom;
    const sx = tw * (1 - overlap), sy = th * (1 - overlap);
    const nx = Math.max(1, Math.ceil((maxX - minX - tw) / sx) + 1), ny = Math.max(1, Math.ceil((maxY - minY - th) / sy) + 1);
    const tiles = [];
    const camWorld = this.camera.matrixWorld;
    const fwd = new THREE.Vector3(0, 0, -1).transformDirection(camWorld);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const vx = minX + tw / 2 + i * sx, vy = maxY - th / 2 - j * sy;
      // View-space point back to world, then slide along the view ray to the ground.
      const p = new THREE.Vector3(vx, vy, -50).applyMatrix4(camWorld);
      const k = -p.y / fwd.y;
      tiles.push({ i, j, x: p.x + fwd.x * k, z: p.z + fwd.z * k });
    }
    return { tiles, nx, ny, zoom, aspect, overlap };
  }

  // Cut see-through holes in foliage in front of every visible soldier.
  updateHoles() {
    const holes = holeUniforms.uHoles.value;
    const buf = this.renderer.getDrawingBufferSize(this._dbs || (this._dbs = new THREE.Vector2()));
    const v = this._hv || (this._hv = new THREE.Vector3());
    const radius = ((this.opts.forest ? 1.05 : 2.1) / this.zoom) * buf.y;
    let n = 0;
    const sel = this.world.heroes();
    const list = [...sel, ...this.world.ents.filter((e) => e.kind !== 'hero' && e.state !== 'dead')];
    for (const e of list) {
      if (n >= MAX_HOLES) break;
      if (e.hidden && e.hidden.startsWith('b:')) continue;
      const view = this.views.get(e.id);
      if (!view || !view.root.visible) continue;
      v.set(view.root.position.x, view.root.position.y + 0.8, view.root.position.z).project(this.camera);
      if (v.x < -1.2 || v.x > 1.2 || v.y < -1.2 || v.y > 1.2) continue;
      holes[n++].set((v.x + 1) / 2 * buf.x, (v.y + 1) / 2 * buf.y, (v.z + 1) / 2, e.kind === 'hero' ? radius * 1.15 : radius);
    }
    holeUniforms.uHoleCount.value = n;
  }

  reveal(x, y, r, dur) { this.reveals.push({ x, y, r, until: this.time + dur }); }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.facadeBatches?.dispose();
    for(const v of this.views.values())v.dispose?.();
    if (this.forest) disposeForest(this.forest);
    if (this.understory) disposeForest(this.understory);
    this.terrain.dispose();
    if (this.composer) this.composer.dispose && this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelLayer.remove();
  }
}

const GHOST = new THREE.MeshStandardMaterial({ color: 0xb8c0c8, transparent: true, opacity: 0.45, roughness: 0.9, depthWrite: false });

function minHeight(terrain, t) {
  let m = Infinity;
  for (const [x, y] of [[t.x, t.y], [t.x + t.w, t.y], [t.x, t.y + t.h], [t.x + t.w, t.y + t.h]]) m = Math.min(m, terrain.heightAt(x, y));
  return m === Infinity ? 0 : m;
}

export { F, T };
