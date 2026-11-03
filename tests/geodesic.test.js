// Тесты динамики: круговые орбиты, сохранение E и L, радиальное падение
// (формула циклоиды, пересечение горизонта), геодезическая прецессия
// гироскопа (Ферми–Уокер), приливный тензор.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ksFromSpheroidal,
  keplerFluid,
  zamoFrame,
  staticObserver,
  rainObserver,
  metric,
  dot4,
  ksRadius,
  horizons,
  ksMinusBLTime,
  dKsMinusBLdr,
  circularOrbit,
} from '../src/physics/kerr.js';
import { makeState, advance, constantsOfMotion, rk4Step, renormalize } from '../src/physics/geodesic.js';
import { tidalTensor, symmetricEigen3 } from '../src/physics/tidal.js';
import * as kerrModule from '../src/physics/kerr.js';

function tetradFor(pos, a, u) {
  // базис ZAMO, затем Грам–Шмидт относительно u
  const Z = zamoFrame(pos, a);
  return [Z.eph.slice(), Z.eth.slice(), Z.er.slice()];
}

test('круговая орбита r = 10M: r, E, L сохраняются, период совпадает', () => {
  for (const a of [0, 0.9]) {
    const r0 = 10;
    const pos = [0, ...ksFromSpheroidal(r0, Math.PI / 2, 0, a)];
    const u = keplerFluid(pos, a);
    const [e1, e2, e3] = tetradFor(pos, a, u);
    const y = makeState(pos, u, e1, e2, e3);
    renormalize(y, a);
    const c0 = constantsOfMotion(y, a);
    const ex = circularOrbit(r0, a);
    assert.ok(Math.abs(c0.E - ex.E) < 1e-10, `E ${c0.E} vs ${ex.E}`);
    assert.ok(Math.abs(c0.Lz - ex.L) < 1e-10, `L ${c0.Lz} vs ${ex.L}`);
    const Tcoord = 2 * Math.PI * (Math.pow(r0, 1.5) + a);
    const Tproper = Tcoord / u[0];
    advance(y, a, [0, 0, 0], Tproper, { maxSub: 100000 });
    const c1 = constantsOfMotion(y, a);
    const r1 = ksRadius(y[1], y[2], y[3], a);
    assert.ok(Math.abs(r1 - r0) < 1e-6, `r drift ${r1 - r0}`);
    assert.ok(Math.abs(c1.E - c0.E) < 1e-9);
    assert.ok(Math.abs(c1.Lz - c0.Lz) < 1e-9);
    assert.ok(Math.abs(y[0] - Tcoord) < 1e-6 * Tcoord);
    // вернулись в исходную точку
    assert.ok(Math.hypot(y[1] - pos[1], y[2] - pos[2], y[3] - pos[3]) < 1e-4);
  }
});

test('радиальное падение из покоя (Шварцшильд): τ(r) по формуле циклоиды, через горизонт до r → 0', () => {
  const a = 0;
  const r0 = 10;
  const pos = [0, r0, 0, 0];
  const u = staticObserver(pos, a);
  const [e1, e2, e3] = tetradFor(pos, a, u);
  const y = makeState(pos, u, e1, e2, e3);
  let tau = 0;
  const checkpoints = [6, 2.5, 2.0001, 1.0, 0.3, 0.08];
  let ci = 0;
  while (ci < checkpoints.length) {
    const r = ksRadius(y[1], y[2], y[3], a);
    if (r <= checkpoints[ci]) {
      const eta = Math.acos((2 * r) / r0 - 1);
      const tauExact = Math.sqrt((r0 * r0 * r0) / 8) * (eta + Math.sin(eta));
      assert.ok(Math.abs(tau - tauExact) < 2e-4, `r=${r}: τ=${tau} vs ${tauExact}`);
      ci++;
      continue;
    }
    const h = Math.min(0.004 * Math.pow(r, 1.5), 0.01);
    rk4Step(y, a, [0, 0, 0], h);
    renormalize(y, a);
    tau += h;
  }
  // полное время до сингулярности π sqrt(r0³/8)
  assert.ok(tau < Math.PI * Math.sqrt(125));
});

test('время удалённого наблюдателя: dt_BL/dτ = 1/(1 − 2M/r) при падении с бесконечности', () => {
  const a = 0;
  for (const r of [20, 8, 3, 2.2]) {
    const pos = [0, r, 0, 0];
    const u = rainObserver(pos, a);
    const drdtau = u[1]; // на оси x: dr/dτ = dx/dτ
    const dtbl = u[0] - dKsMinusBLdr(r, a) * drdtau;
    assert.ok(Math.abs(dtbl - 1 / (1 - 2 / r)) < 1e-10, `${dtbl} vs ${1 / (1 - 2 / r)}`);
  }
  // первообразная F согласована с производной
  for (const a2 of [0, 0.6]) {
    const r = 5;
    const h = 1e-5;
    const num = (ksMinusBLTime(r + h, a2) - ksMinusBLTime(r - h, a2)) / (2 * h);
    assert.ok(Math.abs(num - dKsMinusBLdr(r, a2)) < 1e-6);
  }
});

test('геодезическая прецессия гироскопа на круговой орбите: 2π(1 − sqrt(1 − 3M/r)) за оборот', () => {
  const a = 0;
  const r0 = 10;
  const pos = [0, r0, 0, 0];
  const u = keplerFluid(pos, a);
  const Z = zamoFrame(pos, a);
  // гироскоп изначально по радиусу (er ⟂ u, т.к. u имеет только t и φ компоненты)
  const y = makeState(pos, u, Z.eph.slice(), Z.eth.slice(), Z.er.slice());
  renormalize(y, a);
  const Tproper = (2 * Math.PI * Math.pow(r0, 1.5)) / u[0];
  advance(y, a, [0, 0, 0], Tproper, { maxSub: 200000 });
  // локальный радиальный базис в конечной точке
  const p1 = [y[0], y[1], y[2], y[3]];
  const Z1 = zamoFrame(p1, a);
  const g = metric(p1, a);
  const u1 = y.subarray(4, 8);
  // φ-направление в системе орбитального наблюдателя: проекция e_φ̂ ⟂ u
  const eph = Z1.eph.slice();
  const k = dot4(g, u1, eph);
  for (let m = 0; m < 4; m++) eph[m] += k * u1[m];
  const n = Math.sqrt(dot4(g, eph, eph));
  for (let m = 0; m < 4; m++) eph[m] /= n;
  const gyro = y.subarray(16, 20);
  const cr = dot4(g, gyro, Z1.er);
  const cp = dot4(g, gyro, eph);
  // угол гироскопа относительно радиуса после оборота
  const ang = Math.atan2(cp, cr);
  const expected = -2 * Math.PI * Math.sqrt(1 - 3 / r0); // по модулю 2π
  const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
  assert.ok(Math.abs(wrap(ang - expected)) < 1e-4, `угол ${ang}, ожидалось ${wrap(expected)}`);
});

test('приливный тензор Шварцшильда: (−2M/r³, M/r³, M/r³) для статического и падающего наблюдателей, внутри горизонта тоже', () => {
  const a = 0;
  for (const [r, kind] of [
    [10, 'static'],
    [10, 'rain'],
    [3, 'rain'],
    [1, 'rain'],
    [0.3, 'rain'],
  ]) {
    const pos = [0, r * 0.6, r * 0.8, 0];
    const u = kind === 'static' ? staticObserver(pos, a) : rainObserver(pos, a);
    // произвольная ортонормальная тройка ⟂ u
    const e = [
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];
    const g = metric(pos, a);
    const uu = u.slice();
    const ee = e.map((v) => v.slice());
    // Грам–Шмидт
    kerrModule.orthonormalize(g, uu, ee);
    const E = tidalTensor(pos, a, uu, ee);
    const { values } = symmetricEigen3(E);
    values.sort((p, q) => p - q);
    const s = 1 / (r * r * r);
    assert.ok(Math.abs(values[0] + 2 * s) < 1e-6 * s, `${kind} r=${r}: ${values}`);
    assert.ok(Math.abs(values[1] - s) < 1e-6 * s);
    assert.ok(Math.abs(values[2] - s) < 1e-6 * s);
  }
});

test('приливный тензор Керра бесследовый (вакуум)', () => {
  for (const a of [0.5, 0.998]) {
    const pos = [0, ...ksFromSpheroidal(4, 1.0, 0.2, a)];
    const Z = zamoFrame(pos, a);
    const E = tidalTensor(pos, a, Z.u, [Z.eph, Z.eth, Z.er]);
    const tr = E[0] + E[4] + E[8];
    assert.ok(Math.abs(tr) < 1e-7, `trace ${tr}`);
  }
});


test('корабль под горизонтом не может выйти наружу даже на полной тяге', () => {
  const a = 0;
  const pos = [0, 1.95, 0, 0];
  const u = rainObserver(pos, a);
  const g = metric(pos, a);
  const e = [
    [0, 0, 1, 0],
    [0, 0, 0, 1],
    [0, 1, 0, 0],
  ];
  const uu = u.slice();
  kerrModule.orthonormalize(g, uu, e);
  const y = makeState(pos, uu, e[0], e[1], e[2]);
  // тяга 0.5/M (≈ 8·10⁵ g для Sgr A*) строго наружу: e3 — радиальная ось
  for (let i = 0; i < 2000; i++) {
    const r = ksRadius(y[1], y[2], y[3], a);
    if (r < 0.05) break;
    // направление «наружу» в системе корабля: компонента ∇r по осям тетрады
    rk4Step(y, a, [0, 0, 0.5], 0.002);
    renormalize(y, a);
  }
  const rEnd = ksRadius(y[1], y[2], y[3], a);
  assert.ok(rEnd < 1.95, `r = ${rEnd}`);
  assert.ok(rEnd < horizons(a).rPlus);
});
