import * as THREE from 'three';

// Instance identical facades in small spatial cells. Only matrices are duplicated;
// geometry stays shared, avoiding the large memory cost of world-space merged copies.
// Keep original meshes for raycasts and restore them on a scripted state/pose change.
export class FacadeBatches {
  constructor(scene, thingViews, cellSize=12) {
    this.root=new THREE.Group();this.root.name='Batched industrial masonry';
    this.records=[];this.batches=new Map();this.owners=new Map();this.enabled=true;this.cellSize=cellSize;
    scene.updateMatrixWorld(true);
    for(const owner of thingViews.values()) {
      if(owner.userData.charred||!owner.visible)continue;
      owner.traverse(group=>{
        if(!group.userData.importedFacade)return;
        for(const mesh of group.children) {
          if(!mesh.isMesh||!mesh.visible||Array.isArray(mesh.material)||mesh.material.transparent)continue;
          const p=owner.position,key=`${Math.floor(p.x/cellSize)}:${Math.floor(p.z/cellSize)}:${mesh.material.uuid}:${mesh.geometry.uuid}`;
          if(!this.batches.has(key))this.batches.set(key,{records:[],material:mesh.material,mesh:null});
          const batch=this.batches.get(key),rec={owner,source:mesh,matrix:mesh.matrixWorld.clone(),active:true,batch};
          batch.records.push(rec);this.records.push(rec);
          if(!this.owners.has(owner))this.owners.set(owner,[]);this.owners.get(owner).push(rec);
          mesh.visible=false;
        }
      });
    }
    for(const batch of this.batches.values()) {
      if(batch.records.length<2){for(const r of batch.records){r.active=false;r.source.visible=true;}}
      else this.rebuild(batch);
    }
    scene.add(this.root);
  }
  get stats(){
    let sharedGeometryBytes=0,unsharedGeometryBytes=0,instanceBytes=0;const seen=new Set();
    for(const r of this.records){
      const g=r.source.geometry;let bytes=g.index?.array.byteLength||0;
      for(const a of Object.values(g.attributes))bytes+=a.array.byteLength;
      unsharedGeometryBytes+=bytes;
      if(!seen.has(g)){seen.add(g);sharedGeometryBytes+=bytes;}
    }
    for(const mesh of this.root.children)instanceBytes+=mesh.instanceMatrix.array.byteLength;
    return {sources:this.records.filter(r=>r.active).length,batches:this.root.children.filter(m=>m.count>0).length,cellSize:this.cellSize,sharedGeometryBytes,unsharedGeometryBytes,instanceBytes};
  }
  rebuild(batch) {
    const records=batch.records.filter(r=>r.active);
    if(!batch.mesh){
      if(!records.length)return;
      const mesh=new THREE.InstancedMesh(records[0].source.geometry,batch.material,batch.records.length);
      mesh.castShadow=true;mesh.receiveShadow=true;mesh.name='Shared facade instances';
      mesh.userData.facadeBatch=true;batch.mesh=mesh;this.root.add(mesh);
    }
    const mesh=batch.mesh;mesh.count=records.length;mesh.visible=records.length>0;
    records.forEach((r,i)=>mesh.setMatrixAt(i,r.matrix));mesh.instanceMatrix.needsUpdate=true;
    if(records.length){mesh.computeBoundingBox();mesh.computeBoundingSphere();}
  }
  release(owner) {
    const records=this.owners.get(owner);if(!records)return;
    const dirty=new Set();
    for(const r of records)if(r.active){r.active=false;r.source.visible=true;dirty.add(r.batch);}
    for(const batch of dirty)this.rebuild(batch);
    this.owners.delete(owner);
  }
  setEnabled(enabled) {
    this.enabled=!!enabled;this.root.visible=this.enabled;
    for(const r of this.records)if(r.active)r.source.visible=!this.enabled;
  }
  dispose() {
    this.setEnabled(false);
    for(const b of this.batches.values())b.mesh?.dispose();
    this.root.removeFromParent();this.records=[];this.batches.clear();this.owners.clear();
  }
}
