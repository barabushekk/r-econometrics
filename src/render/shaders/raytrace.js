// Шейдер трассировки световых лучей в метрике Керра (Керр–Шилд).
// Алгоритм — точная копия src/physics/photon.js (там же тесты корректности).
//
// Для каждого пикселя:
//  1) направление взгляда n в системе камеры → ковектор p = −u + n^a e_a
//     (тетрада камеры = тетрада корабля × поворот головы), p·u_cam = 1;
//  2) интегрирование гамильтоновых уравнений назад во времени методом РК4
//     с адаптивным шагом (∝ расстоянию до центра, мельче у горизонта,
//     фотонной сферы и внутри диска);
//  3) вдоль луча — перенос излучения в объёмном диске:
//       dI = T·(1 − e^{−dτ})·B(g·T_газа),  T ← T·e^{−dτ},
//     g = 1/(p·u_газа) — полное отношение частот (гравитационное + доплер),
//     dτ = κρ·ds, ds = (p·u_газа)·dλ — длина пути в системе газа;
//  4) ушедший луч берёт яркость неба по асимптотическому направлению с
//     учётом смещения частоты g = 1/p_t;
//  5) луч, прижимающийся к горизонту (|dt/dλ| ≫ |dx/dλ|) — чёрный (тень).
//
// Выход: линейная яркость × экспозиция предыдущего кадра (pre-exposure),
// для научного режима — (I_бол, I_бол·log₂g).

import { PRECISION, NOISE, SPECTRUM } from './common.js';

export function raytraceFrag({ maxSteps = 512, noiseOctaves = 3 } = {}) {
  return /* glsl */ `
${PRECISION}
in vec2 vUv;
out vec4 outColor;

uniform vec2 uRes;
uniform vec2 uJitter;
uniform mat4 uProjInv;
uniform mat3 uCamRot;
uniform vec3 uCamPos;
uniform vec4 uU;
uniform vec4 uE1;
uniform vec4 uE2;
uniform vec4 uE3;
uniform float uSpin;
uniform float uRPlus;
uniform float uEscapeR;
uniform float uStepScale;
uniform int uMaxSteps;
uniform int uBand;

uniform float uDiskOn;
uniform float uRin;
uniform float uRout;
uniform float uSqrtRin;
uniform float uSqrtRout;
uniform float uHr;
uniform float uTau0;
uniform float uTurb;
uniform float uDiskTime;
uniform sampler2D uDiskLUT;

uniform samplerCube uSky;
uniform float uSkyScale;
uniform float uSkyOn;
uniform float uSkyGrid;
uniform float uDebugFlatSky; // тестовый режим: ушедший луч = 1 (маска тени)
uniform sampler2D uExposure;
uniform float uClampMax;

${SPECTRUM}
${NOISE}

#define MAX_STEPS ${maxSteps}
#define NOISE_OCT ${noiseOctaves}

// Правая часть гамильтоновых уравнений. Возвращает r (сфероидальный радиус).
float deriv(vec3 x, vec3 p, float pt, out vec3 dx, out vec3 dp, out float dt) {
  float a = uSpin;
  float a2 = a * a;
  float z = x.z;
  float w = dot(x, x) - a2;
  float disc = sqrt(w * w + 4.0 * a2 * z * z);
  float r2 = (w >= 0.0) ? 0.5 * (w + disc) : (2.0 * a2 * z * z) / (disc - w);
  float r = sqrt(r2);
  float r3 = r2 * r;
  float r4 = r2 * r2;
  float invD = 1.0 / (r4 + a2 * z * z);
  float f = 2.0 * r3 * invD;
  float inv = 1.0 / (r2 + a2);
  vec3 l = vec3((r * x.x + a * x.y) * inv, (r * x.y - a * x.x) * inv, z / r);
  vec3 gr = vec3(x.x * r3, x.y * r3, z * r * (r2 + a2)) * invD;
  float s = -pt + dot(l, p);
  float dfdr = 2.0 * r2 * (3.0 * a2 * z * z - r4) * invD * invD;
  vec3 gf = dfdr * gr;
  gf.z -= 4.0 * r3 * a2 * z * invD * invD;
  float A = x.x * p.x + x.y * p.y;
  float B = x.y * p.x - x.x * p.y;
  float dLdr = (A * (a2 - r2) - 2.0 * a * r * B) * inv * inv - z * p.z / r2;
  vec3 gL = vec3((r * p.x - a * p.y) * inv, (r * p.y + a * p.x) * inv, p.z / r) + dLdr * gr;
  dx = p - f * s * l;
  dp = 0.5 * s * s * gf + f * s * gL;
  dt = -pt + f * s;
  return r;
}

// r и f, l без производных (для 4-скорости газа)
float ksBasic(vec3 x, out float f, out vec3 l) {
  float a = uSpin;
  float a2 = a * a;
  float z = x.z;
  float w = dot(x, x) - a2;
  float disc = sqrt(w * w + 4.0 * a2 * z * z);
  float r2 = (w >= 0.0) ? 0.5 * (w + disc) : (2.0 * a2 * z * z) / (disc - w);
  float r = sqrt(r2);
  f = 2.0 * r2 * r / (r2 * r2 + a2 * z * z);
  float inv = 1.0 / (r2 + a2);
  l = vec3((r * x.x + a * x.y) * inv, (r * x.y - a * x.x) * inv, z / r);
  return r;
}

float stepSize(float r, float R) {
  float near = max(abs(r - uRPlus), 0.04);
  return uStepScale * min(R, 0.6 * R + 2.5 * near) + 0.002;
}

float diskLogTeff(float r) {
  float u = clamp((sqrt(r) - uSqrtRin) / (uSqrtRout - uSqrtRin), 0.0, 1.0) * 511.0;
  float fi = floor(u);
  int i0 = int(fi);
  int i1 = min(i0 + 1, 511);
  return mix(texelFetch(uDiskLUT, ivec2(i0, 0), 0).r, texelFetch(uDiskLUT, ivec2(i1, 0), 0).r, u - fi);
}

// Приближение erfc (Abramowitz & Stegun 7.1.26), x ≥ 0
float erfcApprox(float x) {
  float t = 1.0 / (1.0 + 0.3275911 * x);
  float y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return y * exp(-x * x);
}

// Турбулентная структура газа: шум в лог-полярных координатах (размер
// неоднородностей ∝ r), снесённый кеплеровским вращением со сдвигом.
// Двухфазная схема с перекрёстным затуханием ограничивает «наматывание».
float turbulence(vec3 x, float r, float phi, float tEmit) {
  float Om = 1.0 / (r * sqrt(r) + uSpin);
  float Tc = 2.0 * 6.2831853 / Om;
  float ph = tEmit / Tc;
  float c0 = fract(ph);
  float c1 = fract(ph + 0.5);
  float k0 = floor(ph);
  float k1 = floor(ph + 0.5);
  float lr = log(r);
  float zH = x.z / (uHr * r);
  float res = 0.0;
  for (int lay = 0; lay < 2; lay++) {
    float c = lay == 0 ? c0 : c1;
    float kk = lay == 0 ? k0 : k1;
    float ang = phi - Om * c * Tc;
    vec3 q = vec3(cos(ang), sin(ang), 0.0);
    float n = 0.0;
    float amp = 0.55;
    float fr = 1.0;
    for (int o = 0; o < NOISE_OCT; o++) {
      // анизотропия: вытянутые по азимуту структуры (сдвиговое течение)
      vec3 P = vec3(q.xy * 5.0 * fr, lr * 16.0 * fr + zH * 0.35 * fr) + vec3(kk * 17.31, kk * 3.77, kk * 11.1);
      n += amp * vnoise(P);
      fr *= 2.17;
      amp *= 0.5;
    }
    res += (1.0 - abs(2.0 * c - 1.0)) * n;
  }
  return res;
}

void main() {
  vec2 frag = gl_FragCoord.xy + uJitter;
  vec2 ndc = frag / uRes * 2.0 - 1.0;
  vec4 vp = uProjInv * vec4(ndc, 1.0, 1.0);
  vec3 nCam = normalize(vp.xyz / vp.w);
  vec3 n = normalize(uCamRot * nCam);

  vec4 P = -uU + n.x * uE1 + n.y * uE2 + n.z * uE3;
  float pt = P.x;
  vec3 p = P.yzw;
  vec3 x = uCamPos;
  float tR = 0.0;

  vec3 col = vec3(0.0);
  float trans = 1.0;
  float sciLog = 0.0;
  int status = 0;
  vec3 escDir = vec3(0.0, 0.0, 1.0);
  float Resc = max(uEscapeR, 1.02 * length(x));
  float preE = exp2(texelFetch(uExposure, ivec2(0, 0), 0).r);

  vec3 k1x, k1p, k2x, k2p, k3x, k3p, k4x, k4p;
  float k1t, k2t, k3t, k4t;
  float lastR = 1e9;
  bool outward = false;

  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= uMaxSteps) break;
    float r = deriv(x, p, pt, k1x, k1p, k1t);
    float R = length(x);
    float speed = length(k1x);
    lastR = r;
    outward = dot(x, k1x) > 0.0;
    if (abs(r - uRPlus) < 0.2 && abs(k1t) > 30.0 * speed) { status = 2; break; }
    if (r < 0.02) { status = 2; break; }
    if (R > Resc && dot(x, k1x) > 0.0) { status = 1; escDir = normalize(p); break; }

    float hs = stepSize(r, R);
    bool inSlab = false;
    if (uDiskOn > 0.5) {
      float rho = length(x.xy);
      if (rho < uRout * 1.35 + 2.0) {
        float zmax = 7.0 * uHr * max(r, uRin);
        float az = abs(x.z);
        float vz = k1x.z / speed;
        if (az > zmax) {
          if (x.z * vz < 0.0) hs = min(hs, (az - zmax) / max(abs(vz), 1e-4) + 0.25 * zmax);
        } else if (rho > uRin * 0.9) {
          inSlab = true;
          // крупнее шаг в разреженных верхних слоях атмосферы диска
          float zf = max(az / (uHr * max(r, uRin)) - 2.5, 0.0);
          hs = min(hs, 0.3 * uHr * r * (1.0 + zf * zf) / max(abs(vz), 0.15));
        }
      }
    }
    float h = hs / speed;

    vec3 xs; vec3 ps;
    xs = x + 0.5 * h * k1x; ps = p + 0.5 * h * k1p;
    deriv(xs, ps, pt, k2x, k2p, k2t);
    xs = x + 0.5 * h * k2x; ps = p + 0.5 * h * k2p;
    deriv(xs, ps, pt, k3x, k3p, k3t);
    xs = x + h * k3x; ps = p + h * k3p;
    deriv(xs, ps, pt, k4x, k4p, k4t);
    vec3 xn = x + (h / 6.0) * (k1x + 2.0 * k2x + 2.0 * k3x + k4x);
    vec3 pn = p + (h / 6.0) * (k1p + 2.0 * k2p + 2.0 * k3p + k4p);
    float dtn = (h / 6.0) * (k1t + 2.0 * k2t + 2.0 * k3t + k4t);

    if (inSlab || (uDiskOn > 0.5 && abs(xn.z) < 7.0 * uHr * max(r, uRin) && length(xn.xy) < uRout * 1.22)) {
      vec3 xm = 0.5 * (x + xn);
      vec3 pm = 0.5 * (p + pn);
      float fm; vec3 lm;
      float rm = ksBasic(xm, fm, lm);
      if (rm > uRin && rm < uRout * 1.2) {
        float H = uHr * rm;
        float zh = xm.z / H;
        float Om = 1.0 / (rm * sqrt(rm) + uSpin);
        float LV = 1.0 - lm.x * Om * xm.y + lm.y * Om * xm.x;
        float nV = -1.0 + Om * Om * dot(xm.xy, xm.xy) + fm * LV * LV;
        if (nV < -1e-4) {
          float ut = inversesqrt(-nV);
          float pu = ut * (pt + Om * (xm.x * pm.y - xm.y * pm.x));
          if (pu > 0.0) {
            float g = 1.0 / pu;
            // внешний край: гауссов спад плотности (за r_out — до пренебрежимых значений,
            // иначе обрыв был бы виден при ночной адаптации глаза)
            float xo = max(rm - 0.85 * uRout, 0.0) / (0.06 * uRout);
            float taper = smoothstep(uRin, uRin * 1.06, rm) * exp(-xo * xo);
            float phi = atan(xm.y, xm.x);
            float turb = turbulence(xm, rm, phi, uDiskTime + tR + 0.5 * dtn);
            float clump = exp(uTurb * turb * 2.6 - 0.5 * uTurb * uTurb);
            // плотность плавно обращается в ноль у границы расчётного слоя |z| = 4.5H
            // гауссова атмосфера; у границы расчётного слоя (7H) плотность ~10⁻¹¹ — обрыв незаметен
            float dens = exp(-0.5 * zh * zh) * taper * clump * (1.0 - smoothstep(6.0, 7.0, abs(zh)));
            float kr = uTau0 / (H * 1.2533141) * dens;
            float ds = abs(h) * pu;
            float dtau = kr * ds;
            if (dtau > 1e-6) {
              // вертикальная структура: серая атмосфера Эддингтона
              float tz = uTau0 * taper * clump * 0.5 * erfcApprox(abs(zh) * 0.70710678);
              // локальные флуктуации диссипации (горячие пятна МВН-турбулентности)
              float dT = 1.0 + 0.22 * uTurb * turb;
              float logT = diskLogTeff(rm) + 0.25 * log(0.75 * (tz + 0.6666667)) / log(10.0) + log(dT) / log(10.0);
              float logTobs = logT + log(g) / log(10.0);
              float wgt = trans * (1.0 - exp(-dtau));
              vec3 em = blackbody(logTobs, uBand);
              col += wgt * em;
              if (uBand == 2) sciLog += wgt * em.r * log2(g);
              trans *= exp(-dtau);
            }
          }
        }
      }
    }

    x = xn;
    p = pn;
    tR += dtn;
    if (trans < 0.002) { status = 3; break; }
  }

  // Лимит шагов исчерпан, но луч уже удаляется от фотонной области:
  // считаем его ушедшим (иначе тонкое фотонное кольцо «рвётся» на низком качестве)
  if (status == 0 && outward && lastR > 3.2) { status = 1; escDir = normalize(p); }

  // Небо (звёзды и диффузный фон) по асимптотическому направлению
  float escaped = status == 1 ? 1.0 : 0.0;
  vec3 gx = dFdx(escDir);
  vec3 gy = dFdy(escDir);
  float valid = (dFdx(escaped) == 0.0 && dFdy(escaped) == 0.0) ? 1.0 : 0.0;
  vec2 sky = textureGrad(uSky, escDir, gx * valid, gy * valid).rg;
  if (status == 1 && uSkyOn > 0.5) {
    float g = 1.0 / pt;
    float eps = sky.r * uSkyScale;
    float logT = sky.g / max(sky.r, 1e-12) + log(g) / log(10.0);
    vec3 em = eps * blackbody(logT, uBand);
    col += trans * em;
    if (uBand == 2) sciLog += trans * em.r * log2(g);
  }

  col *= preE;
  sciLog *= preE;
  if (uDebugFlatSky > 0.5) col = vec3(status == 1 ? 1.0 : 0.0);
  // координатная сетка небесной сферы (наглядное наложение, не физический эффект)
  float thG = acos(clamp(escDir.z, -1.0, 1.0));
  float phG = atan(escDir.y, escDir.x);
  vec2 q = vec2(thG, phG) * (18.0 / 3.14159265);
  vec2 fw = min(fwidth(q), vec2(0.5)) * valid + 1e-3;
  if (uSkyGrid > 0.5 && status == 1) {
    vec2 gl = abs(fract(q - 0.5) - 0.5) / fw;
    float line = (1.0 - min(min(gl.x, gl.y), 1.0)) * trans;
    col += vec3(0.08, 0.25, 0.5) * line;
    if (uBand == 2) col.r += 0.3 * line;
  }
  if (uBand == 2) outColor = vec4(min(col.r, uClampMax), clamp(sciLog, -uClampMax, uClampMax), 0.0, 1.0);
  else outColor = vec4(min(col, vec3(uClampMax)), 1.0);
}
`;
}
