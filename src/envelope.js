// C2 interpolation and the same deformation for live geometry and STL.
// The original Blender surface is the rest shape, so reset is lossless.
export const CHANNELS = { thickness: { label: 'Metal thickness', min: .55, max: 5, unit: 'mm' },
  width: { label: 'Band height', min: 1.5, max: 12, unit: 'mm' } };

export function spline(nodes) {
  const n = nodes.length, x = nodes.map(p => p.u), y = nodes.map(p => p.value);
  if (n < 3 || x.some((v,i) => !Number.isFinite(v) || (i && v-x[i-1] < .0399)) || y.some(v => !Number.isFinite(v)))
    throw Error('Knots must follow the arc with at least 2% spacing.');
  const lo = new Float64Array(n), diagonal = new Float64Array(n), hi = new Float64Array(n), rhs = new Float64Array(n);
  const h = x.slice(1).map((v,i) => v-x[i]);
  diagonal[0] = 2*h[0]; hi[0] = h[0]; rhs[0] = 6*(y[1]-y[0])/h[0];
  lo[n-1] = h[n-2]; diagonal[n-1] = 2*h[n-2]; rhs[n-1] = -6*(y[n-1]-y[n-2])/h[n-2];
  for (let i=1;i<n-1;i++) {
    lo[i]=h[i-1]; diagonal[i]=2*(h[i-1]+h[i]); hi[i]=h[i];
    rhs[i]=6*((y[i+1]-y[i])/h[i]-(y[i]-y[i-1])/h[i-1]);
  }
  for (let i=1;i<n;i++) { const m=lo[i]/diagonal[i-1]; diagonal[i]-=m*hi[i-1]; rhs[i]-=m*rhs[i-1]; }
  const second=new Float64Array(n); second[n-1]=rhs[n-1]/diagonal[n-1];
  for (let i=n-2;i>=0;i--) second[i]=(rhs[i]-hi[i]*second[i+1])/diagonal[i];
  const pieces=h.map((length,i) => ({ x:x[i], h:length, a:y[i],
    b:(y[i+1]-y[i])/length-length*(2*second[i]+second[i+1])/6,
    c:second[i]/2, d:(second[i+1]-second[i])/(6*length) }));
  function at(u) {
    if(u<=x[0])return {value:y[0],derivative:0};
    if(u>=x[n-1])return {value:y[n-1],derivative:0};
    let a=0,b=pieces.length-1;
    while(a<b){const mid=(a+b+1)>>1;if(pieces[mid].x<=u)a=mid;else b=mid-1;}
    const p=pieces[a], t=u-p.x;
    return {value:p.a+t*(p.b+t*(p.c+t*p.d)),derivative:p.b+t*(2*p.c+3*t*p.d)};
  }
  const extremes=[...y];
  for(const p of pieces){
    const a=3*p.d,b=2*p.c,c=p.b, disc=b*b-4*a*c;
    const roots=Math.abs(a)<1e-12?(Math.abs(b)>1e-12?[-c/b]:[]):disc>=0?[(-b-Math.sqrt(disc))/(2*a),(-b+Math.sqrt(disc))/(2*a)]:[];
    for(const t of roots)if(t>0&&t<p.h)extremes.push(p.a+t*(p.b+t*(p.c+t*p.d)));
  }
  return {at,min:Math.min(...extremes),max:Math.max(...extremes)};
}

export function defaultEnvelope(meta) {
  return {version:1,base_sha256:meta.base_sha256,symmetry:{width:false,thickness:false},
    ...Object.fromEntries(Object.keys(CHANNELS).map(key => [key,meta.nodes.map((p,i)=>({id:`${key}-${i}`,u:p.u,value:p[key]}))]))};
}

export function validateEnvelope(state, meta) {
  if(state?.version!==1||state.base_sha256!==meta.base_sha256)throw Error('This profile belongs to a different base model.');
  const result={version:1,base_sha256:meta.base_sha256,
    symmetry:Object.fromEntries(Object.keys(CHANNELS).map(k=>[k,!!(state.symmetry?.[k]??state.symmetric)]))};
  for(const [key,range] of Object.entries(CHANNELS)){
    if(!Array.isArray(state[key])||state[key].length>41)throw Error('Use between 3 and 41 knots.');
    const nodes=state[key].map((p,i)=>({id:typeof p.id==='string'?p.id:`${key}-${i}`,u:Number(p.u),value:Number(p.value)}));
    if(nodes[0]?.u!==-1||nodes.at(-1)?.u!==1||!nodes.some(p=>p.u===0))throw Error('Keep both arc endpoints and the middle knot.');
    if(new Set(nodes.map(p=>p.id)).size!==nodes.length)throw Error('Knot IDs must be unique.');
    const curve=spline(nodes);
    if(curve.min<range.min-.001||curve.max>range.max+.001)throw Error(`${range.label}: the entire curve must stay within ${range.min}–${range.max} mm.`);
    result[key]=nodes;
  }
  return result;
}

// Mirror the chosen half, including its knot positions, rather than averaging
// the pre-existing asymmetry into a hidden baseline.
export function mirrorChannel(nodes, sign=1) {
  const half=nodes.filter(p=>p.u*sign>0).map(p=>({...p})), middle={...nodes.find(p=>p.u===0)};
  return [...half,...half.map(p=>({...p,id:p.id.startsWith('mirror-')?p.id.slice(7):`mirror-${p.id}`,u:-p.u})),middle].sort((a,b)=>a.u-b.u);
}

export function makeField(meta,state,resolution=8193) {
  const rest=defaultEnvelope(meta), base=Object.fromEntries(Object.keys(CHANNELS).map(k=>[k,spline(rest[k])])),
    curves=Object.fromEntries(Object.keys(CHANNELS).map(k=>[k,spline(state[k])])), values=new Float32Array(resolution*4);
  for(let i=0;i<resolution;i++){
    const u=2*i/(resolution-1)-1;
    for(const [j,key] of ['thickness','width'].entries()){
      const a=curves[key].at(u),b=base[key].at(u);
      values[i*4+j*2]=a.value/b.value;
      values[i*4+j*2+1]=(a.derivative*b.value-a.value*b.derivative)/(b.value*b.value*meta.half_arc_rad);
    }
  }
  const identity=Object.keys(CHANNELS).every(k=>state[k].length===rest[k].length&&state[k].every((p,i)=>p.u===rest[k][i].u&&p.value===rest[k][i].value));
  return {values,resolution,identity,curves};
}

export function sampleField(field,u) {
  const q=Math.max(0,Math.min(field.resolution-1,(u+1)/2*(field.resolution-1))),i=Math.min(field.resolution-2,Math.floor(q)),t=q-i;
  const sample=Array.from({length:4},(_,j)=>field.values[i*4+j]*(1-t)+field.values[(i+1)*4+j]*t);
  if(u<=-1||u>=1){sample[1]=0;sample[3]=0;}
  return sample;
}

export function deformPoint(p,n,scales,inner=8.5) {
  const [x,y,z]=p,r=Math.hypot(x,z),ex=x/r,ez=z/r,[a,da,b,db]=scales,radius=inner+(r-inner)*a;
  const nr=n[0]*ex+n[2]*ez,nt=n[0]*ez-n[2]*ex,radial=nr/a,axial=n[1]/b;
  const tangent=(nt-(r-inner)/r*da*radial-y/r*db*axial)/(radius/r);
  const v=[ex*radial+ez*tangent,axial,ez*radial-ex*tangent],length=Math.hypot(...v);
  return {position:[ex*radius,y*b,ez*radius],normal:v.map(c=>c/length)};
}

// Cache the cylindrical frame once. A drag only uploads changed positions and
// inverse-Jacobian normals; no resubdivision, topology change or shading fake.
export function prepareDeformation(positions,normals,meta,resolution=8193) {
  const original=positions.slice(),originalNormals=normals.slice(),count=positions.length/3,
    cache=new Float32Array(count*9),indices=new Uint32Array(count),weights=new Float32Array(count),outside=new Uint8Array(count);
  for(let i=0;i<count;i++){
    const j=i*3,x=positions[j],y=positions[j+1],z=positions[j+2],r=Math.hypot(x,z),ex=x/r,ez=z/r,u=Math.atan2(x,z)/meta.half_arc_rad;
    const q=Math.max(0,Math.min(resolution-1,(u+1)/2*(resolution-1))),index=Math.min(resolution-2,Math.floor(q));
    indices[i]=index*4;weights[i]=q-index;outside[i]=+(u<=-1||u>=1);
    cache.set([r,ex,ez,y,normals[j]*ex+normals[j+2]*ez,normals[j+1],normals[j]*ez-normals[j+2]*ex,(r-meta.inner_radius_mm)/r,y/r],i*9);
  }
  return { apply(field){
    if(field.identity){positions.set(original);normals.set(originalNormals);return;}
    const f=field.values,inner=meta.inner_radius_mm;
    for(let i=0;i<count;i++){
      const j=i*3,k=i*9,s=indices[i],t=weights[i],v=1-t,r=cache[k],ex=cache[k+1],ez=cache[k+2];
      const a=f[s]*v+f[s+4]*t,b=f[s+2]*v+f[s+6]*t,da=outside[i]?0:f[s+1]*v+f[s+5]*t,db=outside[i]?0:f[s+3]*v+f[s+7]*t;
      const radius=inner+(r-inner)*a,nr=cache[k+4]/a,ny=cache[k+5]/b,nt=(cache[k+6]-cache[k+7]*da*nr-cache[k+8]*db*ny)/(radius/r);
      const nx=ex*nr+ez*nt,nz=ez*nr-ex*nt,length=Math.hypot(nx,ny,nz);
      positions[j]=ex*radius;positions[j+1]=cache[k+3]*b;positions[j+2]=ez*radius;
      normals[j]=nx/length;normals[j+1]=ny/length;normals[j+2]=nz/length;
    }
  }};
}
