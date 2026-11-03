// Изотропные геодезические (фотоны) в гамильтоновой форме — точная JS-копия
// алгоритма шейдера трассировки лучей (src/render/shaders/raytrace.js).
// Используется в тестах физической корректности и для расчётов на CPU.
//
//   H = ½ g^μν p_μ p_ν = ½ (η^μν p_μ p_ν − f s²),   s = l^μ p_μ = −p_t + l_i p_i
//   dx^i/dλ = p_i − f s l_i
//   dp_i/dλ = ½ s² ∂_i f + f s ∂_i(l_j p_j)
//   dt/dλ   = −p_t + f s,      p_t = const (стационарность)
//
// Лучи трассируются назад во времени: от камеры к источнику. Для этого
// берётся ковектор p = −k, где k — будущий импульс приходящего фотона.
// Нормировка: частота фотона в системе камеры равна 1, т.е. p·u_cam = 1.
// Тогда отношение частот g = ν_набл/ν_изл = 1/(p·u_изл).

import { ksGeometry, makeGeom, horizons, lower, metric } from './kerr.js';

const _G = makeGeom();

/** Правая часть: возвращает [dx(3), dp(3), dt] в массив out(7). */
export function photonDeriv(x, p, pt, a, out) {
  const G = ksGeometry(x[0], x[1], x[2], a, _G);
  const l = G.l;
  const s = -pt + l[0] * p[0] + l[1] * p[1] + l[2] * p[2];
  const f = G.f;
  out[0] = p[0] - f * s * l[0];
  out[1] = p[1] - f * s * l[1];
  out[2] = p[2] - f * s * l[2];
  // ∂_i (l_j p_j) = Σ_j dl[i][j] p_j
  for (let i = 0; i < 3; i++) {
    const gL = G.dl[i * 3] * p[0] + G.dl[i * 3 + 1] * p[1] + G.dl[i * 3 + 2] * p[2];
    out[3 + i] = 0.5 * s * s * G.df[i] + f * s * gL;
  }
  out[6] = -pt + f * s;
  return out;
}

/** Ковектор p = −u + n^a e_a (с опущенными индексами) для направления взгляда n. */
export function cameraRayCovector(pos, a, u, e, n) {
  const g = metric(pos, a);
  const v = [0, 1, 2, 3].map((m) => -u[m] + n[0] * e[0][m] + n[1] * e[1][m] + n[2] * e[2][m]);
  return lower(g, v, [0, 0, 0, 0]);
}

/** Гамильтониан (должен оставаться ≈ 0). */
export function photonHamiltonian(x, p, pt, a) {
  const G = ksGeometry(x[0], x[1], x[2], a, _G);
  const s = -pt + G.l[0] * p[0] + G.l[1] * p[1] + G.l[2] * p[2];
  return 0.5 * (-pt * pt + p[0] * p[0] + p[1] * p[1] + p[2] * p[2] - G.f * s * s);
}

/** Константа Картера Q = p_θ² + cos²θ (−a² p_t² + p_φ²/sin²θ) для фотона. */
export function carterConstant(x, p, pt, a) {
  const G = ksGeometry(x[0], x[1], x[2], a, _G);
  const r = G.r;
  const cosT = x[2] / r;
  const sin2 = Math.max(1e-300, 1 - cosT * cosT);
  const sinT = Math.sqrt(sin2);
  const pth = (cosT / sinT) * (x[0] * p[0] + x[1] * p[1]) - r * sinT * p[2];
  const pphi = x[0] * p[1] - x[1] * p[0];
  return pth * pth + cosT * cosT * (-a * a * pt * pt + (pphi * pphi) / sin2);
}

/**
 * Асимптотическое направление ушедшего луча.
 * В координатах Керра–Шилда входящая главная изотропная конгруэнция —
 * прямые линии, поэтому свет, приходящий с бесконечности, почти не
 * искривляется вдали от ЧД: ошибка направления импульса p_i убывает ~ R⁻⁴
 * (R = 40M → 5·10⁻⁵ рад, R = 80M → 10⁻⁵ рад; см. tests/photon.test.js).
 */
export function asymptoticDirection(p) {
  const n = Math.hypot(p[0], p[1], p[2]);
  return [p[0] / n, p[1] / n, p[2] / n];
}

/**
 * Трассировка одного луча назад во времени (без диска).
 * Возвращает { status: 'escaped'|'captured'|'maxsteps', dir, pt, steps, x, p, dt }.
 */
export function tracePhoton(x0, pcov, a, opts = {}) {
  const { maxSteps = 4000, stepScale = 0.03, escapeR = 1000, record = null } = opts;
  const { rPlus } = horizons(a);
  const x = [x0[0], x0[1], x0[2]];
  const p = [pcov[1], pcov[2], pcov[3]];
  const pt = pcov[0];
  let t = 0;
  const k1 = new Float64Array(7);
  const k2 = new Float64Array(7);
  const k3 = new Float64Array(7);
  const k4 = new Float64Array(7);
  const xs = [0, 0, 0];
  const ps = [0, 0, 0];
  const R0 = Math.hypot(x[0], x[1], x[2]);
  const Resc = Math.max(escapeR, 1.05 * R0);
  for (let i = 0; i < maxSteps; i++) {
    photonDeriv(x, p, pt, a, k1);
    const G = ksGeometry(x[0], x[1], x[2], a, _G);
    const r = G.r;
    const R = Math.hypot(x[0], x[1], x[2]);
    const speed = Math.hypot(k1[0], k1[1], k1[2]);
    // Захват: луч прижимается к горизонту (|dt/dλ| ≫ |dx/dλ|)
    if (Math.abs(r - rPlus) < 0.2 && Math.abs(k1[6]) > 30 * speed) {
      return { status: 'captured', steps: i, x, p, pt, dt: t };
    }
    if (R > Resc && x[0] * k1[0] + x[1] * k1[1] + x[2] * k1[2] > 0) {
      return { status: 'escaped', dir: asymptoticDirection(p), steps: i, x, p, pt, dt: t };
    }
    const h = stepSize(r, R, rPlus, stepScale) / Math.max(speed, 1e-12);
    // RK4
    for (let j = 0; j < 3; j++) {
      xs[j] = x[j] + 0.5 * h * k1[j];
      ps[j] = p[j] + 0.5 * h * k1[3 + j];
    }
    photonDeriv(xs, ps, pt, a, k2);
    for (let j = 0; j < 3; j++) {
      xs[j] = x[j] + 0.5 * h * k2[j];
      ps[j] = p[j] + 0.5 * h * k2[3 + j];
    }
    photonDeriv(xs, ps, pt, a, k3);
    for (let j = 0; j < 3; j++) {
      xs[j] = x[j] + h * k3[j];
      ps[j] = p[j] + h * k3[3 + j];
    }
    photonDeriv(xs, ps, pt, a, k4);
    for (let j = 0; j < 3; j++) {
      x[j] += (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]);
      p[j] += (h / 6) * (k1[3 + j] + 2 * k2[3 + j] + 2 * k3[3 + j] + k4[3 + j]);
    }
    t += (h / 6) * (k1[6] + 2 * k2[6] + 2 * k3[6] + k4[6]);
    if (record) record.push([x[0], x[1], x[2]]);
    if (r < 0.02) return { status: 'captured', steps: i, x, p, pt, dt: t };
  }
  return { status: 'maxsteps', steps: maxSteps, x, p, pt, dt: t };
}

/**
 * Длина шага (в координатном расстоянии): пропорциональна расстоянию до
 * центра, с уточнением вблизи горизонта и фотонной сферы. Та же формула в шейдере.
 */
export function stepSize(r, R, rPlus, scale) {
  const near = Math.max(Math.abs(r - rPlus), 0.04);
  return scale * Math.min(R, 0.6 * R + 2.5 * near) + 0.002;
}
