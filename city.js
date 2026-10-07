import * as THREE from 'three';
import { routeX } from './route.js?v=nt-city-02';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const CITY = {originX:routeX(2800)+140,south:2350,north:3180,streets:[80,240,400,560],crossings:[2420,2570,2720,2870,3020,3170],halfWidth:7};
export function nearCrossing(z,margin=16){return CITY.crossings.some(v=>Math.abs(v-z)<margin);}

// This is a fictional playable district inspired by Nha Trang, not surveyed OSM streets.
export function buildCity({roadCenterX,roadY,heightAt,rng,colliders}) {
  const group=new THREE.Group();group.name='nha-trang-city';
  const batches=new Map(),footprints=[],mapLines=[],signs=[],signals=[];
  const color=new THREE.Color();
  const materials={wall:new THREE.MeshStandardMaterial({vertexColors:true,roughness:.79}),
    glass:new THREE.MeshStandardMaterial({vertexColors:true,roughness:.2,metalness:.45,side:THREE.DoubleSide}),
    road:new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95}),
    window:new THREE.MeshStandardMaterial({vertexColors:true,roughness:.4,emissive:'#ffdba1',emissiveIntensity:0})};
  function tint(g,c){if(!g.index){g.setIndex(Array.from({length:g.attributes.position.count},(_,i)=>i));}color.set(c);const a=new Float32Array(g.attributes.position.count*3);for(let i=0;i<a.length;i+=3){a[i]=color.r;a[i+1]=color.g;a[i+2]=color.b;}g.setAttribute('color',new THREE.BufferAttribute(a,3));return g;}
  function add(g,c,x,y,z,type='wall') {tint(g,c);g.translate(x,y,z);const key=type+':'+Math.floor(z/400);if(!batches.has(key))batches.set(key,{type,geos:[]});batches.get(key).geos.push(g);}
  const box=(sx,sy,sz,c,x,y,z,type)=>add(new THREE.BoxGeometry(sx,sy,sz),c,x,y,z,type);
  const rect=(w,h,c,x,y,z,yaw,type='glass')=>{const g=new THREE.PlaneGeometry(w,h);g.rotateY(yaw);add(g,c,x,y,z,type);};
  function sign(text,x,y,z,yaw,w=9) {
    const c=document.createElement('canvas');c.width=512;c.height=128;const p=c.getContext('2d');p.fillStyle='#174d5b';p.fillRect(0,0,512,128);p.fillStyle='#eae8d8';p.font='bold 37px sans-serif';p.textAlign='center';p.fillText(text,256,82,490);
    const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;const m=new THREE.Mesh(new THREE.PlaneGeometry(w,w/4),new THREE.MeshBasicMaterial({map:t,side:THREE.DoubleSide}));m.position.set(x,y,z);m.rotation.y=yaw;group.add(m);signs.push(m);
  }
  function strip(points,width,c,yOffset) {
    const p=[],uv=[],indices=[];
    for(let i=0;i<points.length;i++) {
      const [x,z]=points[i];const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz)||1;
      const nx=dz/length,nz=-dx/length;
      p.push(x-nx*width/2,roadY(z)+yOffset,z-nz*width/2,x+nx*width/2,roadY(z)+yOffset,z+nz*width/2);uv.push(0,i,1,i);
      if(i>0){const k=i*2;indices.push(k-2,k,k-1,k-1,k,k+1);}
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();add(g,c,0,0,0,'road');
  }
  for(const offset of CITY.streets) {
    const points=[];for(let z=CITY.south;z<=CITY.north;z+=10)points.push([CITY.originX+offset,z]);
    strip(points,21,'#c8c4b1',.035);strip(points,14,'#424849',.08);mapLines.push(points.flat());
    for(let z=CITY.south;z<CITY.north;z+=12) {
      if(nearCrossing(z,18))continue;const x=CITY.originX+offset;
      box(.13,.025,5,'#e6dfbf',x,roadY(z)+.11,z,'road');
      for(const s of [-1,1])box(.16,.2,11,'#e0ddd0',x+s*7.5,roadY(z)+.12,z,'road');
    }
  }
  for(let i=0;i<CITY.crossings.length;i++) {
    const z=CITY.crossings[i],x=CITY.originX,points=[[roadCenterX(z)-6,z],[x+630,z]];
    strip(points,22,'#c8c4b1',.04);strip(points,14,'#424849',.10);mapLines.push(points.flat());
    for(let dx=14;dx<628;dx+=12) {
      if(CITY.streets.some(s=>Math.abs(s-dx)<18))continue;
      box(5,.02,.14,'#e9e0bf',x+dx,roadY(z)+.13,z,'road');
    }
    for(const dx of [0,...CITY.streets]) {
      for(const side of [-1,1])for(let k=-5;k<=5;k++)box(.6,.02,3.6,'#f2efde',x+dx+k,roadY(z)+.14,z+side*11,'road');
      box(.18,4.8,.18,'#404a4c',x+dx+9,roadY(z)+2.4,z+10);
      box(.6,1.6,.45,'#283132',x+dx+9,roadY(z)+4.3,z+10);
      const lights=[];
      for(let k=0;k<3;k++) {
        const m=new THREE.Mesh(new THREE.CircleGeometry(.15,12),new THREE.MeshBasicMaterial({color:['#752d26','#665324','#215239'][k],side:THREE.DoubleSide}));m.position.set(x+dx+9,roadY(z)+4.8-k*.45,z+10-.235);group.add(m);lights.push(m);
      }
      signals.push({lights,parity:i%2});
    }
    sign(['NGUYỄN THIỆN THUẬT','LÊ THÁNH TÔN','HÙNG VƯƠNG','BIỆT THỰ','TRẦN QUANG KHẢI','KHU TRUNG TÂM'][i],x+18,roadY(z)+4.2,z+15,Math.PI,7);
  }
  // Street trees and planted sidewalks; keep every crossing clear.
  for(const off of CITY.streets)for(let z=2380;z<3160;z+=36) {
    if(nearCrossing(z,22))continue;
    for(const side of [-1,1]) {
      const x=CITY.originX+off+side*10.5,y=heightAt(x,z);
      box(3.8,.25,4.2,'#afb6a3',x,y+.12,z);
      add(new THREE.CylinderGeometry(.12,.21,4.4,10),'#827054',x,y+2.2,z);
      const crown=new THREE.SphereGeometry(1,12,8);crown.scale(1.8,2.2,1.8);add(crown,'#4c7755',x,y+5.0,z);
      box(2.2,.15,.65,'#9b7852',x,y+.55,z+4.0);
      for(const dx of [-.8,.8])box(.12,.55,.5,'#465456',x+dx,y+.275,z+4);
    }
  }
  const shops=['CÀ PHÊ NHA TRANG','KHÁCH SẠN BIỂN','PHỞ & BÚN CÁ','CHỢ PHỐ BIỂN','COASTAL HOTEL','TIỆM BÁNH'];
  let building=0;
  for(let row=0;row<CITY.crossings.length-1;row++)for(let col=0;col<CITY.streets.length-1;col++)for(const sx of [-1,1])for(const sz of [-1,1]) {
    const z=(CITY.crossings[row]+CITY.crossings[row+1])/2+sz*32;
    const offset=(CITY.streets[col]+CITY.streets[col+1])/2+sx*37;
    const x=CITY.originX+offset,y=heightAt(x,z),w=48,d=48;
    const hotel=building%7===0,floors=hotel?12:4+Math.floor(rng()*6),h=floors*3.2;
    const wall=['#e3dcc6','#dfd8ca','#c6d7d8','#dccfba'][building%4];
    box(w,h,d,wall,x,y+h/2,z);
    box(w+1,.65,d+1,'#929e9d',x,y+h+.3,z);
    box(w+2,.5,d+2,'#bebcb1',x,y+3.4,z);
    for(const face of [0,1,2,3]) {
      const yaw=face*Math.PI/2;
      for(let floor=1;floor<floors;floor++)for(let column=-5;column<=5;column++) {
        const sideways=column*3.8;
        const px=x+Math.cos(yaw)*sideways+Math.sin(yaw)*(d/2+.06);
        const pz=z-Math.sin(yaw)*sideways+Math.cos(yaw)*(d/2+.06);
        rect(hotel?3.7:2.4,2.35,building%3?'#658b98':'#799da7',px,y+floor*3.2+1.5,pz,yaw, rng()<.18?'window':'glass');
      }
      if(face===0||face===2)for(let k=-4;k<=4;k++)rect(4,2.7,'#365966',x+k*4.8,y+1.5,z+(face===0?1:-1)*(d/2+.08),yaw);
    }
    for(let floor=2;floor<floors;floor+=2)box(w+.3,.12,d+.3,'#c6c9c0',x,y+floor*3.2,z);
    box(5,2.2,3,'#9ca8a7',x-12,y+h+1.4,z-12);
    box(2.2,3.0,2.2,'#c4c9c2',x+8,y+h+1.5,z+8);
    sign(shops[building%shops.length],x,y+3.0,z-d/2-.12,Math.PI,16);
    colliders.push({x,z,r:Math.hypot(w,d)/2*.77});footprints.push({x,z,w,d});building++;
  }
  // Trầm Hương-inspired landmark on the promenade, manually modeled rather than photogrammetry.
  const tz=3060,tx=roadCenterX(tz)-32,ty=heightAt(tx,tz);
  add(new THREE.CylinderGeometry(10,11,1,40),'#e6d6b7',tx,ty+.5,tz);
  add(new THREE.CylinderGeometry(2.5,4.5,16,32),'#e7b391',tx,ty+8,tz);
  for(let i=0;i<5;i++) {
    const angle=i/5*Math.PI*2;
    const petal=new THREE.SphereGeometry(1,16,12);petal.scale(1.5,8,3.0);petal.rotateX(-.22);petal.rotateY(angle);
    add(petal,'#edc1a4',tx+Math.sin(angle)*3.2,ty+11,tz+Math.cos(angle)*3.2);
  }
  for(const h of [4,7,10])add(new THREE.TorusGeometry(4.4,.16,6,32).rotateX(Math.PI/2),'#b57e59',tx,ty+h,tz);
  sign('QUẢNG TRƯỜNG TRẦM HƯƠNG',tx,ty+2,tz-10,Math.PI,12);
  colliders.push({x:tx,z:tz,r:7});
  const chunks=[];
  for(const {type,geos} of batches.values()) {
    const geometry=mergeGeometries(geos,false);geos.forEach(g=>g.dispose());geometry.computeBoundingSphere();
    const m=new THREE.Mesh(geometry,materials[type]);m.castShadow=type==='wall';m.receiveShadow=true;group.add(m);chunks.push(m);
  }
  function isRoad(x,z) {
    if(z<CITY.south-10||z>CITY.north+10)return false;
    const off=x-CITY.originX;
    return CITY.streets.some(s=>Math.abs(off-s)<CITY.halfWidth+.5)||(x>roadCenterX(z)-10&&off<635&&nearCrossing(z,CITY.halfWidth+.5));
  }
  return {group,mapLines,footprints,isRoad,originX:CITY.originX,
    update(t,camX,camZ){
      for(const m of chunks){const b=m.geometry.boundingSphere;m.visible=Math.hypot(b.center.x-camX,b.center.z-camZ)<1300+b.radius;}
      for(const s of signs)s.visible=Math.hypot(s.position.x-camX,s.position.z-camZ)<420;
      for(const signal of signals){const red=(Math.floor(t/9)+signal.parity)%2===0;signal.lights.forEach((m,i)=>{m.visible=Math.hypot(m.position.x-camX,m.position.z-camZ)<250;m.material.color.set(i===0?(red?'#ff4538':'#752d26'):i===2?(!red?'#48e4a0':'#215239'):'#665324');});}
    },
    setNight(n){materials.window.emissiveIntensity=n?1.8:0;}
  };
}
