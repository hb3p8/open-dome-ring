import * as THREE from 'three/webgpu';
import { CHANNELS,defaultEnvelope,validateEnvelope,mirrorChannel,makeField } from './envelope.js';

const clone=value=>structuredClone(value),svgNS='http://www.w3.org/2000/svg';
export function download(data,name,type){
  const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export function createEnvelopeUI({meta,camera,orbit,canvas,overlay,onChange,onExport}) {
  const $=id=>document.getElementById(id),graph=$('graph');
  const session=new URLSearchParams(location.search).get('session')?.replace(/[^a-z0-9-]/gi,'').slice(0,32);
  const key='open-dome-envelope-v1'+(session?`:${session}`:'');
  let state=defaultEnvelope(meta),channel='width',selected=state.width.find(p=>p.u===0).id,field;
  let pending=false,start=null,drag=null,undo=[],redo=[],revision=0;
  try{const saved=localStorage.getItem(key);if(saved)state=validateEnvelope(JSON.parse(saved),meta);}catch{}
  const node=()=>state[channel].find(p=>p.id===selected)??state[channel].find(p=>p.u===0);
  const error=message=>{$('error').textContent=message;};
  const persist=()=>{try{localStorage.setItem(key,JSON.stringify(state));}catch{error('Could not save the profile in this browser. Export it as JSON instead.');}};
  const checkpoint=()=>{if(!start)start=clone(state);};
  function commit(){
    if(start&&JSON.stringify(start)!==JSON.stringify(state)){undo.push(start);if(undo.length>60)undo.shift();redo=[];persist();}
    start=null;controls();
  }
  function accept(next){
    try{state=validateEnvelope(next,meta);error('');refresh();return true;}catch(e){error(e.message);return false;}
  }
  function updateNode(u,value){
    const current=node(),next=clone(state),p=next[channel].find(p=>p.id===current.id),range=CHANNELS[channel];
    const index=next[channel].indexOf(p),fixed=p.u===0||Math.abs(p.u)===1;
    p.value=Math.max(range.min,Math.min(range.max,value));
    if(!fixed)p.u=Math.max(next[channel][index-1].u+.04,Math.min(next[channel][index+1].u-.04,u));
    if(next.symmetry[channel])next[channel]=mirrorChannel(next[channel],p.u<0?-1:1);
    return accept(next);
  }
  function controls(){
    const p=node(),range=CHANNELS[channel];selected=p.id;
    $('node-select').replaceChildren(...state[channel].map(point=>{
      const option=document.createElement('option');option.value=point.id;
      option.textContent=`${point.u<0?'Right':point.u>0?'Left':'Middle'} · ${Math.round(point.u*100)}% · ${point.value.toFixed(2)} mm`;return option;
    }));
    $('node-select').value=p.id;$('node-value').value=p.value.toFixed(2);
    for(const id of ['node-value','node-range']){$(id).min=range.min;$(id).max=range.max;}
    $('node-range').value=p.value;
    document.querySelector('label[for="node-value"]').textContent=`${range.label}, mm`;
    $('node-position').value=Math.round(p.u*100);$('node-position').disabled=p.u===0||Math.abs(p.u)===1;
    $('remove-node').disabled=p.u===0||Math.abs(p.u)===1;
    $('undo').disabled=!undo.length;$('redo').disabled=!redo.length;$('symmetry').checked=state.symmetry[channel];
  }
  function element(tag,attributes,text){
    const e=document.createElementNS(svgNS,tag);for(const [k,v] of Object.entries(attributes))e.setAttribute(k,v);
    if(text!==undefined)e.textContent=text;return e;
  }
  const x=u=>38+(u+1)*190,y=value=>218-value/CHANNELS[channel].max*190;
  function drawGraph(){
    graph.replaceChildren();
    for(let value=0;value<=CHANNELS[channel].max;value+=channel==='thickness'?1:2){
      graph.append(element('line',{x1:38,x2:418,y1:y(value),y2:y(value),stroke:'#eee9e1'}));
      graph.append(element('text',{x:30,y:y(value)+4,'text-anchor':'end'},value));
    }
    graph.append(element('line',{x1:x(0),x2:x(0),y1:18,y2:218,stroke:'#d6d0c7','stroke-dasharray':'4 4'}));
    for(const [u,label] of [[-1,'Right tip'],[0,'Middle'],[1,'Left tip']])graph.append(element('text',{x:x(u),y:240,'text-anchor':u<0?'start':u>0?'end':'middle'},label));
    const curve=field.curves[channel],path=Array.from({length:241},(_,i)=>{const u=-1+i/120;return`${i?'L':'M'}${x(u).toFixed(2)},${y(curve.at(u).value).toFixed(2)}`;}).join(' ');
    graph.append(element('path',{d:path,fill:'none',stroke:'#3f6b80','stroke-width':2.5}));
    for(const p of state[channel])graph.append(element('circle',{cx:x(p.u),cy:y(p.value),r:p.id===selected?7:5.5,fill:p.id===selected?'#c58b36':p.u<0?'#b66f50':'#3f6b80','data-node':p.id}));
  }
  const lineGeometry=new THREE.BufferGeometry(),line=new THREE.Line(lineGeometry,new THREE.LineBasicNodeMaterial({color:0x3f6b80,depthTest:false}));
  const backGeometry=new THREE.BufferGeometry(),backLine=new THREE.Line(backGeometry,new THREE.LineBasicNodeMaterial({color:0x7296a5,depthTest:false,transparent:true,opacity:.4}));
  const spanGeometry=new THREE.BufferGeometry(),spanLine=new THREE.Line(spanGeometry,new THREE.LineBasicNodeMaterial({color:0xc58b36,depthTest:false}));
  const handles=new THREE.Group(),balls=new Map(),ballGeometry=new THREE.SphereGeometry(.20,12,8);
  overlay.add(line,backLine,spanLine,handles);
  function worldPoint(u){
    const angle=u*meta.half_arc_rad,t=field.curves.thickness.at(u).value,w=field.curves.width.at(u).value;
    const radius=meta.inner_radius_mm+(channel==='thickness'?t:.6*t);
    return new THREE.Vector3(Math.sin(angle)*radius,channel==='width'?-w/2:0,Math.cos(angle)*radius);
  }
  function drawHandles(){
    line.visible=handles.visible=$('handles').checked;
    backLine.visible=spanLine.visible=handles.visible&&channel==='width';
    const points=Array.from({length:241},(_,i)=>worldPoint(-1+i/120));lineGeometry.setFromPoints(points);
    if(channel==='width'){
      backGeometry.setFromPoints(points.map(p=>new THREE.Vector3(p.x,-p.y,p.z)));
      const p=worldPoint(node().u);spanGeometry.setFromPoints([p,new THREE.Vector3(p.x,-p.y,p.z)]);
    }
    const ids=new Set(state[channel].map(p=>p.id));
    for(const [id,ball] of balls)if(!ids.has(id)){handles.remove(ball);ball.material.dispose();balls.delete(id);}
    for(const p of state[channel]){
      let ball=balls.get(p.id);
      if(!ball){ball=new THREE.Mesh(ballGeometry,new THREE.MeshBasicNodeMaterial({depthTest:false}));ball.userData.node=p.id;handles.add(ball);balls.set(p.id,ball);}
      ball.position.copy(worldPoint(p.u));ball.material.color.setHex(p.id===selected?0xc58b36:p.u<0?0xb66f50:0x3f6b80);
      ball.scale.setScalar(p.id===selected?1.4:1);
    }
  }
  function refresh(){
    field=makeField(meta,state);controls();drawGraph();drawHandles();
    if(!pending){pending=true;requestAnimationFrame(()=>{pending=false;onChange(field);revision++;canvas.dataset.envelopeRevision=revision;});}
  }
  function pointFromEvent(event){
    const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(graph.getScreenCTM().inverse());
    return {u:(p.x-38)/190-1,value:(218-p.y)/190*CHANNELS[channel].max};
  }
  graph.addEventListener('pointerdown',e=>{
    const id=e.target.getAttribute('data-node');if(!id)return;
    selected=id;checkpoint();drag={type:'graph',pointer:e.pointerId};graph.setPointerCapture(e.pointerId);graph.focus();controls();drawGraph();drawHandles();e.preventDefault();
  });
  graph.addEventListener('pointermove',e=>{if(drag?.type==='graph'&&drag.pointer===e.pointerId){const p=pointFromEvent(e);updateNode(p.u,p.value);}});
  function endGraph(e){if(drag?.type==='graph'&&drag.pointer===e.pointerId){drag=null;commit();}}
  graph.addEventListener('pointerup',endGraph);graph.addEventListener('pointercancel',endGraph);
  graph.addEventListener('dblclick',e=>{
    const p=pointFromEvent(e);if(Math.abs(p.u)>.96||state[channel].some(n=>Math.abs(n.u-p.u)<.04))return;
    checkpoint();const next=clone(state),id=`node-${crypto.randomUUID()}`;next[channel].push({id,...p});next[channel].sort((a,b)=>a.u-b.u);
    if(next.symmetry[channel])next[channel]=mirrorChannel(next[channel],p.u<0?-1:1);
    selected=id;if(!accept(next))selected=node().id;commit();
  });
  function remove(){
    const p=node();if(p.u===0||Math.abs(p.u)===1)return;
    checkpoint();const next=clone(state);next[channel]=next[channel].filter(n=>n.id!==p.id);
    if(next.symmetry[channel])next[channel]=mirrorChannel(next[channel],p.u<0?-1:1);
    selected=next[channel].find(n=>n.u===0).id;accept(next);commit();
  }
  graph.addEventListener('keydown',e=>{
    const p=node(),step=e.shiftKey ? .1 : .02;
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){
      e.preventDefault();checkpoint();updateNode(p.u+(e.key==='ArrowRight'?.01:e.key==='ArrowLeft'?-.01:0),p.value+(e.key==='ArrowUp'?step:e.key==='ArrowDown'?-step:0));commit();
    }else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();remove();}
  });
  const raycaster=new THREE.Raycaster(),mouse=new THREE.Vector2(),plane=new THREE.Plane(),hit=new THREE.Vector3();
  function setRay(e){const r=canvas.getBoundingClientRect();mouse.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(mouse,camera);}
  canvas.addEventListener('pointerdown',e=>{
    if(e.button!==0||!handles.visible)return;overlay.updateWorldMatrix(true,true);setRay(e);const found=raycaster.intersectObjects(handles.children)[0];if(!found)return;
    e.preventDefault();e.stopImmediatePropagation();selected=found.object.userData.node;checkpoint();orbit.enabled=false;canvas.setPointerCapture(e.pointerId);
    const p=node(),base=found.object.getWorldPosition(new THREE.Vector3()),axis=new THREE.Vector3(0,-1,0).transformDirection(overlay.matrixWorld),
      a=base.clone().project(camera),b=base.clone().add(axis).project(camera),rect=canvas.getBoundingClientRect();
    drag={type:'3d',pointer:e.pointerId,startX:e.clientX,startY:e.clientY,value:p.value,u:p.u,axis:[(b.x-a.x)*rect.width/2,-(b.y-a.y)*rect.height/2]};
    controls();drawGraph();drawHandles();
  },true);
  canvas.addEventListener('pointermove',e=>{
    if(drag?.type!=='3d'||drag.pointer!==e.pointerId)return;e.preventDefault();e.stopImmediatePropagation();
    if(channel==='thickness'){
      setRay(e);plane.set(new THREE.Vector3(0,1,0),0).applyMatrix4(overlay.matrixWorld);
      if(raycaster.ray.intersectPlane(plane,hit)){
        overlay.worldToLocal(hit);updateNode(Math.atan2(hit.x,hit.z)/meta.half_arc_rad,Math.hypot(hit.x,hit.z)-meta.inner_radius_mm);
      }
    }else{
      const [ax,ay]=drag.axis,length=ax*ax+ay*ay;
      if(length>1)updateNode(drag.u,drag.value+2*((e.clientX-drag.startX)*ax+(e.clientY-drag.startY)*ay)/length);
      else error('Rotate the ring to adjust height in 3D, or use the graph.');
    }
  },true);
  function end3d(e){if(drag?.type==='3d'&&drag.pointer===e.pointerId){e.stopImmediatePropagation();drag=null;orbit.enabled=true;commit();}}
  canvas.addEventListener('pointerup',end3d,true);canvas.addEventListener('pointercancel',end3d,true);
  $('channel').onchange=()=>{channel=$('channel').value;selected=state[channel].find(p=>p.u===0).id;refresh();};
  $('node-select').onchange=()=>{selected=$('node-select').value;controls();drawGraph();drawHandles();};
  $('handles').onchange=()=>{drawHandles();onChange(field);};
  $('node-value').onchange=()=>{checkpoint();updateNode(node().u,Number($('node-value').value));commit();};
  $('node-position').onchange=()=>{checkpoint();updateNode(Number($('node-position').value)/100,node().value);commit();};
  $('node-range').onpointerdown=checkpoint;$('node-range').oninput=()=>{checkpoint();updateNode(node().u,Number($('node-range').value));};$('node-range').onchange=commit;
  $('symmetry').onchange=()=>{
    checkpoint();const next=clone(state);next.symmetry[channel]=$('symmetry').checked;
    if(next.symmetry[channel])next[channel]=mirrorChannel(next[channel],node().u<0?-1:1);
    accept(next);commit();
  };
  $('remove-node').onclick=remove;
  $('undo').onclick=()=>{if(!undo.length)return;redo.push(clone(state));accept(undo.pop());persist();controls();};
  $('redo').onclick=()=>{if(!redo.length)return;undo.push(clone(state));accept(redo.pop());persist();controls();};
  $('reset').onclick=()=>{checkpoint();selected=defaultEnvelope(meta)[channel].find(p=>p.u===0).id;accept(defaultEnvelope(meta));commit();};
  $('save-envelope').onclick=()=>download(JSON.stringify(state,null,2)+'\n','ring-envelope.json','application/json');
  $('load-envelope').onclick=()=>$('envelope-file').click();
  $('envelope-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const next=validateEnvelope(JSON.parse(await file.text()),meta);checkpoint();selected=next[channel].find(p=>p.u===0).id;accept(next);commit();}catch(err){error(err.message);}e.target.value='';};
  const exportButtons=['obj','stl'].map(format=>$('export-'+format));
  for(const format of ['obj','stl'])$('export-'+format).onclick=async()=>{
    for(const button of exportButtons)button.disabled=true;
    try{onChange(field);await onExport(format);}
    catch(e){error(e.message);}
    finally{for(const button of exportButtons)button.disabled=false;}
  };
  refresh();
  return {get state(){return state;},get field(){return field;},dispose(){for(const l of [line,backLine,spanLine]){l.geometry.dispose();l.material.dispose();}ballGeometry.dispose();for(const b of balls.values())b.material.dispose();}};
}
