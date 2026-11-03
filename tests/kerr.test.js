// Тесты метрики Керра–Шилда: обратная метрика, производные, горизонты,
// характерные радиусы, наблюдатели, скаляр Кречмана.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  metric,
  inverseMetric,
  metricDerivatives,
  ksRadius,
  ksFromSpheroidal,
  horizons,
  iscoRadius,
  photonOrbitRadius,
  circularOrbit,
  zamoObserver,
  staticObserver,
  rainObserver,
  dot4,
  lower,
  ksGeometry,
  makeGeom,
} from '../src/physics/kerr.js';
import { kretschmann, kretschmannExact } from '../src/physics/tidal.js';

const SPINS = [0, 0.5, 0.9, 0.998];

function randPoint(a, rmin = 1.2, rmax = 30) {
  const r = rmin + Math.random() * (rmax - rmin);
  const th = 0.1 + Math.random() * (Math.PI - 0.2);
  const ph = Math.random() * 2 * Math.PI;
  return [Math.random() * 10, ...ksFromSpheroidal(r, th, ph, a)];
}

test('g_μν · g^νρ = δ_μ^ρ', () => {
  for (const a of SPINS) {
    for (let k = 0; k < 50; k++) {
      const p = randPoint(a, 0.3, 50);
      const g = metric(p, a);
      const gi = inverseMetric(p, a);
      for (let m = 0; m < 4; m++)
        for (let r = 0; r < 4; r++) {
          let s = 0;
          for (let n = 0; n < 4; n++) s += g[m * 4 + n] * gi[n * 4 + r];
          assert.ok(Math.abs(s - (m === r ? 1 : 0)) < 1e-10, `a=${a} (${m},${r}) = ${s}`);
        }
    }
  }
});

test('ksRadius инвертирует ksFromSpheroidal', () => {
  for (const a of SPINS) {
    for (let k = 0; k < 100; k++) {
      const r = 0.05 + Math.random() * 100;
      const th = Math.random() * Math.PI;
      const ph = Math.random() * 6.28;
      const [x, y, z] = ksFromSpheroidal(r, th, ph, a);
      assert.ok(Math.abs(ksRadius(x, y, z, a) - r) < 1e-9 * Math.max(1, r));
    }
  }
});

test('аналитические производные метрики совпадают с конечными разностями', () => {
  for (const a of SPINS) {
    for (let k = 0; k < 20; k++) {
      const p = randPoint(a, 0.5, 20);
      const dg = metricDerivatives(p, a);
      for (let i = 1; i < 4; i++) {
        const h = 1e-6;
        const pp = [...p];
        const pm = [...p];
        pp[i] += h;
        pm[i] -= h;
        const gp = metric(pp, a);
        const gm = metric(pm, a);
        for (let c = 0; c < 16; c++) {
          const num = (gp[c] - gm[c]) / (2 * h);
          assert.ok(Math.abs(num - dg[(i - 1) * 16 + c]) < 1e-6, `a=${a} i=${i} c=${c}: ${num} vs ${dg[(i - 1) * 16 + c]}`);
        }
      }
    }
  }
});

test('горизонт событий: поверхность r = r₊ изотропна, g^μν ∂_μr ∂_νr = Δ/Σ', () => {
  for (const a of SPINS) {
    const { rPlus, rMinus } = horizons(a);
    for (const th of [0.3, 1.0, Math.PI / 2, 2.5]) {
      for (const r of [rPlus, rMinus, 0.5 * (rPlus + rMinus), 3, 10]) {
        if (a === 0 && r === rMinus) continue;
        const [x, y, z] = ksFromSpheroidal(r, th, 0.7, a);
        const G = ksGeometry(x, y, z, a, makeGeom());
        const gi = inverseMetric([0, x, y, z], a);
        const dr = [0, G.dr[0], G.dr[1], G.dr[2]];
        const norm = dot4(gi, dr, dr);
        const delta = r * r - 2 * r + a * a;
        const sigma = r * r + a * a * Math.cos(th) ** 2;
        assert.ok(Math.abs(norm - delta / sigma) < 1e-9, `a=${a} r=${r} th=${th}: ${norm} vs ${delta / sigma}`);
      }
    }
    // Шварцшильд: r₊ = 2M = Rs/M
    if (a === 0) assert.equal(rPlus, 2);
  }
});

test('ISCO и фотонные орбиты: известные значения', () => {
  assert.ok(Math.abs(iscoRadius(0) - 6) < 1e-12);
  assert.ok(Math.abs(iscoRadius(0, false) - 6) < 1e-12);
  assert.ok(Math.abs(iscoRadius(0.998) - 1.2370) < 1e-3);
  assert.ok(Math.abs(iscoRadius(1 - 1e-12) - 1) < 1e-3);
  assert.ok(Math.abs(iscoRadius(1 - 1e-12, false) - 9) < 1e-6);
  assert.ok(Math.abs(photonOrbitRadius(0) - 3) < 1e-12);
  assert.ok(Math.abs(photonOrbitRadius(1, true) - 1) < 1e-9);
  assert.ok(Math.abs(photonOrbitRadius(1, false) - 4) < 1e-9);
  // КПД аккреции 1 − E_isco
  assert.ok(Math.abs(1 - circularOrbit(6, 0).E - 0.05719) < 1e-4);
  assert.ok(Math.abs(1 - circularOrbit(iscoRadius(0.998), 0.998).E - 0.3208) < 2e-3);
});

test('наблюдатели нормированы: u·u = −1; ZAMO имеет L = 0, дождевой E = 1', () => {
  for (const a of SPINS) {
    for (let k = 0; k < 20; k++) {
      const p = randPoint(a, horizons(a).rPlus + 0.05, 30);
      const g = metric(p, a);
      const uz = zamoObserver(p, a);
      assert.ok(Math.abs(dot4(g, uz, uz) + 1) < 1e-10);
      const uzl = lower(g, uz);
      const Lz = p[1] * uzl[2] - p[2] * uzl[1];
      assert.ok(Math.abs(Lz) < 1e-10);
      const ur = rainObserver(p, a);
      assert.ok(Math.abs(dot4(g, ur, ur) + 1) < 1e-10);
      const url = lower(g, ur);
      assert.ok(Math.abs(url[0] + 1) < 1e-12);
      const us = staticObserver(p, a);
      if (us) assert.ok(Math.abs(dot4(g, us, us) + 1) < 1e-10);
    }
    // дождевой наблюдатель существует и под горизонтом
    const pin = [0, ...ksFromSpheroidal(0.5 * (1 + horizons(a).rMinus), 1.2, 0.3, a)];
    const g = metric(pin, a);
    const ur = rainObserver(pin, a);
    assert.ok(Math.abs(dot4(g, ur, ur) + 1) < 1e-10);
    assert.ok(ur[0] > 0, 'направлен в будущее');
  }
});

test('скаляр Кречмана из численного тензора Римана совпадает с точной формулой', () => {
  for (const a of [0, 0.7, 0.998]) {
    for (const [r, th] of [
      [3, 1.1],
      [6, Math.PI / 2],
      [1.5, 0.4],
      [10, 2.0],
    ]) {
      const p = [0, ...ksFromSpheroidal(r, th, 0.4, a)];
      const K = kretschmann(p, a);
      const Kx = kretschmannExact(r, Math.cos(th), a);
      assert.ok(Math.abs(K - Kx) < 1e-5 * Math.abs(Kx) + 1e-9, `a=${a} r=${r}: ${K} vs ${Kx}`);
    }
  }
});
