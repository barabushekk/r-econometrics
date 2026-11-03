// Ядро симуляции: состояние корабля (мировая линия + тетрада), тяга,
// ускорение времени, события (горизонт, разрушение, граница модели),
// производные величины для приборов.

import { bhScales, G0 } from '../physics/units.js';
import {
  horizons,
  iscoRadius,
  photonOrbitRadius,
  ksRadius,
  ksFromSpheroidal,
  zamoObserver,
  keplerFluid,
  metric,
  inverseMetric,
  dot4,
  ksGeometry,
  makeGeom,
  ksMinusBLTime,
  dKsMinusBLdr,
  zamoLapse,
  rainObserver,
  zamoFrame,
  ergosphereRadius,
} from '../physics/kerr.js';
import { makeState, rk4Step, renormalize, rotateTetrad, maxProperStep } from '../physics/geodesic.js';
import { tidalTensor, symmetricEigen3 } from '../physics/tidal.js';
import { facingTetrad, zamoBoost, tetradCovectors } from './frames.js';
import { Predictor } from './predictor.js';
import { ShipStructure } from '../ship/structure.js';
import { START_PRESETS } from '../config.js';

export const WARP_LEVELS = [1, 3, 10, 30, 100, 300, 1e3, 3e3, 1e4, 3e4, 1e5, 3e5, 1e6];

export const DRIVES = {
  realistic: { label: 'Реалистичный (2 g, форсаж 8 g)', nominal: 2, boost: 8, compensated: false },
  hypothetical: { label: 'Гипотетический (2·10⁴ g, форсаж 2·10⁵ g; с компенсацией инерции — нефизично)', nominal: 2e4, boost: 2e5, compensated: true },
};

const _geom = makeGeom();

export class Simulation {
  constructor(params) {
    this.structure = new ShipStructure();
    this.predictor = new Predictor();
    this.reset(params);
  }

  reset(params) {
    this.params = JSON.parse(JSON.stringify(params));
    const P = this.params;
    this.a = P.metric === 'schwarzschild' ? 0 : Math.min(Math.max(P.spin, 0), 0.998);
    this.S = bhScales(P.massSolar);
    this.hz = horizons(this.a);
    this.rIsco = iscoRadius(this.a);
    this.rPhPro = photonOrbitRadius(this.a, true);
    this.rPhRetro = photonOrbitRadius(this.a, false);
    // граница применимости модели
    this.rEnd = this.a < 1e-6 ? 0.004 : this.hz.rMinus + 0.04 * (this.hz.rPlus - this.hz.rMinus);
    this.endReasonKind = this.a < 1e-6 ? 'singularity' : 'cauchy';

    const start = P.start || START_PRESETS.far;
    const r0 = start.r === 'isco' ? this.rIsco * 1.003 : start.r;
    const th = ((start.thetaDeg ?? 85) * Math.PI) / 180;
    const ph = ((start.phiDeg ?? 0) * Math.PI) / 180;
    const pos = [0, ...ksFromSpheroidal(r0, start.kind === 'circular' ? Math.PI / 2 : th, ph, this.a)];
    let u;
    if (start.kind === 'circular') u = keplerFluid(pos, this.a);
    else if (start.kind === 'tangential') u = zamoBoost(pos, this.a, 0, 0, start.v ?? 0.1);
    else if (start.kind === 'custom') u = zamoBoost(pos, this.a, start.vr ?? 0, start.vth ?? 0, start.vph ?? 0);
    else u = zamoObserver(pos, this.a);
    const T = facingTetrad(pos, this.a, u);
    this.y = makeState(pos, T.u, T.e[0], T.e[1], T.e[2]);
    renormalize(this.y, this.a);

    this.tau = 0; // собственное время корабля, M
    this.r = r0;
    this.tBL0 = pos[0] - ksMinusBLTime(r0, this.a);
    this.inside = r0 < this.hz.rPlus;
    this.crossTau = NaN;
    this.lastSignalTBL = NaN;
    this.ended = false;
    this.endReason = '';
    this.paused = false;
    this.warp = 1;
    this.warpLimited = false;
    this.events = [];
    this.thrustG = 0;
    this.thrustVec = [0, 0, 0];
    this.angVel = [0, 0, 0];
    this.stage = 0;
    this.maxStage = 0;
    this.structure.reset();
    this.destroyedTau = NaN;
    this.realTime = 0;
    this.predictTimer = 0;
    this.predictor.start(this.y, this.a, this.hz.rPlus, this.rEnd, { startTau: 0 });
    this.derived = null;
    this.updateDerived();
    this.emit('start', `Старт: r = ${r0.toFixed(1)} M. ${start.label || ''}`);
  }

  emit(type, text, extra = {}) {
    this.events.push({ type, text, tau: this.tau, ...extra });
  }

  takeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  setWarp(idx) {
    this.warpIndex = Math.max(0, Math.min(WARP_LEVELS.length - 1, idx));
    this.warp = WARP_LEVELS[this.warpIndex];
  }

  /**
   * Шаг симуляции.
   * controls: { thrust:[x,y,z] ∈ [−1,1], boost, rot:[pitch,yaw,roll] рад/с, freeFall }
   */
  update(dtReal, controls) {
    if (this.paused || this.ended) return;
    const dt = Math.min(dtReal, 0.1);
    this.realTime += dt;
    const P = this.params;
    const drive = this.drive();
    const structureOk = this.structure.systemOk('engines') && !this.structure.destroyed;

    // тяга (в осях корабля), единицы 1/M
    let tx = 0;
    let ty = 0;
    let tz = 0;
    let gLevel = 0;
    if (!controls.freeFall && structureOk) {
      const c = controls.thrust;
      const mag = Math.hypot(c[0], c[1], c[2]);
      if (mag > 1e-3) {
        gLevel = (controls.boost ? drive.boost : drive.nominal) * Math.min(1, mag);
        const k = this.S.gToGeo(gLevel) / mag;
        tx = c[0] * k;
        ty = c[1] * k;
        tz = c[2] * k;
      }
    }
    this.thrustG = gLevel;
    this.thrustVec = [tx, ty, tz];
    const thrust = [tx, ty, tz];

    // собственное время за кадр с учётом ограничения ускорения времени
    const MAX_SUB = 96;
    const hMax = maxProperStep(this.y, this.a, 1);
    let dtau = (dt * this.warp) / this.S.T;
    this.warpLimited = false;
    if (dtau > MAX_SUB * hMax) {
      dtau = MAX_SUB * hMax;
      this.warpLimited = true;
    }
    this.effectiveWarp = (dtau * this.S.T) / dt;

    // Порог следующего события нагрузки (оценка λ ≈ 2M/r³): кадр
    // обрывается на подшаге, где он достигнут, чтобы событие (отказ,
    // разрушение) фиксировалось на правильном радиусе даже при ускорении времени.
    const lamNext = this.nextTidalThreshold();
    let left = dtau;
    let n = 0;
    while (left > 1e-15 && n < MAX_SUB * 2) {
      const h = Math.min(left, maxProperStep(this.y, this.a, 1));
      const rPrev = ksRadius(this.y[1], this.y[2], this.y[3], this.a);
      rk4Step(this.y, this.a, thrust, h);
      renormalize(this.y, this.a);
      this.tau += h;
      left -= h;
      n++;
      const r = ksRadius(this.y[1], this.y[2], this.y[3], this.a);
      if (!this.inside && r < this.hz.rPlus && rPrev >= this.hz.rPlus) {
        this.inside = true;
        this.crossTau = this.tau;
        this.emit('horizon', 'Пересечение горизонта событий. Локально ничего особенного не произошло — но вернуться наружу уже невозможно.');
      }
      if (r < this.rEnd) {
        this.endModel();
        break;
      }
      if (2 / (r * r * r) / (this.S.T * this.S.T) >= lamNext) break;
    }

    // ориентация (вращение тетрады в собственной системе корабля) — в реальном времени
    if (controls.rot && !this.structure.destroyed) {
      this.angVel = controls.rot;
      rotateTetrad(this.y, controls.rot[0] * dt, controls.rot[1] * dt, controls.rot[2] * dt);
      renormalize(this.y, this.a);
    }

    this.updateDerived(dt, controls);

    // прогноз
    this.predictTimer -= dt;
    const done = this.predictor.step(150);
    if (done && this.predictTimer <= 0) {
      this.predictor.start(this.y, this.a, this.hz.rPlus, this.rEnd, { startTau: this.tau });
      this.predictTimer = 0.6;
    }
  }

  drive() {
    return DRIVES[this.params.drive] || DRIVES.realistic;
  }

  /** Ближайший ещё не достигнутый порог приливной нагрузки (λ, 1/с²). */
  nextTidalThreshold() {
    const st = this.structure;
    const spec = st.spec;
    if (st.destroyed) return Infinity;
    const lamOfFrac = (fr) => (fr * 8 * spec.ultimate) / (spec.density * spec.length * spec.length);
    const cands = [lamOfFrac(1), lamOfFrac(spec.yield / spec.ultimate)];
    for (const sys of st.systems) if (sys.ok) cands.push(lamOfFrac(sys.threshold));
    for (const gBody of [1.6, 6, 20]) cands.push((gBody * G0) / spec.crewHeight);
    const cur = Math.max(st.stressFrac, 0);
    const curLam = lamOfFrac(cur) * 1.0001;
    let best = Infinity;
    for (const c of cands) if (c > curLam && c < best) best = c;
    return best;
  }

  endModel() {
    this.ended = true;
    if (this.endReasonKind === 'singularity') {
      this.endReason =
        'Достигнута граница применимости модели: r → 0. Кривизна неограниченно растёт (скаляр Кречмана ∝ 1/r⁶), классическая ОТО перестаёт быть надёжной. Природа сингулярности современной физикой не описывается, поэтому симуляция здесь завершается.';
    } else {
      this.endReason =
        'Достигнута окрестность внутреннего горизонта (горизонта Коши) r₋. Решение Керра здесь неустойчиво: падающее излучение испытывает неограниченное синее смещение («инфляция массы», Пуассон и Израэль, 1990). Продолжение внутрь вращающейся ЧД не является физически достоверным — симуляция завершена.';
    }
    this.emit('end', this.endReason);
  }

  /** Производные величины для приборов. */
  updateDerived(dt = 0, controls = {}) {
    const a = this.a;
    const y = this.y;
    const pos = [y[0], y[1], y[2], y[3]];
    const u = [y[4], y[5], y[6], y[7]];
    const e = [
      [y[8], y[9], y[10], y[11]],
      [y[12], y[13], y[14], y[15]],
      [y[16], y[17], y[18], y[19]],
    ];
    const G = ksGeometry(pos[1], pos[2], pos[3], a, _geom);
    const r = G.r;
    this.r = r;
    const cosT = pos[3] / r;
    const g = metric(pos, a);
    const outside = r > this.hz.rPlus * (1 + 1e-9);
    const S = this.S;

    // dr/dτ
    const drdtau = G.dr[0] * u[1] + G.dr[1] * u[2] + G.dr[2] * u[3];

    // скорость относительно «дождевого» наблюдателя (существует везде)
    const ur = rainObserver(pos, a);
    const gRain = -dot4(g, u, ur);
    const vRain = Math.sqrt(Math.max(0, 1 - 1 / (gRain * gRain)));

    let gZ = NaN;
    let vZ = NaN;
    let alpha = NaN;
    let dTauDt = NaN;
    let hoverG = NaN;
    let omegaDrag = NaN;
    let tBL = Infinity;
    let dtBLdtau = NaN;
    if (outside) {
      const uz = zamoObserver(pos, a);
      if (uz) {
        gZ = -dot4(g, u, uz);
        vZ = Math.sqrt(Math.max(0, 1 - 1 / (gZ * gZ)));
        alpha = zamoLapse(r, cosT, a);
        dTauDt = alpha / gZ;
      }
      // угловая скорость увлечения инерциальных систем ω = −g_tφ/g_φφ (рад/M)
      const ephi = [0, -pos[2], pos[1], 0];
      const gpp = dot4(g, ephi, ephi);
      if (gpp > 1e-12) omegaDrag = -dot4(g, [1, 0, 0, 0], ephi) / gpp;
      dtBLdtau = u[0] - dKsMinusBLdr(r, a) * drdtau;
      tBL = pos[0] - ksMinusBLTime(r, a) - this.tBL0;
      // ускорение, необходимое для зависания (статический наблюдатель), вне эргосферы
      const gtt = g[0];
      if (gtt < 0) {
        const gi = inverseMetric(pos, a);
        const ai = [0, (0.5 * G.df[0]) / gtt, (0.5 * G.df[1]) / gtt, (0.5 * G.df[2]) / gtt];
        const a2 = dot4(gi, ai, ai);
        hoverG = S.accelSI(Math.sqrt(Math.max(0, a2))) / G0;
      }
    }

    // радиосвязь: приём сигнала «сверху» вдоль главного изотропного направления
    const rxRatio = u[0] + G.l[0] * u[1] + G.l[1] * u[2] + G.l[2] * u[3];
    let txRatio = NaN;
    if (outside) {
      const R = Math.hypot(pos[1], pos[2], pos[3]);
      const n = [pos[1] / R, pos[2] / R, pos[3] / R];
      const ln = G.l[0] * n[0] + G.l[1] * n[1] + G.l[2] * n[2];
      const f = G.f;
      const A = 1 - f * ln * ln;
      const B = -2 * f * ln;
      const C = -1 - f;
      const disc = B * B - 4 * A * C;
      if (A > 1e-9 && disc >= 0) {
        const kap = (-B + Math.sqrt(disc)) / (2 * A);
        const nuShip = u[0] - kap * (n[0] * u[1] + n[1] * u[2] + n[2] * u[3]);
        if (nuShip > 0) txRatio = 1 / nuShip;
      }
    }

    // приливный тензор в системе корабля
    const E = tidalTensor(pos, a, u, e);
    const eig = symmetricEigen3(E);
    const vals = eig.values;
    let iMin = 0;
    let iMax = 0;
    for (let i = 1; i < 3; i++) {
      if (vals[i] < vals[iMin]) iMin = i;
      if (vals[i] > vals[iMax]) iMax = i;
    }
    const lamStretch = Math.max(0, -vals[iMin]) / (S.T * S.T); // 1/с²
    const lamComp = Math.max(0, vals[iMax]) / (S.T * S.T);
    const thrustSI = S.accelSI(Math.hypot(...this.thrustVec));
    const comp = this.drive().compensated;
    const wasDestroyed = this.structure.destroyed;
    this.structure.update(lamStretch, lamComp, thrustSI, comp, dt, { tau: this.tau, r });
    for (const ev of this.structure.takeEvents()) this.emit(ev.type, ev.text);
    if (!wasDestroyed && this.structure.destroyed) {
      this.destroyedTau = this.tau;
      const left = this.a < 1e-6 ? (2 / 3) * Math.pow(r, 1.5) / Math.sqrt(2) : NaN;
      this.emit(
        'destroyed-info',
        `Корабль разрушен приливными силами при r = ${(r).toPrecision(3)} M (${(r * S.L / 1e3).toFixed(0)} км от центра).` +
          (isFinite(left) ? ` До r = 0 по часам обломков оставалось ≈ ${(left * S.T).toPrecision(2)} с.` : ''),
      );
    }

    // этапы приближения (для повествования; картинка — результат расчёта)
    let stage;
    if (this.inside) stage = 6;
    else if (r > 250) stage = 1;
    else if (r > 50) stage = 2;
    else if (r > 10) stage = 3;
    else stage = 4;
    if (stage !== this.stage) {
      this.stage = stage;
      if (stage > this.maxStage) {
        this.maxStage = stage;
        this.emit('stage', '', { stage });
      }
    }

    const raw = this.predictor.result;
    // прогноз считался от состояния в момент startTau — вычитаем прошедшее время
    const since = this.tau - (raw.startTau ?? 0);
    const pred = {
      ...raw,
      tauToHorizon: isFinite(raw.tauToHorizon) ? Math.max(0, raw.tauToHorizon - since) : raw.tauToHorizon,
      tauToEnd: isFinite(raw.tauToEnd) ? Math.max(0, raw.tauToEnd - since) : raw.tauToEnd,
    };
    this.derived = {
      pos,
      u,
      e,
      r,
      cosT,
      outside,
      rPlus: this.hz.rPlus,
      rMinus: this.hz.rMinus,
      distToHorizonM: r - this.hz.rPlus,
      vRain,
      gRain,
      vZamo: vZ,
      gZamo: gZ,
      alpha,
      dTauDt,
      dtBLdtau,
      tBL,
      tau: this.tau,
      drdtau,
      hoverG,
      omegaDrag,
      thrustG: this.thrustG,
      rxRatio,
      txRatio,
      tidalVals: vals.map((v) => v / (S.T * S.T)),
      tidalVecs: eig.vectors,
      lamStretch,
      lamComp,
      prediction: pred,
      ergoR: ergosphereRadius(a, cosT),
    };
  }

  /** Данные камеры для трассировщика: позиция и ковекторы тетрады. */
  cameraData(extraRotation = null) {
    const y = this.y;
    const pos = [y[0], y[1], y[2], y[3]];
    const u = [y[4], y[5], y[6], y[7]];
    const e = [
      [y[8], y[9], y[10], y[11]],
      [y[12], y[13], y[14], y[15]],
      [y[16], y[17], y[18], y[19]],
    ];
    return { pos, ...tetradCovectors(pos, this.a, u, e) };
  }
}

/** Свободная камера: наблюдатель ZAMO, перемещаемый «телепортацией» (не динамика). */
export class FreeCamera {
  constructor() {
    this.pos = null;
  }
  init(pos, a) {
    this.pos = pos.slice();
    this.a = a;
    this.ensureOutside();
  }
  ensureOutside() {
    const { rPlus } = horizons(this.a);
    const r = ksRadius(this.pos[1], this.pos[2], this.pos[3], this.a);
    if (r < rPlus + 0.08) {
      const k = (rPlus + 0.08) / r;
      for (let i = 1; i < 4; i++) this.pos[i] *= k;
    }
  }
  frame() {
    const Z = zamoFrame(this.pos, this.a);
    return { u: Z.u, e: [Z.eph, Z.eth.map((c) => -c), Z.er] };
  }
  /** move: смещение в осях камеры (вправо, вверх, назад) в долях; dir — матрица поворота взгляда. */
  move(vec, dt) {
    const { rPlus } = horizons(this.a);
    const r = ksRadius(this.pos[1], this.pos[2], this.pos[3], this.a);
    const speed = 0.8 * Math.max(r - rPlus, 0.05) * dt;
    const F = this.frame();
    for (let m = 1; m < 4; m++) {
      this.pos[m] += speed * (vec[0] * F.e[0][m] + vec[1] * F.e[1][m] + vec[2] * F.e[2][m]);
    }
    this.ensureOutside();
  }
  cameraData() {
    const F = this.frame();
    return { pos: this.pos, ...tetradCovectors(this.pos, this.a, F.u, F.e) };
  }
}
