// Баллистический прогноз (двигатели выключены): интегрирует копию
// состояния вперёд порциями в каждом кадре, чтобы не задерживать отрисовку.
// Даёт время до пересечения горизонта по часам корабля и траекторию для
// навигационного дисплея.

import { rk4Step, renormalize, maxProperStep } from '../physics/geodesic.js';
import { ksRadius } from '../physics/kerr.js';

export class Predictor {
  constructor() {
    this.result = { status: 'pending', tauToHorizon: NaN, tauToEnd: NaN, path: [] };
    this.job = null;
  }

  start(y, a, rPlus, rEnd, opts = {}) {
    const r0 = ksRadius(y[1], y[2], y[3], a);
    this.job = {
      y: new Float64Array(y),
      a,
      rPlus,
      rEnd,
      tau: 0,
      tauMax: opts.tauMax ?? Math.max(4000, 40 * Math.pow(Math.max(r0, 3), 1.5)),
      rEscape: Math.max(3 * r0, 200),
      inside: r0 < rPlus,
      tauToHorizon: r0 < rPlus ? 0 : NaN,
      path: [[y[1], y[2], y[3]]],
      steps: 0,
      nextSample: 0,
    };
  }

  /** Выполнить до budget шагов. Возвращает true, если прогноз завершён. */
  step(budget = 250) {
    const J = this.job;
    if (!J) return true;
    for (let i = 0; i < budget; i++) {
      const r = ksRadius(J.y[1], J.y[2], J.y[3], J.a);
      if (r < J.rEnd) return this.finish(J.inside ? 'end' : 'end', r);
      if (r > J.rEscape) return this.finish('escape', r);
      if (J.tau > J.tauMax) return this.finish('bound', r);
      const h = Math.min(maxProperStep(J.y, J.a, 2), 0.02 * Math.max(r, 0.01) ** 1.5 + 1e-4);
      rk4Step(J.y, J.a, [0, 0, 0], h);
      renormalize(J.y, J.a);
      J.tau += h;
      J.steps++;
      const r2 = ksRadius(J.y[1], J.y[2], J.y[3], J.a);
      if (!J.inside && r2 < J.rPlus) {
        J.inside = true;
        J.tauToHorizon = J.tau;
      }
      if (J.tau >= J.nextSample) {
        J.path.push([J.y[1], J.y[2], J.y[3]]);
        J.nextSample = J.tau + J.tauMax / 400;
      }
    }
    return false;
  }

  finish(status, r) {
    const J = this.job;
    J.path.push([J.y[1], J.y[2], J.y[3]]);
    this.result = {
      status,
      tauToHorizon: J.tauToHorizon,
      tauToEnd: status === 'end' ? J.tau : NaN,
      path: J.path,
      tauMax: J.tauMax,
    };
    this.job = null;
    return true;
  }
}
