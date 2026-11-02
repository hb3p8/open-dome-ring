import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spline,defaultEnvelope,validateEnvelope,mirrorChannel,makeField,sampleField,deformPoint,prepareDeformation} from '../src/envelope.js';

const meta=JSON.parse(fs.readFileSync(new URL('../public/generated/open-dome-ring/envelope-base.json',import.meta.url)));
const copy=value=>structuredClone(value);
const close=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);

test('height spline passes through its knots and has continuous slope and curvature',()=>{
  const state=defaultEnvelope(meta),curve=spline(state.width),h=1e-5;
  for(const p of state.width)close(curve.at(p.u).value,p.value,1e-10);
  for(const p of state.width.slice(1,-1)){
    const left=curve.at(p.u-h),right=curve.at(p.u+h),middle=curve.at(p.u);
    close(left.derivative,right.derivative,.01);
    const left2=curve.at(p.u-2*h),right2=curve.at(p.u+2*h);
    close((3*middle.derivative-4*left.derivative+left2.derivative)/(2*h),
      (-3*middle.derivative+4*right.derivative-right2.derivative)/(2*h),1e-5);
  }
  close(curve.at(-1).derivative,0);close(curve.at(1).derivative,0);
});

test('height changes only the axial size, independently on the two shoulders',()=>{
  const state=defaultEnvelope(meta),left=state.width.find(p=>Math.abs(p.u-140/180)<1e-6);
  left.value=6;
  validateEnvelope(state,meta);
  const field=makeField(meta,state),u=left.u,angle=u*meta.half_arc_rad,p=[10*Math.sin(angle),3,10*Math.cos(angle)];
  const result=deformPoint(p,[0,1,0],sampleField(field,u),meta.inner_radius_mm);
  close(result.position[0],p[0]);close(result.position[2],p[2]);
  close(result.position[1],p[1]*6/8.2,1e-5);
  const right=sampleField(field,-u);close(right[2],1,1e-5);close(right[0],1);
  assert.ok(field.curves.width.at(u).value<field.curves.width.at(-u).value);
});

test('mirroring is controlled by knots rather than a hardcoded side multiplier',()=>{
  const state=defaultEnvelope(meta);state.width=mirrorChannel(state.width,-1);state.symmetry.width=true;
  validateEnvelope(state,meta);const curve=spline(state.width);
  for(let u=0;u<=1;u+=.01)close(curve.at(u).value,curve.at(-u).value,1e-9);
  const field=makeField(meta,state);
  for(let u=-1;u<=1;u+=.01){const scales=sampleField(field,u);close(scales[0],1);close(scales[1],0);}
  const again=mirrorChannel(mirrorChannel(state.width,1),-1);
  assert.ok(again.every(p=>p.id.length<40));
});

test('reset restores the exact source mesh and height edits preserve radial coordinates',()=>{
  const source=new Float32Array([10,2,0, 0,-1,9, 8.5,0,0]),positions=source.slice(),
    originalNormals=new Float32Array([1,0,0, 0,0,1, 1,0,0]),normals=originalNormals.slice();
  const deformer=prepareDeformation(positions,normals,meta),state=defaultEnvelope(meta),edited=copy(state);
  for(const p of edited.width)p.value*=1.1;
  deformer.apply(makeField(meta,edited));
  for(let i=0;i<source.length;i+=3){close(positions[i],source[i],2e-6);close(positions[i+2],source[i+2],2e-6);close(positions[i+1],source[i+1]*1.1,2e-6);}
  deformer.apply(makeField(meta,state));assert.deepEqual(positions,source);assert.deepEqual(normals,originalNormals);
});

test('deformed normals remain perpendicular to the deformed surface',()=>{
  const theta=.7,p=[10*Math.sin(theta),1.4,10*Math.cos(theta)],normal=[.3,.5,-.2],len=Math.hypot(...normal),n=normal.map(v=>v/len);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],
    dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),t1=cross(n,[0,1,0]),t2=cross(n,t1),epsilon=1e-4;
  const transform=q=>{
    const delta=Math.atan2(q[0],q[2])-theta;
    return deformPoint(q,n,[1.2+.31*delta,.31,.8-.2*delta,-.2],8.5);
  };
  const changed=transform(p).normal;
  for(const tangent of [t1,t2]){
    const a=transform(p.map((v,i)=>v+epsilon*tangent[i])).position,b=transform(p.map((v,i)=>v-epsilon*tangent[i])).position;
    close(dot(changed,a.map((v,i)=>(v-b[i])/(2*epsilon))),0,1e-7);
  }
});

test('invalid curves and profiles for other base meshes are rejected',()=>{
  const state=defaultEnvelope(meta);assert.throws(()=>validateEnvelope({...state,base_sha256:'other'},meta));
  state.width[5].value=-2;assert.throws(()=>validateEnvelope(state,meta));
  const duplicate=defaultEnvelope(meta);duplicate.width[5].u=duplicate.width[4].u;
  assert.throws(()=>validateEnvelope(duplicate,meta));
});
