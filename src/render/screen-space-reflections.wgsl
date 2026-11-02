// Independent implementation of the algorithm inspected in WebGI 0.22.0:
// jittered half-vector, perspective-correct screen march, linear crossing,
// previous HDR colour, then replacement of the environment specular term.
fn ringReflections(beauty: texture_2d<f32>, depthMap: texture_depth_2d,
  normalMap: texture_2d<f32>, indirectMap: texture_2d<f32>, responseMap: texture_2d<f32>,
  history: texture_2d<f32>, historyDepth: texture_depth_2d, linearSampler: sampler,
  projection: mat4x4<f32>, inverseProjection: mat4x4<f32>, previousProjection: mat4x4<f32>,
  previousInverseProjection: mat4x4<f32>, previousViewFromCurrent: mat4x4<f32>,
  uv: vec2<f32>, frame: f32, radius: f32, cameraDistance: f32, near: f32,
  historyValid: f32, intensity: f32) -> vec4<f32> {
  let size = vec2<i32>(textureDimensions(beauty));
  let pixel = clamp(vec2<i32>(uv * vec2<f32>(size)), vec2<i32>(0), size - vec2<i32>(1));
  let color = textureLoad(beauty, pixel, 0);
  let response = textureLoad(responseMap, pixel, 0);
  let depth = textureLoad(depthMap, pixel, 0);
  if (historyValid < 0.5 || intensity <= 0.0 || depth >= 1.0 || response.a < 0.005) { return color; }
  let surface = textureLoad(normalMap, pixel, 0);
  let rough = max(0.0, response.a - 0.01);
  if (rough >= 0.9) { return color; }
  var decoded = vec3<f32>(surface.xy, 1.0 - abs(surface.x) - abs(surface.y));
  if (decoded.z < 0.0) { decoded = vec3<f32>((1.0 - abs(decoded.yx)) * sign(decoded.xy), decoded.z); }
  let N = normalize(decoded);
  let position = reflectionView(uv, depth, inverseProjection);
  let V = select(normalize(-position), vec3<f32>(0.0, 0.0, 1.0), projection[3][3] == 1.0);
  let u = reflectionNoise(vec2<f32>(pixel), frame * 117.0);
  let v = mix(fract(u * 38.65435), 1.0, 0.7);
  let rough4 = rough * rough * rough * rough;
  let cosine = pow(max(v, 0.000001), rough4 / (2.0 - rough4));
  let sine = sqrt(max(0.0, 1.0 - cosine * cosine));
  let up = select(vec3<f32>(0.0, 0.0, 1.0), vec3<f32>(1.0, 0.0, 0.0), abs(N.z) >= 0.999);
  let X = normalize(cross(up, N));
  let Y = cross(N, X);
  let H = X * (sine * cos(6.28318530718 * u)) + Y * (sine * sin(6.28318530718 * u)) + N * cosine;
  let L = normalize(2.0 * dot(V, H) * H - V);
  if (dot(N, L) <= 0.0) { return color; }
  let frontMask = clamp(3.8 - 4.0 * dot(N, V), 0.0, 1.0);
  let border = max(0.0, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
  let fade = pow(clamp(border * border / 0.101, 0.0, 1.0), 0.3);
  let weight = clamp(intensity * (1.0 - rough * 0.3) * frontMask * fade, 0.0, 1.0);
  if (weight * length(response.rgb) <= 0.01) { return color; }
  var rayLength = clamp(mix(max(0.0, cameraDistance + radius + position.z),
    max(0.0, -position.z - max(0.0, cameraDistance - radius)), L.z * 0.5 + 0.5), radius * 0.1, radius * 5.0);
  let origin = position + N * max(-position.z * 0.0001, 0.001);
  // Clip before projecting: never divide by a zero/negative perspective w.
  if (L.z > 0.0) { rayLength = min(rayLength, max(0.0, (-near - origin.z) / L.z)); }
  if (rayLength <= 0.001) { return color; }
  let start = reflectionScreen(origin, projection);
  let end = reflectionScreen(origin + L * rayLength, projection);
  let delta = end - start;
  let tolerance = max(0.001, rayLength * 0.0625);
  let jitter = reflectionNoise(vec2<f32>(pixel), frame + 8.0);
  var previousT = 0.0;
  var previousDifference = 0.0;
  var hitT = -1.0;
  // Fixed 16 samples, randomized start; no depth pyramid or binary search.
  for (var step = 0; step < 16; step++) {
    let t = (f32(step) + jitter + 0.5) / 16.0;
    if (t > 1.0) { break; }
    let projected = start + delta * t;
    if (any(projected.xy < vec2<f32>(0.0)) || any(projected.xy >= vec2<f32>(1.0))) { break; }
    let p = clamp(vec2<i32>(projected.xy * vec2<f32>(size)), vec2<i32>(0), size - vec2<i32>(1));
    let d = textureLoad(depthMap, p, 0);
    let sceneZ = reflectionView(projected.xy, d, inverseProjection).z;
    let difference = projected.z / projected.w - sceneZ;
    // Ignore the source footprint and empty background. A first negative
    // sample inside the slab is valid, as in iJewel, even for a thin object.
    if (d < 1.0 && difference < 0.0 && difference > -tolerance && distance(vec2<f32>(p), vec2<f32>(pixel)) > 2.0) {
      let fraction = clamp(previousDifference / max(previousDifference - difference, 0.000001), 0.0, 1.0);
      hitT = mix(previousT, t, fraction);
      break;
    }
    previousDifference = difference;
    previousT = t;
  }
  if (hitT < 0.0) { return color; }
  let hit = start + delta * hitT;
  if (any(hit.xy < vec2<f32>(0.0)) || any(hit.xy >= vec2<f32>(1.0))) { return color; }
  let hitPixel = clamp(vec2<i32>(hit.xy * vec2<f32>(size)), vec2<i32>(0), size - vec2<i32>(1));
  if (distance(vec2<f32>(hitPixel), vec2<f32>(pixel)) <= 2.0) { return color; }
  let hitDepth = textureLoad(depthMap, hitPixel, 0);
  if (hitDepth >= 1.0) { return color; }
  let hitPosition = reflectionView(hit.xy, hitDepth, inverseProjection);
  let previousPosition = (previousViewFromCurrent * vec4<f32>(hitPosition, 1.0)).xyz;
  let old = reflectionScreen(previousPosition, previousProjection);
  if (old.w <= 0.0 || any(old.xy < vec2<f32>(0.0)) || any(old.xy >= vec2<f32>(1.0))) { return color; }
  let historySize = vec2<i32>(textureDimensions(historyDepth));
  let oldPixel = clamp(vec2<i32>(old.xy * vec2<f32>(historySize)), vec2<i32>(0), historySize - vec2<i32>(1));
  let oldDepth = textureLoad(historyDepth, oldPixel, 0);
  if (oldDepth >= 1.0) { return color; }
  let oldPosition = reflectionView(old.xy, oldDepth, previousInverseProjection);
  // Reject disocclusion instead of reflecting a departed object from history.
  if (abs(oldPosition.z - previousPosition.z) > max(0.01, abs(previousPosition.z) * 0.005)) { return color; }
  let hitColor = textureSampleLevel(history, linearSampler, old.xy, 0.0);
  if (hitColor.a < 0.5) { return color; }
  let environmentSpecular = textureLoad(indirectMap, pixel, 0).rgb;
  return vec4<f32>(max(vec3<f32>(0.0), color.rgb + weight * (response.rgb * hitColor.rgb - environmentSpecular)), color.a);
}

fn reflectionNoise(pixel: vec2<f32>, frame: f32) -> f32 {
  let p = pixel + vec2<f32>(frame * 5.588238);
  return fract(52.9829189 * fract(dot(p, vec2<f32>(0.06711056, 0.00583715))));
}
fn reflectionView(uv: vec2<f32>, depth: f32, inverseProjection: mat4x4<f32>) -> vec3<f32> {
  let p = inverseProjection * vec4<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth, 1.0);
  return p.xyz / p.w;
}
fn reflectionScreen(p: vec3<f32>, projection: mat4x4<f32>) -> vec4<f32> {
  let clip = projection * vec4<f32>(p, 1.0);
  return vec4<f32>(clip.x / clip.w * 0.5 + 0.5, 0.5 - clip.y / clip.w * 0.5, p.z / clip.w, 1.0 / clip.w);
}
