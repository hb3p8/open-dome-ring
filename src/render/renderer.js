import { WebGPURenderer } from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// This mesh viewer needs a renderer only, with no field evaluator or mesher.
export async function createRingRenderer() {
  if(!navigator.gpu)throw Error('errors.webgpuUnavailable');
  let device,renderer;
  try{
    const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
    if(!adapter)throw Error('errors.webgpuAdapter');
    device=await adapter.requestDevice({
      requiredFeatures:['timestamp-query','shader-f16'].filter(feature=>adapter.features.has(feature)),
    });
    renderer=new WebGPURenderer({device,antialias:true,alpha:true});
    await renderer.init();
    if(!renderer.backend.isWebGPUBackend)throw Error('errors.webgpuRenderer');
    return renderer;
  }catch(error){renderer?.dispose();device?.destroy();throw error;}
}

export function createMetalRoomEnvironment() {
  const environment=new RoomEnvironment();
  environment.traverse(object=>{if(object.isInstancedMesh)object.visible=false;});
  return environment;
}
