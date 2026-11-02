import { Data3DTexture, HalfFloatType, LinearFilter, RGBAFormat, CustomToneMapping,
  Matrix3, SRGBColorSpace } from 'three/webgpu';
import { Fn, mat3, texture3D, max, log2, clamp, colorSpaceToWorking } from 'three/tsl';

export const displayLutSize = 100;
export const srgbToAces = new Matrix3().set(.6130973, .3395229, .0473793,
  .0701942, .9163556, .0134526, .0206156, .1095698, .8698151);
export const exposureMultiplier = ev => 2 ** ev;

export function createLightTracerToneMapping(bytes) {
  if (bytes.byteLength !== displayLutSize ** 3 * 8) throw Error('Invalid Light Tracer display LUT');
  const texture = new Data3DTexture(new Uint16Array(bytes), displayLutSize, displayLutSize, displayLutSize);
  texture.type = HalfFloatType; texture.format = RGBAFormat;
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.generateMipmaps = false; texture.needsUpdate = true;
  const toneMapping = Fn(([color, exposure]) => {
    const aces = mat3(srgbToAces).mul(color.mul(exposure));
    const uv = clamp(log2(max(aces, 1e-20).div(.18)).add(6.5).div(13), 0, 1);
    // Use LT's native half-texel convention, rather than remapping endpoints.
    const encoded = texture3D(texture, uv).rgb;
    // LT's LUT interpolates encoded sRGB. Return linear sRGB here so Three's
    // normal output transform applies display encoding exactly once.
    return colorSpaceToWorking(encoded, SRGBColorSpace).rgb;
  });
  return { texture, toneMapping };
}

export async function installLightTracerToneMapping(renderer) {
  const response = await fetch(new URL(import.meta.env.BASE_URL + 'lt-display-lut.bin', location.href));
  if (!response.ok) throw Error('Missing Light Tracer display LUT');
  const display = createLightTracerToneMapping(await response.arrayBuffer());
  renderer.library.addToneMapping(display.toneMapping, CustomToneMapping);
  renderer.toneMapping = CustomToneMapping;
  return display;
}
