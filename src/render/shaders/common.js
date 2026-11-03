// Общие фрагменты GLSL ES 3.00.

export const FULLSCREEN_VERT = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const PRECISION = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp samplerCube;
`;

// Хеш и шум (собственная реализация: хеш на основе дробных частей,
// квинтическая интерполяция значений).
export const NOISE = /* glsl */ `
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
vec4 hash43(vec3 p) {
  vec4 q = fract(vec4(p.xyzx) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  q += dot(q, q.wzxy + 33.33);
  return fract((q.xxyz + q.yzzw) * q.zywx);
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1, 0, 0));
  float n010 = hash13(i + vec3(0, 1, 0));
  float n110 = hash13(i + vec3(1, 1, 0));
  float n001 = hash13(i + vec3(0, 0, 1));
  float n101 = hash13(i + vec3(1, 0, 1));
  float n011 = hash13(i + vec3(0, 1, 1));
  float n111 = hash13(i + vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
             mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z) * 2.0 - 1.0;
}
`;

// Доступ к спектральной таблице (см. src/physics/spectrum.js)
export const SPECTRUM = /* glsl */ `
uniform sampler2D uSpec;
const float LOGT_MIN = 2.0;
const float LOGT_MAX = 9.5;
const float SPEC_SIZE = 1024.0;
const float LOG2_10 = 3.321928095;
vec4 specRow(float logT, int row) {
  float u = clamp((logT - LOGT_MIN) / (LOGT_MAX - LOGT_MIN), 0.0, 1.0) * (SPEC_SIZE - 1.0);
  float fi = floor(u);
  int i0 = int(fi);
  int i1 = min(i0 + 1, int(SPEC_SIZE) - 1);
  return mix(texelFetch(uSpec, ivec2(i0, row), 0), texelFetch(uSpec, ivec2(i1, row), 0), u - fi);
}
// Яркость чёрного тела температуры 10^logT в выбранном диапазоне,
// в единицах яркости поверхности Солнца.
vec3 blackbody(float logT, int band) {
  if (logT < LOGT_MIN) return vec3(0.0);
  if (band == 0) {
    vec4 v = specRow(logT, 0);
    return v.rgb * exp2(v.a * LOG2_10);
  }
  vec4 w = specRow(logT, 1);
  if (band == 1) return vec3(exp2(w.r * LOG2_10));
  return vec3(exp2(w.g * LOG2_10));
}
`;
