// Тесты диска Новикова–Торна и спектральных таблиц.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pageThorneQ, pageThorneQNumerical, radiativeEfficiency, diskProfile } from '../src/physics/disk.js';
import { planckLambda, blackbodyChromaticity, buildSpectrumLUT, SPECTRUM_LUT, visibleLuminanceRel } from '../src/physics/spectrum.js';
import { SIGMA_SB } from '../src/physics/units.js';

test('поправка Пейджа–Торна: закрытая формула = численный интеграл законов сохранения', () => {
  for (const a of [0, 0.5, 0.9, 0.998]) {
    for (const r of [1.3, 2, 4, 7, 15, 40]) {
      const q = pageThorneQ(r, a);
      const qn = pageThorneQNumerical(r, a);
      if (qn === 0) {
        assert.equal(q, 0);
        continue;
      }
      assert.ok(Math.abs(q - qn) < 2e-3 * Math.max(qn, 1e-3), `a=${a} r=${r}: ${q} vs ${qn}`);
    }
  }
});

test('Q → 1 вдали, Q(r_isco) = 0 (нулевой момент сил на ISCO)', () => {
  assert.ok(Math.abs(pageThorneQ(1e6, 0) - 1) < 5e-3);
  assert.ok(pageThorneQ(6, 0) < 1e-12);
  assert.ok(pageThorneQ(6.001, 0) < 1e-3);
});

test('радиационный КПД: 5.7% (a = 0), 32% (a = 0.998)', () => {
  assert.ok(Math.abs(radiativeEfficiency(0) - 0.0572) < 2e-4);
  assert.ok(Math.abs(radiativeEfficiency(0.998) - 0.321) < 3e-3);
});

test('профиль диска: максимум T при r ≈ 9.55M (релятивистский диск, a = 0), T ∝ r^{-3/4} вдали', () => {
  const d = diskProfile({ massSolar: 4e6, a: 0, eddRatio: 0.1, rOut: 2000 });
  let best = 0;
  let rb = 0;
  for (let r = 6.01; r < 20; r += 0.005) {
    const T = d.temperatureAt(r);
    if (T > best) {
      best = T;
      rb = r;
    }
  }
  assert.ok(Math.abs(rb - 9.55) < 0.05, `rPeak = ${rb}`);
  const T1 = d.temperatureAt(500);
  const T2 = d.temperatureAt(1000);
  assert.ok(Math.abs(Math.log(T1 / T2) / Math.log(2) - 0.75) < 0.03);
  // оценка T_max ~ 2·10⁵ К · ṁ^{1/4} для 4·10⁶ M☉ (порядок величины)
  assert.ok(d.Tmax > 5e4 && d.Tmax < 5e5, `Tmax = ${d.Tmax}`);
});

test('функция Планка: ∫B_λ dλ = σT⁴/π', () => {
  for (const T of [3000, 6000, 30000]) {
    let s = 0;
    const n = 20000;
    const l1 = 1e-8;
    const l2 = 1e-3;
    const k = Math.log(l2 / l1) / n;
    for (let i = 0; i < n; i++) {
      const l = l1 * Math.exp((i + 0.5) * k);
      s += planckLambda(l, T) * l * k;
    }
    const exact = (SIGMA_SB * T ** 4) / Math.PI;
    assert.ok(Math.abs(s / exact - 1) < 1e-3, `T=${T}: ${s / exact}`);
  }
});

test('цветность чёрного тела: 6504 К ≈ белая точка D65, горячее — голубое', () => {
  const [x, y] = blackbodyChromaticity(6504);
  assert.ok(Math.abs(x - 0.3135) < 0.006 && Math.abs(y - 0.3237) < 0.006, `${x}, ${y}`);
  const [xh, yh] = blackbodyChromaticity(1e7);
  assert.ok(Math.abs(xh - 0.240) < 0.008 && Math.abs(yh - 0.234) < 0.008, `${xh}, ${yh}`);
});

test('таблица спектра: монотонная яркость, яркость Солнца = 1', () => {
  const lut = buildSpectrumLUT();
  const { size, logTMin, logTMax } = SPECTRUM_LUT;
  let prev = -Infinity;
  for (let i = 0; i < size; i++) {
    const v = lut[i * 4 + 3];
    assert.ok(v >= prev - 1e-6);
    prev = v;
  }
  assert.ok(Math.abs(visibleLuminanceRel(5772) - 1) < 1e-9);
  // в высокотемпературном пределе Рэлея–Джинса яркость ∝ T
  const i1 = Math.round(((8 - logTMin) / (logTMax - logTMin)) * (size - 1));
  const i2 = Math.round(((9 - logTMin) / (logTMax - logTMin)) * (size - 1));
  const slope = lut[i2 * 4 + 3] - lut[i1 * 4 + 3];
  assert.ok(Math.abs(slope - 1) < 0.02, `наклон ${slope}`);
});
