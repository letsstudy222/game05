import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// CC BY 4.0, Eric Chadwick / Darmstadt Graphics Group; see assets/CREDITS.md.
export async function loadDetailedCar(vehicle) {
  const gltf=await new GLTFLoader().loadAsync('./assets/CarConcept.glb?v=nt-city-02');
  const source=gltf.scene,wrapper=new THREE.Group();wrapper.name='detailed-car';wrapper.add(source);wrapper.updateMatrixWorld(true);
  const centerOf=name=>new THREE.Box3().setFromObject(source.getObjectByName(name)).getCenter(new THREE.Vector3());
  const forward=centerOf('BodyHeadlights').sub(centerOf('BodyTaillights'));
  wrapper.rotation.y=-Math.atan2(forward.x,forward.z);wrapper.updateMatrixWorld(true);
  let bounds=new THREE.Box3().setFromObject(wrapper);wrapper.scale.setScalar(4.6/bounds.getSize(new THREE.Vector3()).z);wrapper.updateMatrixWorld(true);
  bounds=new THREE.Box3().setFromObject(wrapper);const center=bounds.getCenter(new THREE.Vector3());wrapper.position.set(-center.x,-bounds.min.y,-center.z);wrapper.updateMatrixWorld(true);
  const wheels=[],steerPivots=[];
  for(const name of ['WheelFrontL','WheelFrontR','WheelRearL','WheelRearR']) {
    const node=source.getObjectByName(name);if(!node)throw new Error('Car asset missing wheel '+name);
    const center=wrapper.worldToLocal(new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3()));
    const pivot=new THREE.Group();pivot.position.copy(center);wrapper.add(pivot);
    const spin=new THREE.Group();pivot.add(spin);wrapper.updateMatrixWorld(true);
    const relative=wrapper.matrixWorld.clone().invert().multiply(node.matrixWorld),axis=new THREE.Vector3().setFromMatrixColumn(relative,0).normalize();
    let authoredSteer=Math.atan2(-axis.z,axis.x);while(authoredSteer>Math.PI/2)authoredSteer-=Math.PI;while(authoredSteer<-Math.PI/2)authoredSteer+=Math.PI;
    spin.attach(node);
    if(name.includes('Front'))node.applyMatrix4(new THREE.Matrix4().makeRotationY(-authoredSteer));
    wheels.push(spin);
    if(name.includes('Front'))steerPivots.push(pivot);
  }
  const materials=new Set(),headlights=[];let brake=null;
  source.traverse(o=>{if(o.isMesh)for(const m of (Array.isArray(o.material)?o.material:[o.material]))materials.add(m);});
  for(const m of materials) {
    if(m.name==='Glass'){m.transmission=0;m.transparent=true;m.opacity=.5;m.depthWrite=false;m.roughness=.08;}
    if(m.name.startsWith('Paint')){m.map=null;m.roughness=.23;m.clearcoat=.8;}
    if(m.name==='Headlight'){headlights.push(m);m.emissiveIntensity=.1;}
    if(m.name==='Brakelight'){brake=m;m.emissiveIntensity=.15;}
    m.needsUpdate=true;
  }
  // Batch static panels by material, while keeping the four wheel rigs movable.
  wrapper.updateMatrixWorld(true);const inverse=wrapper.matrixWorld.clone().invert(),batches=new Map();
  source.traverse(o=>{
    if(!o.isMesh||Array.isArray(o.material))return;
    const g=o.geometry.clone().applyMatrix4(inverse.clone().multiply(o.matrixWorld));
    const nonindexed=g.index?g.toNonIndexed():g;
    for(const key of Object.keys(nonindexed.attributes))if(!['position','normal','uv','uv1'].includes(key))nonindexed.deleteAttribute(key);
    if(!nonindexed.attributes.uv)nonindexed.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(nonindexed.attributes.position.count*2),2));
    if(!nonindexed.attributes.uv1)nonindexed.setAttribute('uv1',nonindexed.attributes.uv.clone());
    if(!nonindexed.attributes.normal)nonindexed.computeVertexNormals();
    if(!batches.has(o.material))batches.set(o.material,[]);batches.get(o.material).push(nonindexed);
  });
  for(const [material,parts] of batches) {
    const geometry=mergeGeometries(parts,false);if(!geometry)throw new Error('Unable to batch detailed car');
    const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=!material.transparent;mesh.receiveShadow=true;wrapper.add(mesh);parts.forEach(g=>g.dispose());
  }
  source.visible=false;
  for(const object of vehicle.group.children)if(!object.isLight&&!vehicle.beams.some(b=>b.target===object))object.visible=false;
  vehicle.group.add(wrapper);vehicle.wheels=wheels;vehicle.steerPivots=steerPivots;vehicle.glows=[];
  if(brake)vehicle.brakeMat=brake;vehicle.headlightMats=headlights;vehicle.hasDetailedVisual=true;
  vehicle.detailedVisual=wrapper;
  wrapper.traverse(o=>{if(o.isMesh){o.castShadow=!o.material.transparent;o.receiveShadow=true;}});
  return wrapper;
}
