import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';

// Export the current vertex buffers, including the envelope's transformed
// smooth normals. The CAD coordinates are already expressed in millimetres.
export function exportEnvelopeOBJ(ring) {
  ring.updateMatrixWorld(true);
  return '# Open dome ring; units: millimetres; smooth vertex normals\n' + new OBJExporter().parse(ring);
}
