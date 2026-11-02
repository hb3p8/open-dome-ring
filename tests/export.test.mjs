import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { exportEnvelopeOBJ } from '../src/export.js';
import { prepareDeformation } from '../src/envelope.js';

test('OBJ roundtrip retains deformed vertices, smooth normals and face references',()=>{
  const geometry=new THREE.SphereGeometry(1,12,8).translate(10,0,0);
  const positions=geometry.attributes.position,normals=geometry.attributes.normal;
  const originalPositions=positions.array.slice(),originalNormals=normals.array.slice();
  const deformer=prepareDeformation(positions.array,normals.array,{inner_radius_mm:8.5,half_arc_rad:Math.PI},2);
  const field={values:new Float32Array([1,0,.7,0,1,0,.7,0]),resolution:2,identity:false};
  // A constant axial envelope makes the surface visibly narrower and tilts
  // smooth normals. Export must retain both changes, including world transforms.
  deformer.apply(field);
  assert.notDeepEqual(positions.array,originalPositions);
  assert.notDeepEqual(normals.array,originalNormals);
  const ring=new THREE.Group(),mesh=new THREE.Mesh(geometry);
  ring.position.set(2,3,4);ring.rotation.set(Math.PI/2,0,.2);ring.scale.set(1,1.2,.9);ring.add(mesh);
  const text=exportEnvelopeOBJ(ring),lines=text.split('\n');
  assert.equal(lines.filter(l=>l.startsWith('vn ')).length,normals.count);
  assert.equal(lines.filter(l=>l.startsWith('f ')).length,geometry.index.count/3);
  assert.ok(lines.filter(l=>l.startsWith('f ')).every(l=>l.split(' ').slice(1).every(v=>/^\d+\/\d+\/\d+$/.test(v))));
  const loaded=new OBJLoader().parse(text).children[0].geometry;
  const normalMatrix=new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  for(let i=0;i<geometry.index.count;i++){
    const index=geometry.index.getX(i),p=new THREE.Vector3().fromBufferAttribute(positions,index).applyMatrix4(mesh.matrixWorld),
      n=new THREE.Vector3().fromBufferAttribute(normals,index).applyNormalMatrix(normalMatrix);
    assert.ok(p.distanceTo(new THREE.Vector3().fromBufferAttribute(loaded.attributes.position,i))<2e-6);
    assert.ok(n.distanceTo(new THREE.Vector3().fromBufferAttribute(loaded.attributes.normal,i))<2e-6);
  }
});
