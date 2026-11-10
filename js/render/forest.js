// Imported photo-textured conifers. Authored broadleaf species retain their own shapes.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { seeded } from './kit.js';
import { windUniforms, holeUniforms, MAX_HOLES } from './foliage.js';

let pending, templates, fernTemplates;
export async function prepareForest() {
  if (!pending) pending = Promise.all(['pines','fern'].map(name=>new GLTFLoader().loadAsync(`assets/models/forest/${name}.glb`))).then(([gltf,ferns]) => {
    const trees = gltf.scene.children.filter(o => o.name.startsWith('pine_'));
    if (!trees.length) throw Error('The imported forest has no tree models.');
    fernTemplates = ferns.scene.children;
    return trees;
  }).catch(e => { pending = null; throw e; });
  templates = await pending;
}

function canopyMaterial(source, snowy = false) {
  const m = source.clone();
  m.side = THREE.DoubleSide;
  m.transparent = false;
  m.alphaTest = .45;
  // Leaf cards need canopy-volume lighting; tangent-space normals from the
  // original individual needles are not valid on this mobile representation.
  m.normalMap = null;
  m.roughness = 1;
  m.roughnessMap = null;
  m.envMapIntensity = .12;
  if ('specularIntensity' in m) m.specularIntensity = 0;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, windUniforms, holeUniforms);
    sh.vertexShader = 'uniform float uTime; uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec3 origin = instanceMatrix[3].xyz;
      float weight = smoothstep(1.5, 8.0, position.y);
      transformed.x += sin(uTime * .85 + origin.x * .4 + origin.z * .3) * .035 * weight * uWind;
      transformed.z += sin(uTime * 1.1 + origin.z * .6) * .02 * weight * uWind;`);
    sh.fragmentShader = `uniform vec4 uHoles[${MAX_HOLES}]; uniform int uHoleCount;\n` + sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      for (int i = 0; i < ${MAX_HOLES}; i++) {
        if (i >= uHoleCount) break;
        vec4 h = uHoles[i];
        float d = length(gl_FragCoord.xy - h.xy) / h.w;
        if (d < 1.0 && gl_FragCoord.z < h.z) {
          float noise = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898,78.233))) * 43758.5453);
          if (noise > smoothstep(.15, 1.0, d)) discard;
        }
      }`).replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * .16;');
    if(snowy) sh.fragmentShader=sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.67,.73,.76),.58);');
    // Sun-bleached photo cards read khaki from above: pull them to a deep conifer green.
    else sh.fragmentShader=sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb=pow(diffuseColor.rgb,vec3(1.25))*vec3(.6,.86,.52);');
  };
  m.customProgramCacheKey = () => 'nightjars-imported-pine-v3'+snowy;
  return m;
}

export function buildForest(things, heightAt, snowy = false) {
  if (!templates) throw Error('Forest must be loaded before building.');
  const root = new THREE.Group(); root.name = 'Photo-textured forest';
  root.userData.source = 'https://polyhaven.com/a/pine_tree_01';
  root.userData.treeCount = things.length;
  root.userData.batches = [];
  const groups = new Map();
  for (const t of things) {
    const random = seeded(t.id + ':forest');
    const variant = Math.floor(random() * templates.length);
    const key = variant;
    if (!groups.has(key)) groups.set(key, { variant, list: [] });
    groups.get(key).list.push(t);
  }
  const materials = new Map(), geometries = new Map(), matrix = new THREE.Matrix4(), up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), scale = new THREE.Vector3();
  for (const { variant, list } of groups.values()) {
    const tpl = templates[variant]; tpl.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(tpl);
    const batch = { meshes: [], records: [] };
    root.userData.batches.push(batch);
    tpl.traverse(part => {
      if (!part.isMesh) return;
      const isCanopy = /twig|needle|foliage/i.test(part.material.name);
      if (!materials.has(part.material.uuid)) materials.set(part.material.uuid, isCanopy ? canopyMaterial(part.material,snowy) : part.material.clone());
      if (!geometries.has(part.uuid)) {
        const g = part.geometry.clone();
        // Exported variants share a grounded origin, without catalogue offsets.
        g.applyMatrix4(new THREE.Matrix4().copy(tpl.matrixWorld).invert().multiply(part.matrixWorld));
        if (isCanopy) {
          // The source atlas has opaque padding around each irregular twig island.
          // Mobile rectangular cards must stay INSIDE its black cutout region; the old
          // crop included neighbouring atlas padding, making solid rectangular fringes.
          // glTF UVs are top-origin here. Geometry, tree positions and collision stay put.
          const uv = g.attributes.uv;
          for (let i=0;i<uv.count;i++) uv.setXY(i,
            .045 + THREE.MathUtils.clamp((uv.getX(i)-.005)/.23,0,1)*.15,
            .035 + THREE.MathUtils.clamp((uv.getY(i)-.005)/.445,0,1)*.30);
          g.computeBoundingBox();
          const centre = g.boundingBox.getCenter(new THREE.Vector3()), normal = new THREE.Vector3();
          const positions = g.attributes.position, normals = g.attributes.normal;
          for (let i=0; i<positions.count; i++) {
            normal.fromBufferAttribute(positions,i).sub(centre).normalize();
            normal.y += 1.2; normal.normalize();
            normals.setXYZ(i,normal.x,normal.y,normal.z);
          }
        }
        geometries.set(part.uuid, g);
      }
      const geo = geometries.get(part.uuid);
      const mesh = new THREE.InstancedMesh(geo, materials.get(part.material.uuid), list.length);
      mesh.name = `${tpl.name}/${isCanopy ? 'canopy' : 'wood'}`;
      mesh.userData.forest = true; mesh.userData.canopy = isCanopy;
      mesh.userData.things = list.map(t => t.id);
      list.forEach((t, i) => {
        const rand = seeded(t.id + ':size');
        const s = .68 * (t.scale || 1) * (.88 + rand() * .24);
        p.set(t.x + .5, heightAt(t.x + .5, t.y + .5) - .02, t.y + .5);
        q.setFromAxisAngle(up, t.rot ?? rand() * Math.PI * 2);
        scale.set(s * .72, s * (.94 + rand() * .12), s * .72);
        mesh.setMatrixAt(i, matrix.compose(p, q, scale));
        const tone = .86 + rand() * .14;
        const color = new THREE.Color().setRGB(tone, tone, tone);
        mesh.setColorAt(i, color);
        if (!batch.records[i]) batch.records[i] = { id:t.id, matrix:matrix.clone(), color, box:bounds.clone().applyMatrix4(matrix) };
      });
      mesh.castShadow = true; mesh.receiveShadow = !isCanopy;
      mesh.computeBoundingBox(); mesh.computeBoundingSphere();
      // Per-instance bounds below avoid drawing whole blocks of off-screen trees.
      mesh.frustumCulled = false;
      root.add(mesh);
      batch.meshes.push(mesh);
    });
  }
  return root;
}

export function buildUnderstory(things, heightAt) {
  const root = new THREE.Group(); root.name='Photographic fern undergrowth';
  const batches=new Map(), matrix=new THREE.Matrix4(), p=new THREE.Vector3(), q=new THREE.Quaternion(), scale=new THREE.Vector3();
  const up=new THREE.Vector3(0,1,0), geometries=new Map(), materials=new Map();
  for (const t of things) {
    const r=seeded(t.id+':fern'), variant=Math.floor(r()*fernTemplates.length);
    const key=`${Math.floor(t.x/8)},${Math.floor(t.y/8)},${variant}`;
    if(!batches.has(key))batches.set(key,{variant,list:[]});
    batches.get(key).list.push(t);
  }
  for(const {variant,list} of batches.values()) {
    const part=fernTemplates[variant];
    if(!geometries.has(variant)) {
      const geo=part.geometry.clone();geo.computeBoundingBox();
      const c=geo.boundingBox.getCenter(new THREE.Vector3());
      geo.translate(-c.x,-geo.boundingBox.min.y,-c.z);
      geometries.set(variant,geo);
    }
    if(!materials.has(part.material.uuid)) {
      const material=part.material.clone();material.roughness=1;material.roughnessMap=null;material.envMapIntensity=.3;
      material.onBeforeCompile=sh=>{
        sh.uniforms.uTime=windUniforms.uTime;
        sh.vertexShader='uniform float uTime;\n'+sh.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
          transformed.x += sin(uTime*1.4 + instanceMatrix[3].x)*.035*position.y;`);
      };
      material.customProgramCacheKey=()=> 'forest-ferns-v1';
      materials.set(part.material.uuid,material);
    }
    const mesh=new THREE.InstancedMesh(geometries.get(variant),materials.get(part.material.uuid),list.length);
    mesh.name='Imported ferns';mesh.userData.importedFern=true;
    list.forEach((t,i)=>{
      const r=seeded(t.id+':fern-size'),size=1.5*(.85+r()*.3)*(t.scale||1);
      p.set(t.x+.5,heightAt(t.x+.5,t.y+.5)-.015,t.y+.5);
      q.setFromAxisAngle(up,r()*6.283);scale.set(size,size,size);
      mesh.setMatrixAt(i,matrix.compose(p,q,scale));
    });
    mesh.receiveShadow=true;mesh.castShadow=false;
    mesh.computeBoundingSphere();root.add(mesh);
  }
  root.userData.plants=things.length;
  return root;
}

const frustum = new THREE.Frustum(), projection = new THREE.Matrix4();
export function updateForest(root, camera) {
  const signature = camera ? [...camera.position.toArray(),...camera.quaternion.toArray(),camera.left,camera.right,camera.top].join(',') : 'all';
  if (root.userData.view === signature) return;
  root.userData.view = signature;
  if (camera) {
    camera.updateMatrixWorld(true);
    projection.copy(camera.projectionMatrix);
    // Include a narrow apron for shadows cast into the frame.
    projection.elements[0] *= (camera.right-camera.left)/(camera.right-camera.left+6);
    projection.elements[5] *= (camera.top-camera.bottom)/(camera.top-camera.bottom+6);
    frustum.setFromProjectionMatrix(projection.multiply(camera.matrixWorldInverse));
  }
  let count = 0;
  for (const batch of root.userData.batches) {
    const records = camera ? batch.records.filter(t=>frustum.intersectsBox(t.box)) : batch.records;
    count += records.length;
    for (const mesh of batch.meshes) {
      mesh.count = records.length;
      mesh.userData.things = records.map(t=>t.id);
      records.forEach((t,i)=>{mesh.setMatrixAt(i,t.matrix);mesh.setColorAt(i,t.color);});
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    }
  }
  root.userData.visibleTrees = count;
}

export function disposeForest(root) {
  const geometries=new Set(), materials=new Set();
  for (const mesh of root.children) { geometries.add(mesh.geometry); materials.add(mesh.material); mesh.dispose(); }
  geometries.forEach(g=>g.dispose()); materials.forEach(m=>m.dispose());
  root.userData.batches=[];
}
