// Постобработка: накопление кадров, измерение яркости, адаптация
// экспозиции, оптическое рассеяние (bloom), тональная компрессия,
// ложные цвета ИК/научного режимов, финальный вывод.

import { PRECISION } from './common.js';

// Временное накопление (temporal accumulation) для неподвижной камеры
export const ACCUM_FRAG = /* glsl */ `
${PRECISION}
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uCur;
uniform sampler2D uPrev;
uniform float uAlpha;
void main() {
  vec4 c = texture(uCur, vUv);
  vec4 p = texture(uPrev, vUv);
  outColor = mix(p, c, uAlpha);
}
`;

// Статистика яркости (центровзвешенная) → mip-цепочка → средние по кадру.
// Экспозиция хранится в 1×1 текстуре как log₂: (пред-экспозиция, ночная, дневная).
// Проход 0: лог-среднее по освещённым пикселям и второй момент яркости в
// «дневной» экспозиции; проход 1: лог-среднее по пикселям, не насыщенным в
// «ночной» экспозиции (фон неба, звёзды).
export const LUM_FRAG = /* glsl */ `
${PRECISION}
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uHdr;
uniform sampler2D uExp;
uniform int uBand;
uniform int uPass;
void main() {
  vec3 c = texture(uHdr, vUv).rgb;
  float L = uBand == 0 ? dot(c, vec3(0.2126, 0.7152, 0.0722)) : c.r;
  vec4 e = texelFetch(uExp, ivec2(0, 0), 0);
  float la = max(log2(max(L, 1e-37)) - e.r, -64.0); // абсолютный log₂ яркости
  float lit = step(-58.0, la);                       // тень (нулевая яркость) не учитывается
  vec2 d = vUv - 0.5;
  float w = exp(-dot(d, d) * 6.0);
  if (uPass == 0) {
    float Lh = min(exp2(la + e.b), 200.0) / 16.0;
    outColor = vec4(w * lit * la, w * Lh * Lh, w, w * lit);
  } else {
    float Ll = exp2(la + e.g);
    float wd = w * lit * (1.0 - smoothstep(1.0, 3.0, Ll));
    outColor = vec4(wd * la, wd, 0.0, 1.0);
  }
}
`;

// Адаптация экспозиции. Выход: (log₂E_пред, log₂E_ночн, log₂E_дневн).
//  0 — «Глаз»: модель зрения с двумя адаптациями (слияние в тонмаппинге):
//      дневная — по ярким областям, ночная — по фону; ночная ограничена
//      пределом скотопической чувствительности;
//  1 — «Камера»: одна экспозиция по ярким областям (физическая фотометрия);
//  2 — «По фону»: одна экспозиция по фону неба (звёзды видны, диск пересвечен);
//  3 — ручная.
export const EXPOSURE_FRAG = /* glsl */ `
${PRECISION}
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uLum;
uniform sampler2D uLumDark;
uniform sampler2D uPrevExp;
uniform float uLodMax;
uniform int uMode;
uniform float uEV;
uniform float uManual;
uniform float uRate;
uniform float uReset;
void main() {
  vec4 s = textureLod(uLum, vec2(0.5), uLodMax);
  vec4 sd = textureLod(uLumDark, vec2(0.5), uLodMax);
  vec4 prev = texelFetch(uPrevExp, ivec2(0, 0), 0);
  float w = max(s.b, 1e-6);
  float logAvg = s.a > 1e-5 ? s.r / s.a : -40.0;
  float logRms = 4.0 + 0.5 * log2(max(s.g / w, 1e-30)) - prev.b;
  float logDark = sd.g > 1e-4 ? sd.r / sd.g : logAvg;
  float tRms = log2(0.55) - logRms;
  float tDark = log2(0.035) - logDark; // ночной ключ: тёмный фон остаётся тёмным
  const float SCOTOPIC = 36.0; // предел ночной адаптации глаза
  float lo;
  float hi;
  if (uMode == 0) {
    hi = min(tRms + 1.0, SCOTOPIC);
    lo = clamp(tDark, hi, SCOTOPIC);
  } else if (uMode == 1) {
    hi = min(tRms + 1.0, SCOTOPIC);
    lo = hi;
  } else if (uMode == 2) {
    lo = min(tDark, SCOTOPIC);
    hi = lo;
  } else {
    lo = uManual;
    hi = uManual;
  }
  if (uMode != 3) {
    lo += uEV;
    hi += uEV;
  }
  vec2 tgt = clamp(vec2(lo, hi), -30.0, 48.0);
  vec2 nv = uReset > 0.5 ? tgt : mix(prev.gb, tgt, uRate);
  outColor = vec4(0.5 * (nv.x + nv.y), nv.x, nv.y, 1.0);
}
`;

// Bloom: понижение разрешения 13 отсчётами (COD:AW, Jimenez 2014)
export const DOWN_FRAG = /* glsl */ `
${PRECISION}
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSrc;
uniform sampler2D uExp;
uniform vec2 uTexel;
uniform float uCap; // в единицах «дневной» экспозиции; 0 — без ограничения
float capV;
vec3 cap(vec3 c) { float m = max(max(c.r, c.g), max(c.b, 1e-30)); return c * min(1.0, capV / m); }
void main() {
  vec4 ex = texelFetch(uExp, ivec2(0, 0), 0);
  capV = uCap > 0.0 ? uCap * exp2(ex.r - ex.b) : 3.0e38;
  vec2 t = uTexel;
  vec3 a = texture(uSrc, vUv + t * vec2(-2, 2)).rgb;
  vec3 b = texture(uSrc, vUv + t * vec2(0, 2)).rgb;
  vec3 c = texture(uSrc, vUv + t * vec2(2, 2)).rgb;
  vec3 d = texture(uSrc, vUv + t * vec2(-2, 0)).rgb;
  vec3 e = texture(uSrc, vUv).rgb;
  vec3 f = texture(uSrc, vUv + t * vec2(2, 0)).rgb;
  vec3 g = texture(uSrc, vUv + t * vec2(-2, -2)).rgb;
  vec3 h = texture(uSrc, vUv + t * vec2(0, -2)).rgb;
  vec3 i = texture(uSrc, vUv + t * vec2(2, -2)).rgb;
  vec3 j = texture(uSrc, vUv + t * vec2(-1, 1)).rgb;
  vec3 k = texture(uSrc, vUv + t * vec2(1, 1)).rgb;
  vec3 l = texture(uSrc, vUv + t * vec2(-1, -1)).rgb;
  vec3 m = texture(uSrc, vUv + t * vec2(1, -1)).rgb;
  vec3 o = cap(e) * 0.125 + (cap(a) + cap(c) + cap(g) + cap(i)) * 0.03125 + (cap(b) + cap(d) + cap(f) + cap(h)) * 0.0625 + (cap(j) + cap(k) + cap(l) + cap(m)) * 0.125;
  outColor = vec4(o, 1.0);
}
`;

export const UP_FRAG = /* glsl */ `
${PRECISION}
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSrc;
uniform sampler2D uBase;
uniform vec2 uTexel;
uniform float uMix;
void main() {
  vec2 t = uTexel;
  vec3 s = texture(uSrc, vUv + t * vec2(-1, 1)).rgb + 2.0 * texture(uSrc, vUv + t * vec2(0, 1)).rgb + texture(uSrc, vUv + t * vec2(1, 1)).rgb
         + 2.0 * texture(uSrc, vUv + t * vec2(-1, 0)).rgb + 4.0 * texture(uSrc, vUv).rgb + 2.0 * texture(uSrc, vUv + t * vec2(1, 0)).rgb
         + texture(uSrc, vUv + t * vec2(-1, -1)).rgb + 2.0 * texture(uSrc, vUv + t * vec2(0, -1)).rgb + texture(uSrc, vUv + t * vec2(1, -1)).rgb;
  s /= 16.0;
  vec3 b = texture(uBase, vUv).rgb;
  outColor = vec4(mix(b, s, uMix), 1.0);
}
`;

// Тональная компрессия и ложные цвета
export const TONEMAP_FRAG = /* glsl */ `
${PRECISION}
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uHdr;
uniform sampler2D uBloom;
uniform sampler2D uExposure;
uniform float uBloomI;
uniform float uFusion;
uniform sampler2D uPrevExposure;
uniform int uBand;
uniform float uVignette;
uniform float uBlackout; // 0..1, затемнение при завершении
uniform float uTime;

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
float acesS(float x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
// палитра «inferno»-подобная (полиномиальная аппроксимация)
vec3 thermal(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.0002, 0.0016, -0.0194);
  vec3 c1 = vec3(0.1065, 0.5639, 3.9327);
  vec3 c2 = vec3(11.6024, -3.9728, -15.9423);
  vec3 c3 = vec3(-41.7039, 17.4363, 44.3541);
  vec3 c4 = vec3(77.1629, -33.4023, -81.8073);
  vec3 c5 = vec3(-71.3194, 32.6260, 73.2095);
  vec3 c6 = vec3(25.1311, -12.2427, -23.0703);
  return clamp(c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6))))), 0.0, 1.0);
}
// расходящаяся шкала для log2 g: синий — синее смещение, красный — красное
vec3 diverging(float lg) {
  float t = clamp(lg / 1.2, -1.0, 1.0);
  vec3 neutral = vec3(0.92);
  vec3 blue = vec3(0.15, 0.45, 1.0);
  vec3 red = vec3(1.0, 0.25, 0.1);
  return t > 0.0 ? mix(neutral, blue, t) : mix(neutral, red, -t);
}
void main() {
  vec4 h = texture(uHdr, vUv);
  vec4 bl = texture(uBloom, vUv);
  vec4 e = texelFetch(uExposure, ivec2(0, 0), 0);
  float pre = texelFetch(uPrevExposure, ivec2(0, 0), 0).r; // HDR записан с этой экспозицией
  vec4 cHi = mix(h, bl, uBloomI) * exp2(e.b - pre);
  vec4 cLo = h * exp2(e.g - pre);
  // Слияние двух адаптаций (модель зрения): T = T_дн + w·T_ночн·(1 − T_дн).
  // Функция монотонна по яркости, поэтому не создаёт ореолов.
  float wf = (uFusion > 0.0 && e.g - e.b > 0.25) ? uFusion : 0.0;
  // Ночная ветвь сохраняет цвет пикселя (оранжевый газ остаётся оранжевым,
  // а не серым) и имеет логарифмическое «плечо» до уровня насыщения дневной
  // экспозиции, чтобы слабые части диска сохраняли градации яркости.
  float span = log2(1.0 + 4.0 * exp2(max(e.g - e.b, 0.0)));
  vec3 o;
  if (uBand == 0) {
    vec3 tHi = aces(cHi.rgb);
    float Ll = max(dot(cLo.rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-30);
    float tl = 0.5 * acesS(Ll) + 0.5 * clamp(log2(1.0 + Ll) / span, 0.0, 1.0);
    vec3 chroma = cLo.rgb / Ll;
    vec3 tLo = chroma * tl;
    tLo /= max(1.0, max(tLo.r, max(tLo.g, tLo.b)));
    tLo = mix(tLo, vec3(tl), 0.25 * smoothstep(0.6, 1.0, tl)); // лёгкое выцветание у самого белого
    o = tHi + wf * tLo * (1.0 - tHi);
  } else if (uBand == 1) {
    float v = acesS(cHi.r);
    v = v + wf * (0.5 * acesS(cLo.r) + 0.5 * clamp(log2(1.0 + max(cLo.r, 0.0)) / span, 0.0, 1.0)) * (1.0 - v);
    o = thermal(pow(v, 0.8));
  } else {
    float lg = cHi.g / max(cHi.r, 1e-30);
    float v = acesS(cHi.r);
    v = v + wf * (0.5 * acesS(cLo.r) + 0.5 * clamp(log2(1.0 + max(cLo.r, 0.0)) / span, 0.0, 1.0)) * (1.0 - v);
    o = diverging(lg) * pow(v, 0.9);
  }
  vec2 d = vUv - 0.5;
  o *= 1.0 - uVignette * dot(d, d) * 1.2;
  o *= 1.0 - uBlackout;
  outColor = vec4(o, 1.0);
}
`;

// Финальный вывод: линейный → sRGB, лёгкий дизеринг
export const OUTPUT_FRAG = /* glsl */ `
${PRECISION}
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSrc;
uniform float uFlash;
uniform vec3 uFlashColor;
float rnd(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 toSRGB(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec3 c = texture(uSrc, vUv).rgb;
  c = mix(c, uFlashColor, uFlash);
  vec3 s = toSRGB(c) + (rnd(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(s, 1.0);
}
`;

// Отбор освещённости 4×4 (для подсветки кабины светом снаружи)
export const PROBE_FRAG = /* glsl */ `
${PRECISION}
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSrc;
void main() {
  vec3 s = vec3(0.0);
  vec2 cell = floor(vUv * 4.0);
  for (int i = 0; i < 8; i++)
    for (int j = 0; j < 8; j++) {
      vec2 uv = (cell + (vec2(float(i), float(j)) + 0.5) / 8.0) / 4.0;
      s += texture(uSrc, uv).rgb;
    }
  outColor = vec4(s / 64.0, 1.0);
}
`;

// Фон кабины: готовое (тонально сжатое) изображение снаружи
export const BACKGROUND_FRAG = /* glsl */ `
${PRECISION}
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uView;
void main() { outColor = vec4(texture(uView, vUv).rgb, 1.0); }
`;
