// AI Sprite Studio — GPU chroma key (PixiJS v8 filter)
//
// A soft key in a GLSL fragment shader, so moving the similarity slider only
// updates a uniform instead of re-keying millions of pixels on the main thread.
// The shader is compiled by WebGL; nothing here evaluates code at runtime.
// It is written for GLSL ES 1.00 through PixiJS's compatibility defines
// (`in`, `finalColor`, `texture`), so it runs on WebGL1 and WebGL2.
import { Filter, defaultFilterVert } from 'pixi.js';
import { CHROMA_DEFAULTS, spillMask } from './chroma.js';

const fragment = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec3 uKey;          // key colour, 0..1
uniform vec3 uSpillMask;    // one-hot dominant channel of the key, or zero
uniform float uSimilarity;  // normalised RGB distance keyed out completely
uniform float uSmoothness;  // width of the soft edge above uSimilarity
uniform float uSpill;       // spill suppression strength, 0..1
uniform float uKeyEnabled;  // 0 passes colour through (tint still applies)
uniform vec4 uTint;         // applied after keying: rgb multiplier, alpha
uniform float uStraight;    // 1 writes straight alpha (export), 0 premultiplied (display)

void main(void)
{
    vec4 color = texture(uTexture, vTextureCoord);
    // Filter input is premultiplied; compare and correct straight colour.
    vec3 rgb = color.a > 0.0 ? color.rgb / color.a : vec3(0.0);
    float keep = clamp((distance(rgb, uKey) * 0.57735 - uSimilarity) / max(uSmoothness, 0.0001), 0.0, 1.0);
    keep = mix(1.0, keep, uKeyEnabled);

    // Spill: pull the key's dominant channel down toward the other two on soft edges.
    float dominant = dot(rgb, uSpillMask);
    vec3 others = rgb * (vec3(1.0) - uSpillMask);
    float excess = max(dominant - max(max(others.r, others.g), others.b), 0.0);
    rgb -= uSpillMask * excess * (1.0 - keep) * uSpill * uKeyEnabled;

    float alpha = color.a * keep * uTint.a;
    // Over a cleared target the filter output is stored as-is, so straight output
    // reads back with correct edges (PixiJS's extract treats pixels as straight).
    finalColor = vec4(rgb * uTint.rgb * mix(alpha, 1.0, uStraight), alpha);
}
`;

/**
 * Create a chroma-key filter. Keying starts disabled; see setChromaUniforms().
 * @param {{ tint?: [number, number, number, number], straightAlpha?: boolean }} [options]
 *   `tint`: colour multiplier applied after keying (the onion-skin sprites use it,
 *   since a sprite tint would change the colour before the key sees it).
 *   `straightAlpha`: for rendering into a texture that is read back (export).
 * @returns {Filter}
 */
export function createChromaFilter({ tint = [1, 1, 1, 1], straightAlpha = false } = {}) {
  return Filter.from({
    gl: { vertex: defaultFilterVert, fragment },
    resources: {
      chromaUniforms: {
        uKey: { value: new Float32Array(3), type: 'vec3<f32>' },
        uSpillMask: { value: new Float32Array(3), type: 'vec3<f32>' },
        uSimilarity: { value: CHROMA_DEFAULTS.similarity, type: 'f32' },
        uSmoothness: { value: CHROMA_DEFAULTS.smoothness, type: 'f32' },
        uSpill: { value: CHROMA_DEFAULTS.spill, type: 'f32' },
        uKeyEnabled: { value: 0, type: 'f32' },
        uTint: { value: new Float32Array(tint), type: 'vec4<f32>' },
        uStraight: { value: straightAlpha ? 1 : 0, type: 'f32' },
      },
    },
    resolution: 'inherit', // follow the renderer (high-DPI) instead of the filter default of 1
  });
}

/**
 * Point a filter at a key colour, or pass colour through when `key` is null.
 * @param {Filter} filter
 * @param {{ key: [number, number, number] | null, similarity?: number, smoothness?: number, spill?: number }} settings
 */
export function setChromaUniforms(filter, { key, similarity, smoothness, spill }) {
  const uniforms = filter.resources.chromaUniforms.uniforms;
  uniforms.uKeyEnabled = key ? 1 : 0;
  if (key) {
    uniforms.uKey.set(key.map((channel) => channel / 255));
    uniforms.uSpillMask.set(spillMask(key));
  }
  uniforms.uSimilarity = similarity ?? CHROMA_DEFAULTS.similarity;
  uniforms.uSmoothness = smoothness ?? CHROMA_DEFAULTS.smoothness;
  uniforms.uSpill = spill ?? CHROMA_DEFAULTS.spill;
}
