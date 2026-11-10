import * as THREE from 'three';

const GLSL=`
attribute vec4 wheelPivot;
uniform float wheelDistance, wheelSteering;
vec3 njWheelRotate(vec3 v) {
  if(abs(wheelPivot.w)<0.001)return v;
  float a=wheelDistance/abs(wheelPivot.w),c=cos(a),s=sin(a);
  v=vec3(v.x,c*v.y-s*v.z,s*v.y+c*v.z);
  a=wheelPivot.w>0.0?wheelSteering:0.0;c=cos(a);s=sin(a);
  return vec3(c*v.x+s*v.z,v.y,-s*v.x+c*v.z);
}
`;
function patch(material,uniforms,source=material) {
  const compile=source.onBeforeCompile,key=source.customProgramCacheKey.bind(source);
  material.onBeforeCompile=(sh,r)=>{
    compile.call(source,sh,r);Object.assign(sh.uniforms,uniforms);
    sh.vertexShader=GLSL+sh.vertexShader
      .replace('#include <begin_vertex>','#include <begin_vertex>\n transformed=njWheelRotate(transformed-wheelPivot.xyz)+wheelPivot.xyz;')
      .replace('#include <beginnormal_vertex>','#include <beginnormal_vertex>\n objectNormal=njWheelRotate(objectNormal);\n #ifdef USE_TANGENT\n objectTangent=njWheelRotate(objectTangent);\n #endif');
  };
  material.customProgramCacheKey=()=>key()+'-rolling-wheels-v1';return material;
}

export class WheelMotion {
  constructor(mesh) {
    this.uniforms={wheelDistance:{value:0},wheelSteering:{value:0}};
    this.last=null;this.materials=[];this.mesh=mesh;
    const copy=source=>this.copySurface(source);
    mesh.material=Array.isArray(mesh.material)?mesh.material.map(copy):copy(mesh.material);
    mesh.customDepthMaterial=patch(new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking}),this.uniforms);
    mesh.customDistanceMaterial=patch(new THREE.MeshDistanceMaterial(),this.uniforms);
    this.materials.push(mesh.customDepthMaterial,mesh.customDistanceMaterial);
  }
  copySurface(source){
    const material=patch(source.clone(),this.uniforms,source);this.materials.push(material);return material;
  }
  wreck(source){
    // Keep the frozen wheel pose in both the colour and shadow passes after destruction.
    this.mesh.material=this.copySurface(source);
  }
  update(e,dt) {
    const p={x:e._rx??e.x,y:e._ry??e.y,a:e._ra??e.a};
    const previous=this.last;this.last=p;
    if(!previous||dt<=0||e.state!=='ok')return;
    const dx=p.x-previous.x,dy=p.y-previous.y,d=Math.hypot(dx,dy);
    // Loading a save or teleporting never winds the wheels through a huge distance.
    if(d>2)return;
    const a=Math.atan2(Math.sin(p.a-previous.a),Math.cos(p.a-previous.a));
    const signed=dx*Math.cos(p.a)+dy*Math.sin(p.a);
    this.uniforms.wheelDistance.value+=signed;
    const target=d>.005?THREE.MathUtils.clamp(Math.atan(-a*2.1/(Math.abs(signed)>.005?signed:d)),-.38,.38):0;
    this.uniforms.wheelSteering.value+=(target-this.uniforms.wheelSteering.value)*(1-Math.exp(-dt*12));
  }
  dispose(){this.materials.forEach(m=>m.dispose());this.materials=[];}
}
