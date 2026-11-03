// Интегратор мировой линии корабля: геодезическая с тягой и перенос
// ориентации (тетрады) по Ферми–Уокеру.
//
//   dx^μ/dτ   = u^μ
//   du^μ/dτ   = −Γ^μ_αβ u^α u^β + A^μ,          A^μ = Σ_b T_b e_b^μ
//   de_b^μ/dτ = −Γ^μ_αβ u^α e_b^β + T_b u^μ       (Ферми–Уокер при e_b ⊥ u)
//
// T_b — собственное ускорение от двигателей в осях корабля (в единицах 1/M).
// При T = 0 корабль движется строго по геодезической (свободное падение),
// а тетрада переносится параллельно — это физические гироскопы: так
// автоматически получаются геодезическая прецессия и увлечение
// инерциальных систем отсчёта (эффект Лензе–Тирринга) при a ≠ 0.
//
// Метод: классический Рунге–Кутта 4-го порядка с шагом, привязанным к
// локальному динамическому времени ~ r^{3/2}; после каждого шага тетрада
// заново ортонормируется (подавление накопления ошибок округления).

import { christoffel, metric, orthonormalize, ksRadius, dot4 } from './kerr.js';

const N = 20; // 4 (x) + 4 (u) + 3×4 (e1, e2, e3)

const _gam = new Float64Array(64);

function contract(gam, u, v, m) {
  let s = 0;
  const base = m * 16;
  for (let al = 0; al < 4; al++) {
    const ua = u[al];
    if (ua === 0) continue;
    for (let be = 0; be < 4; be++) s += gam[base + al * 4 + be] * ua * v[be];
  }
  return s;
}

/** Правая часть системы ОДУ. y — Float64Array(20). thrust — [T1, T2, T3]. */
function deriv(y, a, thrust, dy) {
  const pos = y.subarray(0, 4);
  const u = y.subarray(4, 8);
  christoffel(pos, a, _gam);
  for (let m = 0; m < 4; m++) {
    dy[m] = u[m];
    let acc = 0;
    for (let b = 0; b < 3; b++) acc += thrust[b] * y[8 + b * 4 + m];
    dy[4 + m] = -contract(_gam, u, u, m) + acc;
  }
  for (let b = 0; b < 3; b++) {
    const e = y.subarray(8 + b * 4, 12 + b * 4);
    for (let m = 0; m < 4; m++) {
      dy[8 + b * 4 + m] = -contract(_gam, u, e, m) + thrust[b] * u[m];
    }
  }
}

const k1 = new Float64Array(N);
const k2 = new Float64Array(N);
const k3 = new Float64Array(N);
const k4 = new Float64Array(N);
const tmp = new Float64Array(N);

/** Один шаг RK4 на собственное время h. Изменяет y на месте. */
export function rk4Step(y, a, thrust, h) {
  deriv(y, a, thrust, k1);
  for (let i = 0; i < N; i++) tmp[i] = y[i] + 0.5 * h * k1[i];
  deriv(tmp, a, thrust, k2);
  for (let i = 0; i < N; i++) tmp[i] = y[i] + 0.5 * h * k2[i];
  deriv(tmp, a, thrust, k3);
  for (let i = 0; i < N; i++) tmp[i] = y[i] + h * k3[i];
  deriv(tmp, a, thrust, k4);
  for (let i = 0; i < N; i++) y[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
}

const _g = new Float64Array(16);

/** Восстановление нормировки u·u = −1 и ортонормированности тетрады. */
export function renormalize(y, a) {
  metric(y.subarray(0, 4), a, _g);
  const u = y.subarray(4, 8);
  const e = [y.subarray(8, 12), y.subarray(12, 16), y.subarray(16, 20)];
  orthonormalize(_g, u, e);
}

/** Поворот тетрады корабля на малый вектор угла (в осях корабля). */
export function rotateTetrad(y, wx, wy, wz) {
  const ang = Math.hypot(wx, wy, wz);
  if (ang < 1e-15) return;
  const kx = wx / ang;
  const ky = wy / ang;
  const kz = wz / ang;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const t = 1 - c;
  // Матрица Родрига R; новые оси e'_i = Σ_j R_ji e_j (столбцы R в старом базисе)
  const R = [
    [t * kx * kx + c, t * kx * ky - s * kz, t * kx * kz + s * ky],
    [t * kx * ky + s * kz, t * ky * ky + c, t * ky * kz - s * kx],
    [t * kx * kz - s * ky, t * ky * kz + s * kx, t * kz * kz + c],
  ];
  const e0 = y.slice(8, 12);
  const e1 = y.slice(12, 16);
  const e2 = y.slice(16, 20);
  const E = [e0, e1, e2];
  for (let i = 0; i < 3; i++) {
    for (let m = 0; m < 4; m++) {
      y[8 + i * 4 + m] = R[0][i] * E[0][m] + R[1][i] * E[1][m] + R[2][i] * E[2][m];
    }
  }
}

/** Рекомендуемый максимальный шаг собственного времени. */
export function maxProperStep(y, a, accuracy = 1) {
  const r = ksRadius(y[1], y[2], y[3], a);
  const dyn = Math.pow(Math.max(r, 1e-3), 1.5);
  return 0.004 * accuracy * dyn + 1e-6;
}

/** Создать вектор состояния из (pos, u, e1, e2, e3). */
export function makeState(pos, u, e1, e2, e3) {
  const y = new Float64Array(N);
  y.set(pos, 0);
  y.set(u, 4);
  y.set(e1, 8);
  y.set(e2, 12);
  y.set(e3, 16);
  return y;
}

/**
 * Проинтегрировать на собственное время dtau (с разбиением на подшаги).
 * Возвращает число выполненных подшагов.
 */
export function advance(y, a, thrust, dtau, { maxSub = 2000, accuracy = 1, stopRadius = 0 } = {}) {
  let left = dtau;
  let n = 0;
  while (left > 0 && n < maxSub) {
    const h = Math.min(left, maxProperStep(y, a, accuracy));
    rk4Step(y, a, thrust, h);
    renormalize(y, a);
    left -= h;
    n++;
    if (stopRadius > 0 && ksRadius(y[1], y[2], y[3], a) < stopRadius) break;
  }
  return { steps: n, done: dtau - left };
}

/** Сохраняющиеся величины геодезической (для тестов/диагностики). */
export function constantsOfMotion(y, a) {
  const g = metric(y.subarray(0, 4), a);
  const u = y.subarray(4, 8);
  const et = [1, 0, 0, 0];
  const ephi = [0, -y[2], y[1], 0];
  return {
    E: -dot4(g, et, u),
    Lz: dot4(g, ephi, u),
    norm: dot4(g, u, u),
  };
}
