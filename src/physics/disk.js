// Модель аккреционного диска: релятивистский тонкий диск Новикова–Торна
// (Novikov & Thorne 1973; Page & Thorne 1974).
//
// Поток с единицы площади каждой стороны диска (G = c = M = 1):
//   F(r) = 3 M Ṁ / (8π r³) · Q(r, a),
// Q — релятивистская поправка Пейджа–Торна (нулевой момент сил на ISCO,
// Q → 1 при r → ∞). Эффективная температура T_eff = (F/σ)^{1/4} в СИ.
// Темп аккреции задаётся в долях эддингтоновского: Ṁ = ṁ · L_Edd/(η c²),
// η = 1 − E_isco — радиационный КПД.
//
// Для Sgr A* реальный темп ~10⁻⁸ M☉/год (≈10⁻⁷ Эддингтона) и реальный поток
// — горячий оптически тонкий RIAF, а не тонкий диск. Тонкий диск —
// стандартная модель для активных ядер; темп аккреции — параметр.

import { G, C, SIGMA_SB, M_SUN, YEAR, eddingtonLuminosity, bhScales } from './units.js';
import { iscoRadius, circularOrbit } from './kerr.js';

/** Поправка Пейджа–Торна Q(r) для прямого диска. */
export function pageThorneQ(r, a) {
  const aa = Math.max(a, 1e-7); // предел a → 0 регулярен; избегаем 0/0 в члене x2
  const x = Math.sqrt(r);
  const x0 = Math.sqrt(iscoRadius(aa));
  if (x <= x0) return 0;
  const ac = Math.acos(aa) / 3;
  const x1 = 2 * Math.cos(ac - Math.PI / 3);
  const x2 = 2 * Math.cos(ac + Math.PI / 3);
  const x3 = -2 * Math.cos(ac);
  const term = (xi, xj, xk) => ((3 * (xi - aa) ** 2) / (xi * (xi - xj) * (xi - xk))) * Math.log((x - xi) / (x0 - xi));
  const B = x - x0 - 1.5 * aa * Math.log(x / x0) - term(x1, x2, x3) - term(x2, x1, x3) - term(x3, x1, x2);
  return (x * x * B) / (x * x * x - 3 * x + 2 * aa);
}

/**
 * Независимая проверка: Q(r) из закона сохранения энергии и момента
 * (численный интеграл), F = −Ṁ/(4π r) · Ω'/(E − ΩL)² ∫_{r_isco}^r (E − ΩL) L' dr.
 */
export function pageThorneQNumerical(r, a, n = 4000) {
  const rin = iscoRadius(a);
  if (r <= rin) return 0;
  const d = 1e-6;
  const EL = (rr) => circularOrbit(rr, a);
  let integral = 0;
  for (let i = 0; i < n; i++) {
    const r1 = rin + ((r - rin) * (i + 0.5)) / n;
    const o = EL(r1);
    const Lp = (EL(r1 + d).L - EL(r1 - d).L) / (2 * d);
    integral += (o.E - o.Omega * o.L) * Lp * ((r - rin) / n);
  }
  const o = EL(r);
  const Op = (EL(r + d).Omega - EL(r - d).Omega) / (2 * d);
  const F = (-1 / (4 * Math.PI * r)) * (Op / (o.E - o.Omega * o.L) ** 2) * integral; // при Ṁ = 1
  return F / (3 / (8 * Math.PI * r * r * r));
}

/** Радиационный КПД тонкого диска η = 1 − E_isco. */
export function radiativeEfficiency(a) {
  return 1 - circularOrbit(iscoRadius(a), a).E;
}

export const DISK_LUT_SIZE = 512;

/**
 * Профиль температуры диска.
 * @returns {{rIn, rOut, mdot, mdotSolarPerYear, luminosity, eta, Tmax, rPeak, lut: Float32Array, logTAt: (r)=>number}}
 * lut[i] = log10 T_eff(r_i), r_i по равномерной сетке в sqrt(r) от r_in до r_out.
 */
export function diskProfile({ massSolar, a, eddRatio, rOut }) {
  const S = bhScales(massSolar);
  const eta = radiativeEfficiency(a);
  const Ledd = eddingtonLuminosity(S.massKg);
  const mdot = (eddRatio * Ledd) / (eta * C * C); // кг/с
  const rIn = iscoRadius(a);
  const sIn = Math.sqrt(rIn);
  const sOut = Math.sqrt(Math.max(rOut, rIn * 1.05));
  const lut = new Float32Array(DISK_LUT_SIZE);
  let Tmax = 0;
  let rPeak = rIn;
  const Tof = (r) => {
    const Q = pageThorneQ(r, a);
    if (Q <= 0 || mdot <= 0) return 0;
    const rSI = r * S.L;
    const F = (3 * G * S.massKg * mdot * Q) / (8 * Math.PI * rSI * rSI * rSI);
    return Math.pow(F / SIGMA_SB, 0.25);
  };
  for (let i = 0; i < DISK_LUT_SIZE; i++) {
    const s = sIn + ((sOut - sIn) * i) / (DISK_LUT_SIZE - 1);
    const r = s * s;
    const T = Tof(i === 0 ? rIn * (1 + 1e-6) : r);
    lut[i] = T > 0 ? Math.log10(T) : 0;
    if (T > Tmax) {
      Tmax = T;
      rPeak = r;
    }
  }
  return {
    rIn,
    rOut: sOut * sOut,
    mdot,
    mdotSolarPerYear: (mdot * YEAR) / M_SUN,
    luminosity: eta * mdot * C * C,
    eta,
    Tmax,
    rPeak,
    lut,
    temperatureAt: Tof,
  };
}
