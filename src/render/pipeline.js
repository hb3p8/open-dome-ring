import { DepthTexture, FloatType, HalfFloatType, Matrix4, NoBlending, NoToneMapping, RGFormat,
  RenderPipeline, RenderTarget, Scene, UnsignedByteType, Vector2, Vector3 } from 'three/webgpu';
import { mrt, output, pass, renderOutput, sampler, texture, uniform, uv, vec4, velocity, wgslFn } from 'three/tsl';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import reflectionShader from './screen-space-reflections.wgsl?raw';
const reflectScreen = wgslFn(reflectionShader);

function transparentPass(scene, camera, options) {
  const node = pass(scene, camera, options);
  const updateBefore = node.updateBefore;
  // Nested effects reset the renderer's clear alpha to one before their
  // dependencies render. Each scene must explicitly retain its coverage.
  node.updateBefore = function(frame) {
    const alpha = frame.renderer.getClearAlpha();
    frame.renderer.setClearAlpha(0);
    try { updateBefore.call(this, frame); }
    finally { frame.renderer.setClearAlpha(alpha); }
  };
  return node;
}

// Only the product scene enters HDR post-processing. Picking, projections
// and editor handles use the camera again after TRAA restores its jitter.
export function createJewelryPipeline(renderer, scene, editorScene = new Scene(), depthScene = new Scene(),
  { bloomStrength = 0.06, reflections = true, reflectionRadius = 16 } = {}) {
  const overlayScene = new Scene(); overlayScene.add(depthScene, editorScene);
  let camera = null, overlayCamera, scenePass, overlayPass, temporal, glow, pipeline, history;
  const previousProjection = uniform(new Matrix4()), previousInverseProjection = uniform(new Matrix4());
  const previousView = new Matrix4(), previousViewFromCurrent = uniform(new Matrix4());
  const capturedProjection = new Matrix4(), capturedInverseProjection = new Matrix4(), capturedView = new Matrix4();
  const historyValid = uniform(0), sampleIndex = uniform(0), reach = uniform(reflectionRadius);
  const reflectionCenter = uniform(new Vector3());
  const distance = uniform(1), near = uniform(0.1), intensity = uniform(1);
  const size = new Vector2(), position = new Vector3();
  let historyReady = false;
  function disposePasses() {
    pipeline?.dispose();
    if (temporal?.beautyNode?.isRTTNode) temporal.beautyNode.dispose();
    temporal?.dispose(); glow?.dispose(); scenePass?.dispose(); overlayPass?.dispose(); history?.dispose();
  }
  function build(nextCamera) {
    disposePasses(); camera = nextCamera; historyReady = false; sampleIndex.value = 0;
    scenePass = transparentPass(scene, camera, { samples: 0 });
    scenePass.setMRT(mrt(reflections ? { output, velocity, normalOctahedral: vec4(0),
      indirectSpecular: vec4(0), responseRoughness: vec4(0) } : { output, velocity }));
    let beauty = scenePass.getTextureNode('output');
    if (reflections) {
      // 32 bytes/pixel across five attachments, within baseline WebGPU limits.
      scenePass.getTexture('velocity').format = RGFormat;
      scenePass.getTexture('normalOctahedral').format = RGFormat;
      scenePass.getTexture('depth').type = FloatType;
      scenePass.getTexture('responseRoughness').type = UnsignedByteType;
      history = new RenderTarget(1, 1, { depthBuffer: false, type: HalfFloatType,
        depthTexture: new DepthTexture(1, 1, FloatType) });
      renderer.initRenderTarget(history);
      const update = scenePass.updateBefore;
      scenePass.updateBefore = function(frame) {
        capturedProjection.copy(camera.projectionMatrix);
        capturedInverseProjection.copy(camera.projectionMatrixInverse);
        camera.updateMatrixWorld(); capturedView.copy(camera.matrixWorldInverse);
        previousViewFromCurrent.value.multiplyMatrices(previousView, camera.matrixWorld);
        const materials = new Map();
        scene.traverse(object => {
          if (!object.isMesh) return;
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            if (material.reflectionMRT && !materials.has(material)) {
              materials.set(material, material.mrtNode); material.mrtNode = material.reflectionMRT;
            }
          }
        });
        try { update.call(this, frame); }
        finally { for (const [material, original] of materials) material.mrtNode = original; }
      };
      const historyNode = texture(history.texture);
      beauty = reflectScreen({ beauty, depthMap: scenePass.getTextureNode('depth'),
        normalMap: scenePass.getTextureNode('normalOctahedral'),
        indirectMap: scenePass.getTextureNode('indirectSpecular'),
        responseMap: scenePass.getTextureNode('responseRoughness'), history: historyNode,
        historyDepth: texture(history.depthTexture), linearSampler: sampler(historyNode),
        projection: uniform(camera.projectionMatrix), inverseProjection: uniform(camera.projectionMatrixInverse),
        previousProjection, previousInverseProjection, previousViewFromCurrent,
        uv: uv(), frame: sampleIndex, radius: reach, cameraDistance: distance, near,
        historyValid, intensity });
    }
    temporal = traa(beauty, scenePass.getTextureNode('depth'),
      scenePass.getTextureNode('velocity'), camera);
    if (reflections) temporal._historyRenderTarget.depthTexture.type = FloatType;
    // r186's resolve uses an opaque colorNode material, forcing alpha to one.
    // Preserve its calculated coverage while overwriting the history texture.
    temporal._resolveMaterial.transparent = true;
    temporal._resolveMaterial.blending = NoBlending;
    const resolved = temporal;
    glow = bloomStrength > 0 ? bloom(resolved.rgb, bloomStrength, 0.2, 1.25) : null;
    overlayCamera = camera.clone();
    overlayPass = transparentPass(overlayScene, overlayCamera, { samples: 4 });
    const product = renderOutput(vec4(glow ? resolved.rgb.add(glow.rgb) : resolved.rgb, resolved.a), renderer.toneMapping, renderer.outputColorSpace);
    const overlay = renderOutput(overlayPass.getTextureNode('output'), NoToneMapping, renderer.outputColorSpace);
    pipeline = new RenderPipeline(renderer, vec4(overlay.rgb.add(product.rgb.mul(overlay.a.oneMinus())),
      overlay.a.add(product.a.mul(overlay.a.oneMinus()))));
    pipeline.outputColorTransform = false;
  }
  function invalidate() {
    historyReady = false; sampleIndex.value = 0;
    if (!temporal) return;
    // Three r186 has no public history reset. Its verified resize path seeds
    // both history buffers from the new image, without rebuilding shaders.
    temporal._historyRenderTarget.setSize(0, 0);
  }
  function render(nextCamera) {
    if (camera !== nextCamera) build(nextCamera);
    overlayCamera.copy(nextCamera);
    if (reflections) {
      renderer.getDrawingBufferSize(size);
      if (history.width !== size.x || history.height !== size.y) {
        history.setSize(size.x, size.y); renderer.initRenderTarget(history); historyReady = false;
        // TRAA queries the input size before its nested RTT has rendered.
        // Synchronize it here so the first resize frame cannot copy stale
        // extents into a newly allocated smaller history texture.
        scenePass.setSize(size.x, size.y);
        temporal.beautyNode.setSize(size.x, size.y);
        renderer.initRenderTarget(temporal.beautyNode.renderTarget);
      }
      historyValid.value = historyReady ? 1 : 0;
      distance.value = nextCamera.getWorldPosition(position).distanceTo(reflectionCenter.value); near.value = nextCamera.near;
    }
    pipeline.render();
    if (reflections) {
      // The trace reads the previous resolved HDR image, including its SSR.
      // Copy after resolving to avoid reading and writing the same image.
      renderer.copyTextureToTexture(temporal._resolveRenderTarget.texture, history.texture);
      renderer.copyTextureToTexture(scenePass.getTexture('depth'), history.depthTexture);
      previousProjection.value.copy(capturedProjection);
      previousInverseProjection.value.copy(capturedInverseProjection);
      previousView.copy(capturedView); historyReady = true; sampleIndex.value++;
    }
  }
  return { render, invalidate, dispose: disposePasses, reflectionIntensity: intensity, reflectionRadius: reach, reflectionCenter };
}
