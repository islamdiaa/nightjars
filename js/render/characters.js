import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CrawlPose } from './crawl.js';

// Rigged, animated character models (generated with Tripo from original concept art).
// assets/characters/<id>/model.glb holds a rigged mesh. Every character shares the Mixamo skeleton,
// so one clip library drives them all: clips/anim_a.glb (idle walk run shoot slash) and
// clips/anim_b.glb (hurt fall climb jump turn). Units without a model keep the procedural Figure.

const CHARS = new Map();          // id -> { scene, clips: Map(name -> clip), height }
const ORDER_A = ['idle', 'walk', 'run', 'shoot', 'slash'];
const ORDER_B = ['hurt', 'fall', 'climb', 'jump', 'turn'];
const HEIGHT = 1.45;               // game units, head to toe

function clipName(clip, i, order) {
  const n = (clip.name || '').toLowerCase();
  for (const k of [...ORDER_A, ...ORDER_B]) if (n.includes(k)) return k;
  return order[i] || clip.name;
}

// assets/characters/index.json lists the models that exist, so missing ones are never requested.
let available = null;
let library = null;
async function loadClips(loader) {
  const clips = new Map();
  for (const [file, order] of [['anim_a', ORDER_A], ['anim_b', ORDER_B]]) {
    try {
      const g = await loader.loadAsync(`assets/characters/clips/${file}.glb`);
      g.animations.forEach((c, i) => clips.set(clipName(c, i, order), c));
    } catch (e) { /* a missing set only loses those moves */ }
  }
  return clips;
}

export async function loadCharacters(ids) {
  if (!available) {
    try { available = new Set(await (await fetch('assets/characters/index.json')).json()); } catch (e) { available = new Set(); }
  }
  const want = [...new Set(ids)].filter((id) => id && available.has(id) && !CHARS.has(id));
  if (!want.length) return;
  const loader = new GLTFLoader();
  if (!library) library = loadClips(loader);
  const clips = await library;
  await Promise.all(want.map(async (id) => {
    CHARS.set(id, null);
    try {
      const a = await loader.loadAsync(`assets/characters/${id}/model.glb`);
      const box = new THREE.Box3().setFromObject(a.scene);
      a.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
      CHARS.set(id, { scene: a.scene, clips, height: Math.max(0.1, box.max.y - box.min.y), minY: box.min.y });
    } catch (e) { CHARS.delete(id); }
  }));
}

// Which model a unit wears.
const ENEMY_MODEL = { wehrmacht: 'de', ss: 'de', luftwaffe: 'de', kriegsmarine: 'de_sailor', japanese: 'jp', italian: 'it', vichy: 'fr', soviet: 'su', neutral: 'police', dutch: 'police', civilian: 'civilian_man', allied: 'de' };
// The model for a uniform of a faction: officers for the German services (a disguised agent
// passes as one), each army's soldier otherwise; sailors and policemen keep their own.
function uniformModel(faction, etype) {
  const base = ENEMY_MODEL[faction] || 'de';
  if (base === 'de') return etype === 'sailor' ? 'de_sailor' : 'de_officer';
  if (['jp', 'it', 'fr', 'su'].includes(base)) return base + '_soldier';
  return base;
}
export function characterIdFor(e) {
  if (e.kind === 'hero') {
    if (e.disguised && e.hid !== 'rosa') return e.disguiseLook === 'plain' ? 'civilian_man' : uniformModel(e.disguiseFaction || 'wehrmacht', e.disguiseType);
    if (e.civilian && e.hid !== 'rosa') return e.hid + '_civilian';
    return e.hid;
  }
  if (e.kind === 'npc' && e.look === 'captive') return enemyModel(e.faction, e.etype);
  if (e.kind === 'npc') return { prisoner: 'prisoner', civilian: 'civilian_man', scientist: 'civilian_man', woman: 'civilian_woman', child: 'civilian_woman', wounded: 'prisoner', ally: 'prys', american: 'us_soldier', partisan: 'civilian_man', sailor: 'de_sailor' }[e.look] || 'civilian_man';
  if (e.kind !== 'enemy' || e.etype === 'dog') return null;
  if (e.look === 'plain') return 'civilian_man';
  if (e.look === 'american') return 'us_soldier';
  return enemyModel(e.faction, e.etype);
}
function enemyModel(faction, etype) {
  const base = ENEMY_MODEL[faction] || 'de';
  if (etype === 'officer' && base === 'de') return 'de_officer';
  if (base === 'de') return 'de_rifleman';
  if (['jp', 'it', 'fr', 'su'].includes(base)) return base + '_soldier';
  return base;
}
export function hasCharacter(id) { return !!(id && CHARS.get(id)); }
// Every model a mission might need: its units now, plus the uniforms a hero could put on.
export function characterIdsFor(world) {
  const ids = new Set(world.ents.map((e) => characterIdFor(e)));
  for (const e of world.ents) if (e.kind === 'enemy') ids.add(uniformModel(e.faction, e.etype));
  for (const e of world.ents) if (e.kind === 'hero') ids.add(e.hid + '_civilian');
  ids.add('de_officer'); ids.add('de_rifleman');
  ids.delete(null);
  return [...ids];
}

const XRAY = new THREE.MeshBasicMaterial({ color: 0x9fd3ff, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false });

export class SkinnedFigure {
  constructor(e) {
    this.root = new THREE.Group();
    this.xrayMeshes = [];
    this.build(e);
  }

  appearanceKey(e) { return characterIdFor(e); }

  build(e) {
    while (this.root.children.length) this.root.remove(this.root.children[0]);
    this.key = this.appearanceKey(e);
    this.ghost = null;
    const def = CHARS.get(this.key);
    this.pose = new THREE.Group();
    this.root.add(this.pose);
    this.model = SkeletonUtils.clone(def.scene);
    const s = HEIGHT / def.height;
    this.model.scale.setScalar(s);
    this.model.position.y = -def.minY * s;
    // The shared clips turn the hips to face +X; game figures face +Z.
    this.model.rotation.y = -Math.PI / 2;
    this.pose.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = new Map();
    for (const [name, clip] of def.clips) this.actions.set(name, this.mixer.clipAction(clip));
    this.current = null;
    this.crawl = new CrawlPose(this.model, this.root);
    this.xrayMeshes = [];
    if (e.kind === 'hero' || e.kind === 'npc') {
      this.model.traverse((o) => {
        if (!o.isSkinnedMesh) return;
        const x = new THREE.SkinnedMesh(o.geometry, XRAY);
        x.bind(o.skeleton, o.bindMatrix);
        x.renderOrder = 10; x.visible = false; x.frustumCulled = false;
        o.parent.add(x);
        this.xrayMeshes.push(x);
      });
    }
  }

  setXray(on) { for (const x of this.xrayMeshes) x.visible = on; }

  play(name, { once = false, speed = 1, fade = 0.2 } = {}) {
    const a = this.actions.get(name) || this.actions.get('idle');
    if (!a) return;
    a.timeScale = speed;
    if (this.current === a) return;
    a.reset();
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat);
    a.clampWhenFinished = once;
    a.enabled = true;
    a.play();
    if (this.current) this.current.crossFadeTo(a, fade, false);
    this.current = a;
  }

  update(e, dt, speed) {
    if (this.appearanceKey(e) !== this.key && hasCharacter(this.appearanceKey(e))) this.build(e);
    this.crawl.restore();
    const P = this.pose;
    P.rotation.set(0, 0, 0); P.position.set(0, 0, 0);
    if (e.carriedBy) {
      P.rotation.set(0, 0, Math.PI / 2); P.position.set(0.25, 1.25, -0.05);
      this.play('fall', { once: true, fade: 0 });
    } else if (e.pose === 'sleep' && speed < 0.05) {
      this.play('fall', { once: true, fade: 0.3 });                 // dozing: stretched out at his post
    } else if (e.state === 'dead' || e.state === 'ko' || e.state === 'down') {
      this.play(this.actions.has('fall') ? 'fall' : 'hurt', { once: true, fade: 0.15 });
    } else if (e.swimming) {
      P.position.y = -0.95;
      this.play('walk', { speed: 0.6 });
    } else if (e.stance === 'prone') {
      P.rotation.x = Math.PI / 2; P.position.y = 0.25; P.position.z = -0.8;
      this.play('idle', { speed: .35, fade: 0.12 });
    } else if (e.act && ['knife', 'kukri', 'bolo', 'punch', 'chloroform'].includes(e.act.ab)) {
      this.play('slash', { once: true, speed: 1.4, fade: 0.08 });
    } else if (e.act && ['pistol', 'welrod', 'rifle', 'silentrifle', 'bren'].includes(e.act.ab)) {
      this.play('shoot', { fade: 0.1 });
    } else if (e.kind === 'enemy' && e.ai && e.ai.mode === 'alert' && speed < 0.3) {
      this.play('shoot', { fade: 0.15 });
    } else if (speed > 3) {
      this.play('run', { speed: Math.min(1.4, speed / 4.4) });
    } else if (speed > 0.05) {
      this.play('walk', { speed: Math.min(1.5, Math.max(0.6, speed / 1.9)) });
    } else {
      this.play('idle');
    }
    this.mixer.update(dt);
    if (e.stance === 'prone' && !e.carriedBy && !e.swimming && !['dead','ko','down'].includes(e.state) && e.pose !== 'sleep') this.crawl.update(dt, speed);
  }
}
