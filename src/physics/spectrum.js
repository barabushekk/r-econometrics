// Спектр излучения: функция Планка, цветовое восприятие (CIE 1931),
// условный инфракрасный диапазон и болометрическая яркость.
//
// Ключевое свойство: удельная интенсивность I_ν/ν³ — лоренц-инвариант,
// поэтому чёрное тело с температурой T, наблюдаемое с отношением частот
// g = ν_набл/ν_изл, выглядит ТОЧНО как чёрное тело с температурой g·T.
// Значит, гравитационное красное смещение, эффект Доплера и релятивистское
// усиление яркости (beaming) учитываются одной заменой T → g·T, а таблица
// «цвет(T)» позволяет делать это в шейдере без спектрального интегрирования.

import { H_PLANCK, C, K_B } from './units.js';

export const T_SUN = 5772; // К, эффективная температура Солнца

/** Спектральная плотность излучения Планка B_λ(T), Вт·м⁻²·ср⁻¹·м⁻¹. */
export function planckLambda(lambdaM, T) {
  const x = (H_PLANCK * C) / (lambdaM * K_B * T);
  if (x > 700) return 0;
  const l5 = lambdaM ** 5;
  return (2 * H_PLANCK * C * C) / (l5 * Math.expm1(x));
}

// Аналитическая многолепестковая аппроксимация функций сложения цветов
// CIE 1931 2° (Wyman, Sloan & Shirley, JCGT 2013). λ в нанометрах.
function lobe(l, mu, s1, s2) {
  const t = (l - mu) / (l < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
}
export function cieXYZ(lnm) {
  return [
    1.056 * lobe(lnm, 599.8, 37.9, 31.0) + 0.362 * lobe(lnm, 442.0, 16.0, 26.7) - 0.065 * lobe(lnm, 501.1, 20.4, 26.2),
    0.821 * lobe(lnm, 568.8, 46.9, 40.5) + 0.286 * lobe(lnm, 530.9, 16.3, 31.1),
    1.217 * lobe(lnm, 437.0, 11.8, 36.0) + 0.681 * lobe(lnm, 459.0, 26.0, 13.8),
  ];
}

/** XYZ (интеграл B_λ с функциями CIE) для чёрного тела. */
export function blackbodyXYZ(T) {
  let X = 0;
  let Y = 0;
  let Z = 0;
  for (let l = 360; l <= 830; l += 1) {
    const B = planckLambda(l * 1e-9, T) * 1e-9; // на нм
    const [x, y, z] = cieXYZ(l);
    X += B * x;
    Y += B * y;
    Z += B * z;
  }
  return [X, Y, Z];
}

/** XYZ → линейный sRGB (D65). */
export function xyzToLinearSRGB([X, Y, Z]) {
  return [
    3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z,
    -0.969266 * X + 1.8760108 * Y + 0.041556 * Z,
    0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z,
  ];
}

/** Интеграл B_λ по условному ИК-диапазону 1–5 мкм (логарифмическая сетка). */
export function infraredBand(T, l1 = 1e-6, l2 = 5e-6) {
  const n = 200;
  const k = Math.log(l2 / l1) / n;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const l = l1 * Math.exp((i + 0.5) * k);
    s += planckLambda(l, T) * l * k;
  }
  return s;
}

const Y_SUN = blackbodyXYZ(T_SUN)[1];
const IR_SUN = infraredBand(T_SUN);

export const SPECTRUM_LUT = {
  size: 1024,
  logTMin: 2.0, // 100 К
  logTMax: 9.5, // 3·10⁹ К
};

/**
 * Таблица для шейдера (Float32Array RGBA, 2 строки × size):
 *  строка 0: (R/Y, G/Y, B/Y, log10(Y/Y☉)) — видимый свет, линейный sRGB;
 *  строка 1: (log10(I_ИК/I_ИК☉), log10((T/T☉)⁴), 0, 0).
 * Яркость нормирована на яркость поверхности Солнца (чёрное тело 5772 К).
 */
export function buildSpectrumLUT() {
  const { size, logTMin, logTMax } = SPECTRUM_LUT;
  const data = new Float32Array(size * 2 * 4);
  for (let i = 0; i < size; i++) {
    const logT = logTMin + ((logTMax - logTMin) * i) / (size - 1);
    const T = Math.pow(10, logT);
    const xyz = blackbodyXYZ(T);
    const Y = xyz[1];
    const rgb = xyzToLinearSRGB(xyz);
    const o = i * 4;
    if (Y > 0) {
      // хроматичность вне гамута sRGB (T < ~1900 К) обрезается до 0
      data[o] = Math.max(0, rgb[0] / Y);
      data[o + 1] = Math.max(0, rgb[1] / Y);
      data[o + 2] = Math.max(0, rgb[2] / Y);
      data[o + 3] = Math.max(-60, Math.log10(Y / Y_SUN));
    } else {
      data[o] = 1;
      data[o + 1] = 0;
      data[o + 2] = 0;
      data[o + 3] = -60;
    }
    const ir = infraredBand(T);
    const o2 = (size + i) * 4;
    data[o2] = ir > 0 ? Math.max(-60, Math.log10(ir / IR_SUN)) : -60;
    data[o2 + 1] = 4 * (logT - Math.log10(T_SUN));
    data[o2 + 2] = 0;
    data[o2 + 3] = 0;
  }
  return data;
}

/** Цветность xy чёрного тела (для тестов). */
export function blackbodyChromaticity(T) {
  const [X, Y, Z] = blackbodyXYZ(T);
  const s = X + Y + Z;
  return [X / s, Y / s];
}

/** Видимая яркость чёрного тела относительно Солнца. */
export function visibleLuminanceRel(T) {
  return blackbodyXYZ(T)[1] / Y_SUN;
}
