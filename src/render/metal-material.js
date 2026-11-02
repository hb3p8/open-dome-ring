import { MeshStandardNodeMaterial } from 'three/webgpu';
import { EnvironmentBRDF, mrt, normalView, positionViewDirection, property,
  roughness, specularColorBlended, specularF90, vec2, vec4 } from 'three/tsl';

const indirect = property('vec3', 'ringIndirectSpecular');
const response = property('vec3', 'ringReflectionResponse');

// Keep Three's complete lighting model. The SSR composite replaces only its
// indirect specular term; direct lights, diffuse and emissive are preserved.
export class ReflectionMetalMaterial extends MeshStandardNodeMaterial {
  constructor(parameters) {
    super(parameters);
    const projected = normalView.div(normalView.x.abs().add(normalView.y.abs()).add(normalView.z.abs()));
    const sign = vec2(projected.x.lessThan(0).select(-1, 1), projected.y.lessThan(0).select(-1, 1));
    const octahedral = projected.z.lessThan(0).select(projected.yx.abs().oneMinus().mul(sign), projected.xy);
    this.reflectionMRT = mrt({ normalOctahedral: vec4(octahedral, 0, 0),
      indirectSpecular: vec4(indirect, 0), responseRoughness: vec4(response, roughness.add(0.01).min(1)) });
  }
  setupLightingModel(builder) {
    const model = super.setupLightingModel(builder);
    const finish = model.finish.bind(model);
    model.finish = builder => {
      finish(builder);
      indirect.assign(builder.context.reflectedLight.indirectSpecular);
      response.assign(EnvironmentBRDF({ dotNV: normalView.dot(positionViewDirection).clamp(),
        specularColor: specularColorBlended, specularF90, roughness }));
    };
    return model;
  }
}
