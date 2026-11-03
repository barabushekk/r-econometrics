// Физические константы (CODATA 2018 / IAU 2015) и переходы между
// геометрическими единицами (G = c = M = 1) и СИ.
//
// Все уравнения движения и трассировка лучей решаются в единицах массы
// чёрной дыры M: длина GM/c², время GM/c³. Масса входит только в
// физический масштаб (километры, секунды, перегрузки, температуру диска).

export const G = 6.6743e-11; // м³ кг⁻¹ с⁻²
export const C = 299792458; // м/с
export const M_SUN = 1.98847e30; // кг
export const SIGMA_SB = 5.670374419e-8; // Вт м⁻² К⁻⁴
export const H_PLANCK = 6.62607015e-34; // Дж·с
export const K_B = 1.380649e-23; // Дж/К
export const M_PROTON = 1.67262192369e-27; // кг
export const SIGMA_T = 6.6524587321e-29; // м², томсоновское сечение
export const AU = 1.495978707e11; // м
export const LIGHT_YEAR = 9.4607304725808e15; // м
export const G0 = 9.80665; // м/с², стандартное ускорение свободного падения
export const YEAR = 365.25 * 86400; // с

/** Масштабы для чёрной дыры массы massSolar (в массах Солнца). */
export function bhScales(massSolar) {
  const massKg = massSolar * M_SUN;
  const L = (G * massKg) / (C * C); // м  — единица длины GM/c²
  const T = L / C; // с — единица времени GM/c³
  return {
    massSolar,
    massKg,
    L,
    T,
    rs: 2 * L, // радиус Шварцшильда 2GM/c²
    /** ускорение: 1/M  →  м/с² */
    accelSI: (aGeo) => aGeo * (C * C) / L,
    /** ускорение в g → геометрические единицы 1/M */
    gToGeo: (g) => (g * G0 * L) / (C * C),
    /** приливный тензор: 1/M² → 1/с² */
    tidalSI: (eGeo) => eGeo / (T * T),
  };
}

/** Эддингтоновская светимость, Вт. */
export function eddingtonLuminosity(massKg) {
  return (4 * Math.PI * G * massKg * M_PROTON * C) / SIGMA_T;
}

export function formatDuration(seconds) {
  if (!isFinite(seconds)) return '∞';
  const s = Math.abs(seconds);
  const sign = seconds < 0 ? '−' : '';
  if (s < 1e-3) return `${sign}${(s * 1e6).toFixed(1)} мкс`;
  if (s < 1) return `${sign}${(s * 1e3).toFixed(1)} мс`;
  if (s < 120) return `${sign}${s.toFixed(2)} с`;
  if (s < 7200) return `${sign}${Math.floor(s / 60)} мин ${Math.floor(s % 60).toString().padStart(2, '0')} с`;
  if (s < 86400 * 3) return `${sign}${(s / 3600).toFixed(2)} ч`;
  if (s < YEAR * 3) return `${sign}${(s / 86400).toFixed(2)} сут`;
  return `${sign}${(s / YEAR).toPrecision(4)} лет`;
}

export function formatClock(seconds) {
  if (!isFinite(seconds)) return '∞';
  const neg = seconds < 0;
  let s = Math.abs(seconds);
  const days = Math.floor(s / 86400);
  s -= days * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const core = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
  return `${neg ? '−' : ''}${days > 0 ? days + 'д ' : ''}${core}`;
}

export function formatDistance(m) {
  const a = Math.abs(m);
  if (a < 1e3) return `${m.toFixed(1)} м`;
  if (a < 1e7) return `${(m / 1e3).toFixed(1)} км`;
  if (a < 0.1 * AU) return `${(m / 1e9).toFixed(3)} млн км`;
  if (a < 0.3 * LIGHT_YEAR) return `${(m / AU).toFixed(3)} а.е.`;
  return `${(m / LIGHT_YEAR).toFixed(3)} св. лет`;
}

export function formatSci(x, digits = 3) {
  if (!isFinite(x)) return x > 0 ? '∞' : x < 0 ? '−∞' : '—';
  if (x === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(x)));
  if (e >= -2 && e < 5) return x.toFixed(Math.max(0, digits - 1 - Math.max(e, 0)));
  const m = x / Math.pow(10, e);
  return `${m.toFixed(digits - 1)}·10${superscript(e)}`;
}

const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
function superscript(n) {
  return String(n)
    .split('')
    .map((c) => SUP[c] ?? c)
    .join('');
}
