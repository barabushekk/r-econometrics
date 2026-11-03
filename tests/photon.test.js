// Тесты трассировки фотонов (JS-копия алгоритма шейдера):
// сохранение H = 0 и константы Картера, размер тени (критический угол),
// слабое отклонение света, гравитационное синее смещение фона.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tracePhoton, photonDeriv, photonHamiltonian, carterConstant, cameraRayCovector } from '../src/physics/photon.js';
import { staticObserver, zamoFrame, ksFromSpheroidal, metric, orthonormalize } from '../src/physics/kerr.js';

function staticCamera(pos, a) {
  const u = staticObserver(pos, a);
  const Z = zamoFrame(pos, a);
  const e = [Z.eph.slice(), Z.eth.slice(), Z.er.slice()];
  const uu = u.slice();
  orthonormalize(metric(pos, a), uu, e);
  return { u: uu, e };
}

test('H = 0 и константа Картера сохраняются вдоль луча в поле Керра', () => {
  for (const a of [0, 0.6, 0.998]) {
    const pos = [0, ...ksFromSpheroidal(15, 1.2, 0.3, a)];
    const cam = staticCamera(pos, a);
    for (const n of [
      [0.45, 0.1, -0.89],
      [-0.5, 0.2, -0.84],
      [0.05, -0.55, -0.83],
    ]) {
      const nn = Math.hypot(...n);
      const dir = n.map((c) => c / nn);
      const p = cameraRayCovector(pos, a, cam.u, cam.e, dir);
      const x0 = [pos[1], pos[2], pos[3]];
      const p0 = [p[1], p[2], p[3]];
      const Q0 = carterConstant(x0, p0, p[0], a);
      const res = tracePhoton(x0, p, a, { stepScale: 0.01, maxSteps: 20000, escapeR: 60 });
      assert.equal(res.status, 'escaped');
      const H = photonHamiltonian(res.x, res.p, res.pt, a);
      assert.ok(Math.abs(H) < 1e-6, `a=${a}: H=${H} (${res.status})`);
      if (a > 0) {
        const Q1 = carterConstant(res.x, res.p, res.pt, a);
        assert.ok(Math.abs(Q1 - Q0) < 1e-5 * Math.max(1, Math.abs(Q0)), `Q ${Q0} → ${Q1}`);
      }
    }
  }
});

test('тень Шварцшильда: критический угол sin α = 3√3 M sqrt(1 − 2M/r)/r для статического наблюдателя', () => {
  const a = 0;
  for (const r of [6, 20, 100]) {
    const pos = [0, r, 0, 0];
    const cam = staticCamera(pos, a);
    // e[2] — радиальная ось «наружу»; смотрим на ЧД: n = −e3 cos α + e1 sin α
    let lo = 0.0;
    let hi = Math.PI / 2;
    for (let it = 0; it < 40; it++) {
      const al = 0.5 * (lo + hi);
      const dir = [Math.sin(al), 0, -Math.cos(al)];
      const p = cameraRayCovector(pos, a, cam.u, cam.e, dir);
      const res = tracePhoton([pos[1], pos[2], pos[3]], p, a, { stepScale: 0.01, maxSteps: 40000, escapeR: 2 * r + 50 });
      if (res.status === 'escaped') hi = al;
      else lo = al;
    }
    const exact = Math.asin((3 * Math.sqrt(3) * Math.sqrt(1 - 2 / r)) / r);
    const rel = Math.abs(0.5 * (lo + hi) - exact) / exact;
    assert.ok(rel < 2e-3, `r=${r}: ${0.5 * (lo + hi)} vs ${exact}`);
  }
});

test('слабое отклонение света: α ≈ 4M/b + 15πM²/(4b²)', () => {
  const a = 0;
  for (const b of [50, 200]) {
    const X = 2e5;
    const x0 = [-X, b, 0];
    // почти плоское пространство: p = (p_t, −1, 0, 0) с поправкой на H = 0
    // (обратная трассировка: импульс противоположен направлению движения фотона)
    const p = [0, 1, 0, 0];
    // подбор p_t из H = 0 (квадратное уравнение по p_t)
    const solve = () => {
      let lo = 0.5;
      let hi = 2;
      for (let i = 0; i < 200; i++) {
        const m = 0.5 * (lo + hi);
        const H = photonHamiltonian(x0, [p[1], p[2], p[3]], m, a);
        if (H > 0) lo = m;
        else hi = m;
      }
      return 0.5 * (lo + hi);
    };
    p[0] = solve();
    const res = tracePhoton(x0, p, a, { stepScale: 0.01, maxSteps: 100000, escapeR: 1.5 * X });
    assert.equal(res.status, 'escaped');
    const d = res.dir;
    const defl = Math.atan2(-d[1], d[0]);
    const exact = 4 / b + (15 * Math.PI) / (4 * b * b);
    assert.ok(Math.abs(defl - exact) < 0.01 * exact, `b=${b}: ${defl} vs ${exact}`);
  }
});

test('направление импульса на R = 80M совпадает с асимптотическим (R = 10⁶M) лучше 10⁻⁴ рад', () => {
  for (const a of [0, 0.9]) {
    const pos = [0, ...ksFromSpheroidal(15, 1.3, 0.0, a)];
    const cam = staticCamera(pos, a);
    for (const ang of [0.5, 0.8, 1.5, 2.5]) {
      const dir = [Math.sin(ang), 0.1, -Math.cos(ang)];
      const nn = Math.hypot(...dir);
      const p = cameraRayCovector(pos, a, cam.u, cam.e, dir.map((c) => c / nn));
      const near = tracePhoton([pos[1], pos[2], pos[3]], p, a, { stepScale: 0.01, maxSteps: 80000, escapeR: 80 });
      const far = tracePhoton([pos[1], pos[2], pos[3]], p, a, { stepScale: 0.01, maxSteps: 80000, escapeR: 1e6 });
      assert.equal(near.status, 'escaped');
      const c = near.dir[0] * far.dir[0] + near.dir[1] * far.dir[1] + near.dir[2] * far.dir[2];
      const angErr = Math.acos(Math.min(1, c));
      assert.ok(angErr < 1e-4, `a=${a} ang=${ang}: ${angErr}`);
    }
  }
});

test('свет далёких звёзд для статического наблюдателя смещён в синюю сторону в 1/sqrt(1 − 2M/r) раз', () => {
  const a = 0;
  const r = 4;
  const pos = [0, r, 0, 0];
  const cam = staticCamera(pos, a);
  for (const dir of [
    [0, 0, 1],
    [1, 0, 0],
    [0.6, 0.48, 0.64],
  ]) {
    const p = cameraRayCovector(pos, a, cam.u, cam.e, dir);
    // g = ν_набл/ν_беск = 1/p_t (p·u_cam = 1)
    const g = 1 / p[0];
    assert.ok(Math.abs(g - 1 / Math.sqrt(1 - 2 / r)) < 1e-12);
  }
});

test('производные гамильтониана: dx/dλ согласовано с ∂H/∂p (численно)', () => {
  const a = 0.9;
  const x = [3.1, -1.2, 0.7];
  const p = [0.3, 0.8, -0.2];
  const pt = 0.9;
  const out = new Float64Array(7);
  photonDeriv(x, p, pt, a, out);
  const h = 1e-6;
  for (let i = 0; i < 3; i++) {
    const pp = [...p];
    const pm = [...p];
    pp[i] += h;
    pm[i] -= h;
    const dH = (photonHamiltonian(x, pp, pt, a) - photonHamiltonian(x, pm, pt, a)) / (2 * h);
    assert.ok(Math.abs(dH - out[i]) < 1e-7);
    const xp = [...x];
    const xm = [...x];
    xp[i] += h;
    xm[i] -= h;
    const dHx = (photonHamiltonian(xp, p, pt, a) - photonHamiltonian(xm, p, pt, a)) / (2 * h);
    assert.ok(Math.abs(-dHx - out[3 + i]) < 1e-7);
  }
});

