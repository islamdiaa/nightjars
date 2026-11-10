import * as THREE from 'three';

// Original period-inspired marine models with existing photographic PBR surfaces.
// These are not scans or exact reconstructions of the named historical ships.
const metal=tint=>({mat:'metal',tint,shade:.16});
const timber={mat:'planks',tint:'#a39479',shade:.1};
const dark=metal('#393e3e');
function rod(k,a,b,r,o=dark){
 const from=new THREE.Vector3(...a),to=new THREE.Vector3(...b),d=to.clone().sub(from);
 const m=new THREE.Matrix4().compose(from.add(to).multiplyScalar(.5),new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.clone().normalize()),new THREE.Vector3(1,1,1));
 k.add(new THREE.CylinderGeometry(r,r,d.length(),8),'#fff',0,0,0,{...o,post:m});
}
function cleat(k,x,y,z,size=.15){
 k.cyl(size*.4,size*.5,size*.8,x,y+size*.4,z,'#fff',dark);
 rod(k,[x-size,y+size*.8,z],[x+size,y+size*.8,z],size*.2);
}
function hull(k,L,B,top,bottom,color,tip=2){
 const width=z=>B/2*Math.min(1,Math.max(.003,(L/2-z)/tip));
 const N=28,R=18,p=[],ix=[];
 for(let i=0;i<=N;i++){
  const z=-L/2+L*i/N,b=width(z);
  for(let j=0;j<=R;j++){
   const a=j/R*Math.PI;
   p.push(Math.cos(a)*b,bottom+(top-bottom)*(1-Math.pow(Math.sin(a),.5)),z);
  }
 }
 for(let i=0;i<N;i++)for(let j=0;j<R;j++){
  const a=i*(R+1)+j,b=a+R+1;ix.push(a,b,a+1,a+1,b,b+1);
 }
 // Flat stern transom, framed by the curved bilges; no open underside at the quay.
 const center=p.length/3;p.push(0,top,-L/2);
 for(let j=0;j<R;j++)ix.push(center,j,j+1);
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();
 k.add(g,'#fff',0,0,0,metal(color));
 // Deck perimeter is the same authored wedge as before, including its original bow.
 const outline=[[-B/2,-L/2],[B/2,-L/2],[B/2,L/2-tip],[0,L/2],[-B/2,L/2-tip]];
 k.extrude(outline,.06,top-.035,'#fff',timber);
 // Thin rubbing strakes follow the curved hull instead of floating on a rectangular box.
 for(const level of [.38,.78]){
  const y=bottom+(top-bottom)*level,side=Math.sqrt(1-Math.pow(1-level,4));
  for(const s of [-1,1])for(let i=0;i<N;i++){
   const z0=-L/2+L*i/N,z1=-L/2+L*(i+1)/N;
   rod(k,[s*width(z0)*side,y,z0],[s*width(z1)*side,y,z1],.018,metal(level<.5?'#4e4540':'#686a64'));
  }
 }
 return width;
}
function hatch(k,x,y,z,w,l){
 k.box(w,.18,l,x,y,z,'#fff',dark);
 k.box(w-.14,.07,l-.14,x,y+.12,z,'#fff',{mat:'canvas',tint:'#7b7b68',shade:.24});
 for(const sx of [-1,1])for(const sz of [-1,1])cleat(k,x+sx*(w/2-.12),y+.15,z+sz*(l/2-.13),.055);
 for(let zz=z-l/2+.22;zz<z+l/2;zz+=.42)k.box(w-.06,.025,.028,x,y+.17,zz,'#fff',metal('#555a51'));
}
function glazing(k,w,y,z){
 const count=Math.max(2,Math.floor(w/.52)),pane=w/count;
 for(let i=0;i<count;i++)k.box(pane-.07,.43,.035,-w/2+(i+.5)*pane,y,z,'#fff',{mat:'vehicle_glass',shade:0});
 rod(k,[-w/2,y-.25,z+.025],[w/2,y-.25,z+.025],.025,metal('#c0c0af'));
}
export const navalShip=t=>/HMS|destroyer|torpedo boat/i.test(t.label||'');

export function coastalShip(k,t){
 const side=(t.rot||0)%2===1,L=(side?t.w:t.h)||22,B=(side?t.h:t.w)||6,c=t.color||'#858e91';
 const naval=navalShip(t),tip=4,deck=1.4;
 const width=hull(k,L,B,deck,-1.2,c,tip);
 // Low gunwales read as edges, not new impassable railings across authored routes.
 for(const s of [-1,1])for(let i=0;i<24;i++){
  const a=-L/2+L*i/24,b=-L/2+L*(i+1)/24;
  rod(k,[s*width(a)*.99,deck+.12,a],[s*width(b)*.99,deck+.12,b],.035,metal(c));
 }
 const z=-L*.12;
 k.box(B*.7,2.2,4.5,0,2.5,z,'#fff',metal('#a9aba3'));
 k.box(B*.55,1.2,3.2,0,4.2,z,'#fff',metal('#b8b9ae'));
 k.box(B*.73,.12,4.65,0,3.64,z,'#fff',metal('#656d6d'));
 k.box(B*.59,.12,3.35,0,4.84,z,'#fff',metal('#656d6d'));
 glazing(k,B*.48,4.35,z+1.62);glazing(k,B*.48,4.35,z-1.62);
 for(const s of [-1,1]){
  for(let zz=z-1.1;zz<z+1.4;zz+=.65)k.box(.035,.43,.47,s*(B*.275+.02),4.35,zz,'#fff',{mat:'vehicle_glass',shade:0});
  for(let zz=z-1.8;zz<z+2;zz+=.78){
   k.cyl(.13,.13,.03,s*(B*.35+.02),2.65,zz,'#fff',{...dark,rz:Math.PI/2,segs:16});
   k.torus(.145,.022,s*(B*.35+.04),2.65,zz,'#fff',{...metal('#8a8d84'),ry:Math.PI/2,segs:16});
  }
  // Handrails belong to the inaccessible bridge roof, not the traversable main deck.
  for(let zz=z-1.5;zz<=z+1.5;zz+=.6)rod(k,[s*B*.28,4.9,zz],[s*B*.28,5.25,zz],.018);
  rod(k,[s*B*.28,5.25,z-1.5],[s*B*.28,5.25,z+1.5],.018);
 }
 // Rolled funnel cap, soot-black mouth and support bands.
 const funnel=-L*.25,fr=Math.min(.62,B*.14);
 k.cyl(fr,fr*1.12,2.6,0,5.2,funnel,'#fff',metal(naval?'#696e70':'#66594c'));
 k.cyl(fr*1.07,fr*1.07,.25,0,6.38,funnel,'#fff',dark);
 k.cyl(fr*.83,fr*.83,.015,0,6.51,funnel,'#111615',{mat:'plain'});
 for(const y of [4.25,5.6])k.torus(fr*1.06,.025,0,y,funnel,'#fff',{...dark,rx:Math.PI/2,segs:24});
 for(const [mz,height] of [[L*.25,7],[-L*.38,6]]){
  k.cyl(.055,.11,height,0,1.4+height/2,mz,'#fff',metal('#6f746e'));
  rod(k,[-B*.27,height+.7,mz],[B*.27,height+.7,mz],.035);
  for(const s of [-1,1])rod(k,[0,height+1.2,mz],[s*B*.38,1.55,mz+(mz>0?-1:1)*1.7],.009,metal('#555956'));
  if(!naval)rod(k,[0,4.9,mz],[0,2.4,mz+(mz>0?1:-1)*Math.min(3,L*.12)],.07,metal('#92958a'));
 }
 if(!naval)for(let i=0;i<3;i++)hatch(k,0,1.55,L*.08+i*2.4-1,B*.6,1.6);
 else for(const gz of [L*.29,-L*.39]){
  k.cyl(.4,.46,.32,0,1.6,gz,'#fff',metal(c));
  k.box(.75,.5,.65,0,1.98,gz,'#fff',metal(c));
  rod(k,[0,2.05,gz],[0,2.13,gz+(gz>0?1:-1)*1.25],.06);
 }
 for(const s of [-1,1])for(const zz of [-L*.43,L*.31])cleat(k,s*width(zz)*.8,1.47,zz,.16);
}

export function cargoBarge(k,t){
 const c=t.color||'#7e8582';
 hull(k,6.8,2.8,.8,-.2,c,.55);
 k.box(2.38,.08,5.98,0,.84,0,'#fff',timber);
 for(const s of [-1,1]){
  k.box(.09,.35,6.15,s*1.34,.92,-.15,'#fff',metal(c));
  for(const z of [-2.5,-1.3,0,1.3,2.5])k.box(.12,.3,.06,s*1.27,.92,z,'#fff',dark);
  for(const z of [-2.8,2.6])cleat(k,s*1.15,.99,z,.12);
 }
 // Retain the old bow-ramp envelope and angle, with plate ribs and separate hinge pins.
 k.box(2.7,1.35,.13,0,.64,3.27,'#fff',{...metal(c),rx:.5});
 for(let x=-1.15;x<=1.15;x+=.38)k.box(.04,1.32,.06,x,.64,3.19,'#fff',{...dark,rx:.5});
 rod(k,[-1.35,.16,3.5],[1.35,.16,3.5],.07);
 for(const s of [-1,1])k.torus(.2,.055,s*1.34,.53,-2.6,'#fff',{mat:'vehicle_rubber',ry:Math.PI/2,segs:20});
}

export function holdHatch(k,t){
 // m04 intentionally reuses the barge footprint for three cargo hatches. No boat bow,
 // rudder or fenders here. Geometry changes only; locks and rescue events stay authored.
 const c=t.color||'#655d50';
 k.box(2.8,.65,6.8,0,.35,0,'#fff',metal(c));
 for(let z=-2.8;z<=2.9;z+=.8){
  k.box(2.65,.1,.74,0,.74,z,'#fff',{mat:'wood',tint:'#82705c'});
  rod(k,[-1.3,.83,z],[1.3,.83,z],.026,dark);
 }
 for(const x of [-1,1])rod(k,[x,.85,-3.2],[x,.85,3.2],.025,dark);
 k.torus(.075,.018,1.23,.8,.2,'#fff',{...dark,ry:Math.PI/2,segs:16});
}

export function harbourLaunch(k,t){
 const c=t.color||'#828e8d';hull(k,3.8,1.6,.48,-.2,c,.8);
 k.box(1.34,.04,2.65,0,.52,-.2,'#fff',timber);
 k.box(.9,.6,1,0,.82,-.5,'#fff',{mat:'wood_wall',tint:'#c1c2ac'});
 k.box(1.05,.08,1.15,0,1.15,-.5,'#fff',metal('#687370'));
 glazing(k,.78,.94,.02);
 for(const s of [-1,1]){
  k.box(.025,.27,.6,s*.46,.94,-.5,'#fff',{mat:'vehicle_glass',shade:0});
  rod(k,[s*.74,.6,-1.75],[s*.74,.6,1.05],.025,metal(c));
  cleat(k,s*.61,.54,1.1,.07);
 }
 k.box(.9,.07,.3,0,.63,-1.32,'#fff',timber);
 k.cyl(.055,.065,.6,0,1.46,-.7,'#fff',dark);
}
