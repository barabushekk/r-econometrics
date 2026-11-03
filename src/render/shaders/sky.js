// Генерация небесной сферы в кубическую карту (один раз при запуске).
//
// Каждый тексель хранит (ε·S, ε·S·log10 T): ε — фактор разбавления
// (яркость = ε·B(T), т.е. доля яркости абсолютно чёрного тела), T —
// цветовая температура. Обе величины линейны по ε, поэтому корректно
// усредняются в mip-уровнях. В трассировщике яркость пересчитывается для
// любого смещения частоты g: I = ε·B(g·T) — точное преобразование
// чернотельного спектра (инвариант I_ν/ν³).
//
// Небо — процедурная модель окрестностей центра Галактики (не каталог):
// звёзды четырёх слоёв яркости со степенным распределением звёздных величин
// (N(<m) ∝ 10^{0.5m}) и реалистичным распределением спектральных классов,
// плюс диффузное свечение диска Галактики с пылевыми прожилками.
// Калибровка: звезда величины m и температуры T имеет телесный угол
// Ω·ε = Ω☉·10^{−0.4(m − m☉)}·Y(T☉)/Y(T), Ω☉ = 6.8·10⁻⁵ ср, m☉ = −26.74.

import { PRECISION, NOISE, SPECTRUM } from './common.js';

export const SKY_SCALE = 1e12; // масштаб хранения (half float)

export function skyFrag() {
  return /* glsl */ `
${PRECISION}
in vec2 vUv;
out vec4 outColor;
uniform int uFace;
uniform float uSize;
uniform vec3 uGalPole;
${SPECTRUM}
${NOISE}

vec3 faceDir(int face, vec2 st) {
  vec2 c = st * 2.0 - 1.0;
  if (face == 0) return vec3(1.0, -c.y, -c.x);
  if (face == 1) return vec3(-1.0, -c.y, c.x);
  if (face == 2) return vec3(c.x, 1.0, c.y);
  if (face == 3) return vec3(c.x, -1.0, -c.y);
  if (face == 4) return vec3(c.x, -c.y, 1.0);
  return vec3(-c.x, -c.y, -1.0);
}

// Температура звезды по случайному числу (доли классов для ярких звёзд)
float starLogT(float h) {
  if (h < 0.06) return log(mix(15000.0, 32000.0, h / 0.06)) / log(10.0);   // O/B
  if (h < 0.22) return log(mix(7500.0, 15000.0, (h - 0.06) / 0.16)) / log(10.0); // A
  if (h < 0.40) return log(mix(6000.0, 7500.0, (h - 0.22) / 0.18)) / log(10.0);  // F
  if (h < 0.58) return log(mix(5200.0, 6000.0, (h - 0.40) / 0.18)) / log(10.0);  // G
  if (h < 0.88) return log(mix(3900.0, 5200.0, (h - 0.58) / 0.30)) / log(10.0);  // K (гиганты)
  return log(mix(2800.0, 3900.0, (h - 0.88) / 0.12)) / log(10.0);               // M
}

void main() {
  vec2 st = gl_FragCoord.xy / uSize;
  vec3 d = normalize(faceDir(uFace, st));
  float texAng = 1.5707963 / uSize;
  float gb = asin(clamp(dot(d, uGalPole), -1.0, 1.0)); // галактическая широта
  float band = exp(-0.5 * gb * gb / (0.09 * 0.09));
  float bandWide = exp(-0.5 * gb * gb / (0.35 * 0.35));

  float eps = 0.0;
  float epsT = 0.0;

  // слои: масштаб сетки, диапазон величин, вероятность, концентрация к плоскости
  for (int L = 0; L < 4; L++) {
    float N = L == 0 ? 14.0 : (L == 1 ? 40.0 : (L == 2 ? 110.0 : 280.0));
    float m0 = L == 0 ? -2.0 : (L == 1 ? 4.0 : (L == 2 ? 7.0 : 9.5));
    float m1 = L == 0 ? 4.0 : (L == 1 ? 7.0 : (L == 2 ? 9.5 : 12.0));
    float prob = L == 0 ? 0.45 : (L == 1 ? 0.35 : (L == 2 ? 0.30 : 0.22));
    float conc = L == 0 ? 0.3 : (L == 1 ? 0.8 : (L == 2 ? 1.6 : 2.6));
    float cellAng = 1.0 / N;
    float sig = min(0.75 * texAng, cellAng / 3.5);
    vec3 q = d * N;
    vec3 c0 = floor(q);
    for (int i = -1; i <= 1; i++)
    for (int j = -1; j <= 1; j++)
    for (int k = -1; k <= 1; k++) {
      vec3 cell = c0 + vec3(float(i), float(j), float(k));
      vec4 h = hash43(cell + float(L) * 131.7);
      vec3 sp = cell + h.xyz;
      float rr = length(sp);
      if (rr < N - 0.5 || rr >= N + 0.5) continue;
      vec3 sdir = sp / rr;
      float gbs = asin(clamp(dot(sdir, uGalPole), -1.0, 1.0));
      float pr = prob * (1.0 + conc * exp(-0.5 * gbs * gbs / 0.04)) / (1.0 + conc * 0.35);
      if (h.w > pr) continue;
      vec4 h2 = hash43(cell * 1.37 + float(L) * 57.1 + 3.1);
      float u = mix(pow(10.0, -0.5 * (m1 - m0)), 1.0, h2.x);
      float m = m1 + 2.0 * log(u) / log(10.0);
      float logT = starLogT(h2.y);
      float Yrel = exp2(specRow(logT, 0).a * LOG2_10);
      float omegaEps = 6.8e-5 * pow(10.0, -0.4 * (m + 26.74)) / Yrel;
      vec3 dd = d - sdir;
      float th2 = dot(dd, dd);
      float psf = exp(-0.5 * th2 / (sig * sig)) / (6.2831853 * sig * sig);
      float e = omegaEps * psf;
      eps += e;
      epsT += e * logT;
    }
  }

  // диффузный фон: неразрешённые звёзды диска и балджа + пылевые прожилки
  float dust = 0.5 + 0.5 * vnoise(d * 9.0) + 0.25 * vnoise(d * 23.0);
  float lanes = smoothstep(0.15, 0.85, dust);
  float lane2 = 1.0 - 0.75 * exp(-0.5 * gb * gb / (0.025 * 0.025)) * smoothstep(0.2, 0.7, 0.5 + 0.5 * vnoise(d * 15.0 + 4.0));
  float diffuse = (3.5e-13 * band * lanes * lane2 + 5e-14 * bandWide + 1.2e-14) * (0.8 + 0.4 * (0.5 + 0.5 * vnoise(d * 40.0)));
  float diffT = mix(log(4200.0), log(5200.0), 0.5 + 0.5 * vnoise(d * 5.0)) / log(10.0);
  eps += diffuse;
  epsT += diffuse * diffT;

  outColor = vec4(eps * ${SKY_SCALE.toExponential()}, epsT * ${SKY_SCALE.toExponential()}, 0.0, 1.0);
}
`;
}
