import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createRingRenderer, createMetalRoomEnvironment } from './render/renderer.js';
import { ReflectionMetalMaterial } from './render/metal-material.js';
import { installLightTracerToneMapping, exposureMultiplier } from './render/display-transform.js';
import { createJewelryPipeline } from './render/pipeline.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { exportEnvelopeOBJ } from './export.js';
import { prepareDeformation } from './envelope.js';
import { createEnvelopeUI, download } from './envelope-ui.js';

// Interactive mesh viewer with metal lighting and display post-processing.
const status = document.getElementById('status');
try {
  const renderer = await createRingRenderer();
  await installLightTracerToneMapping(renderer);
  renderer.toneMappingExposure = exposureMultiplier(1.1);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0, 0);
  const viewport=document.getElementById('viewport');
  viewport.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const environment = createMetalRoomEnvironment(), pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(environment, 0.04);
  scene.environment = target.texture;
  environment.dispose(); pmrem.dispose();
  const material = new ReflectionMetalMaterial({ color: '#d9b56c', metalness: 1, roughness: 0.32 });
  const response=await fetch('./generated/open-dome-ring/envelope-base.json');
  if(!response.ok)throw Error('The ring profile could not be loaded. Please reload the page.');
  const meta=await response.json();
  const gltf = await new GLTFLoader().loadAsync('./generated/open-dome-ring/ring.glb');
  gltf.scene.rotation.x = Math.PI / 2; // glTF Y-up back to the CAD frame, hole along Y.
  gltf.scene.updateMatrixWorld(true);
  const ring=new THREE.Group(),surfaces=[];
  // Rotate the CAD XZ ring plane to XY; the hole and orbit axis are now Z.
  // Keep vertex deformation in its original CAD frame inside this group.
  ring.rotation.x=Math.PI/2;
  gltf.scene.traverse(object=>{
    if(!object.isMesh)return;
    const geometry=object.geometry.clone().applyMatrix4(object.matrixWorld),mesh=new THREE.Mesh(geometry,material);
    const positions=geometry.attributes.position,normals=geometry.attributes.normal;
    positions.setUsage(THREE.DynamicDrawUsage);normals.setUsage(THREE.DynamicDrawUsage);
    geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(),35);
    surfaces.push({geometry,deformer:prepareDeformation(positions.array,normals.array,meta)});ring.add(mesh);
    object.geometry.dispose();
  });
  scene.add(ring);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 300);
  camera.up.set(0, 0, 1);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.minDistance = 10; orbit.maxDistance = 120;
  const overlay=new THREE.Scene(),profileOverlay=new THREE.Group();
  profileOverlay.rotation.copy(ring.rotation);overlay.add(profileOverlay);
  const pipeline = createJewelryPipeline(renderer, scene,overlay);
  let geometryRevision=0;
  const envelope=createEnvelopeUI({meta,camera,orbit,canvas:renderer.domElement,overlay:profileOverlay,
    onChange(field){
      const started=performance.now();
      for(const {geometry,deformer} of surfaces){deformer.apply(field);geometry.attributes.position.needsUpdate=true;geometry.attributes.normal.needsUpdate=true;}
      pipeline.invalidate();renderer.domElement.dataset.geometryRevision=++geometryRevision;
      renderer.domElement.dataset.geometryUpdateMs=(performance.now()-started).toFixed(1);
    },
    onExport(format){
      ring.updateMatrixWorld(true);
      if(format==='obj')download(exportEnvelopeOBJ(ring),'ring-envelope.obj','text/plain');
      else download(new STLExporter().parse(ring,{binary:true}),'ring-envelope.stl','model/stl');
    }
  });
  function resize() {
    const width=viewport.clientWidth,height=viewport.clientHeight;
    renderer.setSize(width,height);
    camera.aspect = width / height; camera.updateProjectionMatrix(); pipeline.invalidate();
  }
  const observer=new ResizeObserver(resize);observer.observe(viewport);
  orbit.addEventListener('change', () => pipeline.invalidate());
  camera.position.set(6,-32,30);orbit.target.set(0,0,0);orbit.update();resize();
  renderer.setAnimationLoop(() => pipeline.render(camera));
  renderer.domElement.dataset.envelopeReady='true';
  status.textContent = 'Knot edits update the ring and OBJ / STL exports.\nDrag empty space to rotate; scroll to zoom.';
  addEventListener('pagehide', () => { renderer.setAnimationLoop(null);observer.disconnect();envelope.dispose();pipeline.dispose();for(const {geometry} of surfaces)geometry.dispose();renderer.dispose(); }, { once: true });
} catch (error) {
  const messages={
    'errors.webgpuUnavailable':'WebGPU is unavailable. Use a WebGPU-capable browser with hardware acceleration enabled.',
    'errors.webgpuAdapter':'No WebGPU adapter is available. Check your browser and graphics driver.',
    'errors.webgpuRenderer':'Could not initialize the WebGPU renderer.',
  };
  status.textContent = 'Could not load the ring: ' + (messages[error.message]??error.message);
  console.error(error);
}
