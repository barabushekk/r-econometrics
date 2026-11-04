// Генерация небесной сферы в кубическую карту (один раз при запуске).
//
// Каждый тексель хранит (ε·S, ε·S·log10 T): ε — фактор разбавления
// (яркость = ε·B(T), т.е. доля яркости абсолютно чёрного тела), T —
// цветовая температура. Обе величины линейны по ε, поэтому корректно
// усредняются в mip-уровнях. В трассировщике яркость пересчитывается для
// любого смещения частоты g: I = ε·B(g·T) — точное преобразование
// чернотельного спектра (инвариант I_ν/ν³).
//
// Небо — процедурная модель окрестностей Sgr A*, т.е. центра Галактики
// (не каталог). Наблюдатель находится внутри ядерного звёздного скопления
// (~10⁷ L☉ в нескольких парсеках): яркость неба там на 2–3 порядка выше
// земного ночного неба, сотни звёзд ярче Венеры (красные гиганты и молодые
// массивные O/B-звёзды). Слои:
//  • звёзды пяти диапазонов яркости, N(<m) ∝ 10^{0.5m}, с концентрацией
//    слабых звёзд к плоскости Галактики;
//  • диффузный свет неразрешённых звёзд балджа (почти изотропный) и диска
//    (полоса вдоль плоскости);
//  • пыль центральной молекулярной зоны и диска — тёмные прожилки,
//    покраснение;
//  • туманности: области H II и отражательные (приближённо, цветом
//    чёрного тела — в модели нет линейчатых спектров).
// Калибровка: звезда величины m и температуры T имеет Ω·ε =
// Ω☉·10^{−0.4(m − m☉)}·Y(T☉)/Y(T), Ω☉ = 6.8·10⁻⁵ ср, m☉ = −26.74.

import { PRECISION, NOISE, SPECTRUM } from './common.js';

export const SKY_SCALE = 1e10; // масштаб хранения (half float)

export function skyFrag() {
  return /* glsl */ `
${PRECISION}
in vec2 vUv;
out vec4 outColor;
uniform int uFace;
uniform float uSize;
uniform vec3 uGalPole;
uniform vec3 uGalRef;
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

float lg10(float x) { return log(x) / log(10.0); }

// Температура звезды: яркие слои — смесь красных гигантов ядерного
// скопления и молодых массивных звёзд; слабые — обычное распределение.
float starLogT(float h, int L) {
  if (L <= 1) {
    if (h < 0.32) return lg10(mix(16000.0, 38000.0, h / 0.32));
    if (h < 0.40) return lg10(mix(8000.0, 12000.0, (h - 0.32) / 0.08));
    return lg10(mix(3100.0, 4600.0, (h - 0.40) / 0.60));
  }
  if (h < 0.08) return lg10(mix(15000.0, 32000.0, h / 0.08));
  if (h < 0.22) return lg10(mix(7500.0, 15000.0, (h - 0.08) / 0.14));
  if (h < 0.40) return lg10(mix(6000.0, 7500.0, (h - 0.22) / 0.18));
  if (h < 0.58) return lg10(mix(5200.0, 6000.0, (h - 0.40) / 0.18));
  if (h < 0.88) return lg10(mix(3900.0, 5200.0, (h - 0.58) / 0.30));
  return lg10(mix(2900.0, 3900.0, (h - 0.88) / 0.12));
}

float fbm(vec3 p, int oct) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += a * vnoise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.4);
    a *= 0.5;
  }
  return s;
}

void main() {
  vec2 st = gl_FragCoord.xy / uSize;
  vec3 d = normalize(faceDir(uFace, st));
  float texAng = 1.5707963 / uSize;
  float gb = asin(clamp(dot(d, uGalPole), -1.0, 1.0)); // галактическая широта
  vec3 e2 = normalize(cross(uGalPole, uGalRef));
  float gl = atan(dot(d, e2), dot(d, uGalRef));          // галактическая долгота

  float eps = 0.0;
  float epsT = 0.0;

  for (int L = 0; L < 5; L++) {
    float N = L == 0 ? 9.0 : (L == 1 ? 24.0 : (L == 2 ? 64.0 : (L == 3 ? 150.0 : 320.0)));
    float m0 = L == 0 ? -7.5 : (L == 1 ? -2.0 : (L == 2 ? 2.5 : (L == 3 ? 6.0 : 9.0)));
    float m1 = L == 0 ? -2.0 : (L == 1 ? 2.5 : (L == 2 ? 6.0 : (L == 3 ? 9.0 : 11.5)));
    float prob = L == 0 ? 0.55 : (L == 1 ? 0.5 : (L == 2 ? 0.45 : (L == 3 ? 0.4 : 0.3)));
    float conc = L == 0 ? 0.2 : (L == 1 ? 0.4 : (L == 2 ? 0.9 : (L == 3 ? 1.8 : 3.0)));
    float cellAng = 1.0 / N;
    float sig = min(0.7 * texAng, cellAng / 3.5);
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
      float m = m1 + 2.0 * lg10(u);
      float logT = starLogT(h2.y, L);
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

  // --- диффузный свет -------------------------------------------------------
  // координаты, растянутые вдоль плоскости Галактики (без шва по долготе)
  vec3 pg = vec3(cos(gl) * 5.0, sin(gl) * 5.0, gb * 34.0);
  // балдж и ядерное скопление: почти изотропно, сплюснуто к плоскости
  float bulge = 2.2e-12 * (0.45 + 0.55 * exp(-0.5 * gb * gb / 0.25)) * (0.8 + 0.4 * fbm(d * 2.5, 3));
  // диск Галактики: полоса с неоднородностями (звёздные облака)
  float bandProf = exp(-0.5 * gb * gb / (0.10 * 0.10));
  float clumps = 0.45 + 1.1 * fbm(pg * 0.9 + d * 2.0, 5);
  // зернистость звёздных облаков (неразрешённые звёзды)
  float grain = 0.55 + 0.9 * vnoise(d * 160.0) * vnoise(d * 61.0 + 3.0) + 0.25 * vnoise(d * 340.0);
  float disk = 1.3e-11 * bandProf * clumps * max(grain, 0.2);
  // пыль: длинные волокна вдоль плоскости (центральная молекулярная зона)
  float dn = fbm(pg * 1.4 + vec3(3.1, 0.7, 5.3), 6);
  float ridge = 1.0 - abs(2.0 * fbm(pg * 2.6 + 11.0, 5) - 1.0);
  float fil = smoothstep(0.45, 1.0, ridge) * smoothstep(-0.2, 0.6, dn);
  float tauDust = 2.2 * exp(-0.5 * gb * gb / (0.045 * 0.045)) * fil
                + 0.5 * exp(-0.5 * gb * gb / (0.15 * 0.15)) * smoothstep(0.1, 0.7, dn);
  float trans = exp(-tauDust);
  // покраснение: пыль сильнее гасит синий — эффективная температура ниже
  float diffT = lg10(mix(4300.0, 5600.0, bandProf * 0.8)) - 0.1 * (1.0 - trans);
  float diffuse = (bulge + disk) * trans;
  eps += diffuse;
  epsT += diffuse * diffT;

  // туманности вблизи плоскости: ионизованный водород (красноватые) и
  // отражательные (голубые) — приближённо, через цветовую температуру
  float neb = fbm(pg * 0.6 + vec3(7.7, 1.3, 2.9), 5);
  float nebMask = smoothstep(0.25, 0.7, neb) * exp(-0.5 * gb * gb / (0.13 * 0.13));
  float neb2 = smoothstep(0.35, 0.85, fbm(d * 13.0 + 9.0, 4));
  float hii = 7e-12 * nebMask * neb2 * trans;
  float refl = 2.5e-12 * nebMask * smoothstep(0.4, 0.8, fbm(d * 9.0 + 2.0, 4)) * trans;
  eps += hii + refl;
  epsT += hii * lg10(1850.0) + refl * lg10(22000.0);

  outColor = vec4(eps * ${SKY_SCALE.toExponential()}, epsT * ${SKY_SCALE.toExponential()}, 0.0, 1.0);
}
`;
}
