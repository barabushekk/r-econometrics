// Построение тетрад наблюдателей и подготовка ковекторов для шейдера.

import { metric, lower, zamoFrame, orthonormalize, rainObserver, staticObserver, keplerFluid, ksFromSpheroidal, dot4 } from '../physics/kerr.js';

/**
 * Тетрада «лицом к ЧД»: ось −e3 (нос) направлена к центру, e2 — к северу,
 * e1 = e2 × e3 — в направлении вращения (prograde). u — заданная 4-скорость.
 */
export function facingTetrad(pos, a, u) {
  const Z = zamoFrame(pos, a);
  if (!Z) {
    // под горизонтом ZAMO нет — берём координатные направления
    const R = Math.hypot(pos[1], pos[2], pos[3]);
    const er = [0, pos[1] / R, pos[2] / R, pos[3] / R];
    const up = [0, 0, 0, 1];
    const e = [cross3(up, er), up, er];
    const uu = u.slice();
    orthonormalize(metric(pos, a), uu, e);
    return { u: uu, e };
  }
  const e = [Z.eph.slice(), Z.eth.map((c) => -c), Z.er.slice()];
  const uu = u.slice();
  orthonormalize(metric(pos, a), uu, e);
  return { u: uu, e };
}

function cross3(a, b) {
  return [0, a[2] * b[3] - a[3] * b[2], a[3] * b[1] - a[1] * b[3], a[1] * b[2] - a[2] * b[1]];
}

/** Ковекторы тетрады для шейдера. */
export function tetradCovectors(pos, a, u, e) {
  const g = metric(pos, a);
  return {
    U: Array.from(lower(g, u)),
    E1: Array.from(lower(g, e[0])),
    E2: Array.from(lower(g, e[1])),
    E3: Array.from(lower(g, e[2])),
  };
}

/** 4-скорость: буст ZAMO на скорость v (в долях c) по осям (r̂, θ̂, φ̂). */
export function zamoBoost(pos, a, vr, vth, vph) {
  const Z = zamoFrame(pos, a);
  const v2 = vr * vr + vth * vth + vph * vph;
  if (v2 >= 1) throw new Error('v ≥ c');
  const gam = 1 / Math.sqrt(1 - v2);
  const u = [0, 0, 0, 0];
  for (let m = 0; m < 4; m++) u[m] = gam * (Z.u[m] + vr * Z.er[m] + vth * Z.eth[m] + vph * Z.eph[m]);
  return u;
}

export { rainObserver, staticObserver, keplerFluid, ksFromSpheroidal, dot4 };
