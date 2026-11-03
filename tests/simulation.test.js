// Интеграционные тесты симуляции: падение через горизонт, граница модели,
// разрушение по физической модели, приборные величины.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/simulation.js';
import { DEFAULTS, START_PRESETS } from '../src/config.js';
import { bhScales, G0 } from '../src/physics/units.js';

function params(over = {}) {
  return { ...JSON.parse(JSON.stringify(DEFAULTS)), ...over };
}

function fallUntilEnd(sim, maxIter = 200000) {
  const ctl = { thrust: [0, 0, 0], boost: false, rot: [0, 0, 0], freeFall: true };
  sim.setWarp(12);
  const events = [];
  for (let i = 0; i < maxIter && !sim.ended; i++) {
    sim.update(0.05, ctl);
    events.push(...sim.takeEvents());
  }
  return events;
}

test('Sgr A*: корабль пересекает горизонт целым, разрушается под горизонтом, модель завершается у r → 0', () => {
  const sim = new Simulation(params({ metric: 'schwarzschild', start: START_PRESETS.nearHorizon }));
  const ev = fallUntilEnd(sim);
  const types = ev.map((e) => e.type);
  const iH = types.indexOf('horizon');
  const iD = types.indexOf('destroyed');
  const iE = types.indexOf('end');
  assert.ok(iH >= 0, 'горизонт пересечён');
  assert.ok(iE > iH, 'модель завершилась после горизонта');
  assert.ok(iD > iH, 'разрушение — после горизонта');
  const dInfo = ev.find((e) => e.type === 'destroyed-info');
  const rDestroy = parseFloat(dInfo.text.match(/r = ([0-9.e+-]+) M/)[1]);
  assert.ok(rDestroy < 0.1 && rDestroy > 0.004, `r разрушения = ${rDestroy}`);
});

test('чёрная дыра 10 M☉: приливы разрушают корабль задолго до горизонта', () => {
  const sim = new Simulation(params({ metric: 'schwarzschild', massSolar: 10, start: { ...START_PRESETS.far, r: 2e5 } }));
  const ev = fallUntilEnd(sim, 400000);
  const types = ev.map((e) => e.type);
  const iD = types.indexOf('destroyed');
  const iH = types.indexOf('horizon');
  assert.ok(iD >= 0);
  assert.ok(iH === -1 || iH > iD);
  const dInfo = ev.find((e) => e.type === 'destroyed-info');
  const rDestroy = parseFloat(dInfo.text.match(/r = ([0-9.e+-]+) M/)[1]);
  // оценка: λ = 2GM/r³ = 8σ_ult/(ρL²) ⇒ r ≈ 102 M
  assert.ok(Math.abs(rDestroy / 102 - 1) < 0.05, `r разрушения = ${rDestroy} M`);
});

test('ускорение зависания у Шварцшильда: g = GM/(r² sqrt(1 − 2GM/rc²))', () => {
  const sim = new Simulation(params({ metric: 'schwarzschild', start: { r: 10, thetaDeg: 90, kind: 'rest' } }));
  const S = bhScales(DEFAULTS.massSolar);
  const exact = S.accelSI(1 / (100 * Math.sqrt(0.8))) / G0;
  assert.ok(Math.abs(sim.derived.hoverG / exact - 1) < 1e-6, `${sim.derived.hoverG} vs ${exact}`);
  // статический наблюдатель: dτ/dt = sqrt(1 − 2/r)
  assert.ok(Math.abs(sim.derived.dTauDt - Math.sqrt(0.8)) < 1e-9);
  assert.ok(Math.abs(sim.derived.rxRatio - 1 / Math.sqrt(0.8)) < 1e-9, 'синее смещение входящего сигнала');
  assert.ok(Math.abs(sim.derived.txRatio - Math.sqrt(0.8)) < 1e-9, 'красное смещение исходящего сигнала');
});

test('Керр: симуляция завершается у внутреннего горизонта Коши', () => {
  const sim = new Simulation(params({ metric: 'kerr', spin: 0.8, start: { r: 5, thetaDeg: 60, kind: 'rest' } }));
  const ev = fallUntilEnd(sim);
  assert.ok(ev.some((e) => e.type === 'horizon'));
  assert.ok(sim.ended);
  assert.ok(sim.r < sim.hz.rPlus && sim.r > sim.hz.rMinus * 0.9, `r = ${sim.r}`);
});
