import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Artist-authored CC0 masonry modules, fitted to the original tactical footprint.
// The building's doors, collision, height and roof stay authored by its mission.
const INDUSTRIAL = new Set(['warehouse','factory','station']);
let pending, modules;
const facadeCache=new Map();
export function clearFacadeCache(){facadeCache.clear();}
export function usesFactory(t) { return INDUSTRIAL.has(t.kind); }
export async function prepareArchitecture(things) {
 clearFacadeCache();
 if(!things.some(usesFactory))return;
 if(!pending)pending=new GLTFLoader().loadAsync('assets/models/architecture/factory.glb?v=1').then(g=>{
  modules=new Map(g.scene.children.map(n=>[n.name,n]));
  g.scene.traverse(o=>{if(o.isMesh){o.material.envMapIntensity=.65;for(const key of ['map','normalMap','roughnessMap','metalnessMap','aoMap'])if(o.material[key])o.material[key].anisotropy=4;}});
 }).catch(e=>{pending=null;console.warn('Architecture asset unavailable; using original buildings',e);});
 return pending;
}

export function factoryFacade(t, floors, height) {
 if(!modules||!usesFactory(t))return null;
 const batches=new Map(), w=t.w,d=t.h, floorH=height/floors;
 const side=t.side||'s';
 const worldDoor=(t.door[(side==='n'||side==='s')?0:1]+.5)-((side==='n'||side==='s')?t.x+w/2:t.y+d/2);
 // Identical layouts share geometry, while every building keeps independent visibility,
 // transforms and material assignments. Cache only while one scene is being constructed.
 const key=JSON.stringify([w,d,floors,height,side,worldDoor]);
 if(facadeCache.has(key))return facadeCache.get(key).clone(true);
 const add=(name,x,y,z,sx,sy,sz,angle)=>{
  const source=modules.get(name);if(!source)return;
  const transform=new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),angle),new THREE.Vector3(sx,sy,sz));
  source.updateMatrixWorld(true);
  source.traverse(o=>{if(!o.isMesh)return;
   const geo=o.geometry.clone().applyMatrix4(o.matrixWorld).applyMatrix4(transform);
   const material=o.material;
   if(!batches.has(material))batches.set(material,[]);
   batches.get(material).push(geo);
  });
 };
 const faces=[{side:'s',len:w,x:0,z:d/2,a:0,door:worldDoor},
  {side:'n',len:w,x:0,z:-d/2,a:Math.PI,door:-worldDoor},
  {side:'e',len:d,x:w/2,z:0,a:Math.PI/2,door:-worldDoor},
  {side:'w',len:d,x:-w/2,z:0,a:-Math.PI/2,door:worldDoor}];
 for(const f of faces){
  const n=Math.max(1,Math.round(f.len/2.4)),bay=f.len/n;
  const at=(p)=>[f.x+Math.cos(f.a)*p,f.z-Math.sin(f.a)*p];
  for(let row=0;row<floors;row++)for(let i=0;i<n;i++){
   const p=-f.len/2+(i+.5)*bay,[x,z]=at(p);
   // Never put a decorative window across the actual entrance.
   const entry=row===0&&f.side===side&&Math.abs(p-f.door)<bay/2+.5;
   add(entry?'blank':row===floors-1&&floors>1?'tall':'window',x,row*floorH,z,bay/3,floorH/3,.75,f.a);
  }
  for(let row=1;row<=floors;row++)add('cornice',f.x,row*floorH-.04,f.z,f.len/3,.7,.75,f.a);
  add('plinth',f.x,.05,f.z,f.len/3,.5,.65,f.a);
  if(f.side===side){const [x,z]=at(f.door);add('door',x+Math.sin(f.a)*.1,0,z+Math.cos(f.a)*.1,.8,floorH/3,.4,f.a);}
 }
 const group=new THREE.Group();group.name='imported-industrial-facade';
 for(const [material,geos] of batches){
  // One draw per material per building, not one per window/module.
  const geometry=mergeGeometries(geos,false);geos.forEach(g=>g.dispose());
  const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
 }
 group.userData.importedFacade=true;
 facadeCache.set(key,group);
 return group.clone(true);
}

// Real window reveals for the existing regional houses: cut the wall surfaces,
// don't paste glass over an unbroken cube. Geometry remains inside its footprint.
export function recessedWalls(k,w,d,base,height,mat,tint) {
 const openings=k.windowOpenings||[];
 for(const [axis,sign,len,offset,angle] of [['x',1,w,d/2,0],['x',-1,w,-d/2,Math.PI],['z',1,d,w/2,Math.PI/2],['z',-1,d,-w/2,-Math.PI/2]]){
  const shape=new THREE.Shape();shape.moveTo(-len/2,base);shape.lineTo(len/2,base);shape.lineTo(len/2,height);shape.lineTo(-len/2,height);shape.closePath();
  for(const o of openings){
   if(o.axis!==axis||o.sign!==sign||Math.abs(o.off-offset)>.025)continue;
   const along=o.along*(axis==='x'?sign:-sign);
   const x0=Math.max(-len/2+.01,along-o.w/2),x1=Math.min(len/2-.01,along+o.w/2);
   const y0=Math.max(base+.005,o.y-o.h/2),y1=Math.min(height-.005,o.y+o.h/2);
   if(x1<=x0||y1<=y0)continue;
   const hole=new THREE.Path();hole.moveTo(x0,y0);hole.lineTo(x0,y1);hole.lineTo(x1,y1);hole.lineTo(x1,y0);hole.closePath();shape.holes.push(hole);
  }
  const geo=new THREE.ExtrudeGeometry(shape,{depth:.2,bevelEnabled:false,steps:1});geo.translate(0,0,-.2);geo.rotateY(angle);geo.translate(axis==='z'?offset:0,0,axis==='x'?offset:0);
  k.add(geo,'#fff',0,0,0,{mat,tint,shade:.22});
 }
 // Dark interior behind the inset glazing; no invisible view through the whole house.
 k.box(Math.max(.1,w-.5),height-base,Math.max(.1,d-.5),0,(height+base)/2,0,'#272923');
}
