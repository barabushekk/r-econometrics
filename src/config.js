// Пресеты качества и параметры по умолчанию.
//
// Качество влияет только на точность численного интегрирования (шаг и
// предельное число шагов) и разрешение — физическая модель одна и та же.

export const QUALITY = {
  low: {
    label: 'Low',
    maxSteps: 220,
    stepScale: 0.11,
    noiseOctaves: 2,
    skySize: 512,
    resMin: 0.3,
    resMax: 0.6,
    resStart: 0.45,
    bloom: true,
    accumulate: false,
    msaa: 0,
  },
  medium: {
    label: 'Medium',
    maxSteps: 340,
    stepScale: 0.075,
    noiseOctaves: 3,
    skySize: 1024,
    resMin: 0.4,
    resMax: 0.8,
    resStart: 0.6,
    bloom: true,
    accumulate: true,
    msaa: 2,
  },
  high: {
    label: 'High',
    maxSteps: 520,
    stepScale: 0.05,
    noiseOctaves: 3,
    skySize: 1024,
    resMin: 0.5,
    resMax: 1.0,
    resStart: 0.75,
    bloom: true,
    accumulate: true,
    msaa: 4,
  },
  ultra: {
    label: 'Ultra',
    maxSteps: 900,
    stepScale: 0.03,
    noiseOctaves: 4,
    skySize: 2048,
    resMin: 0.7,
    resMax: 1.0,
    resStart: 1.0,
    bloom: true,
    accumulate: true,
    msaa: 4,
  },
};

export const DEFAULTS = {
  massSolar: 4.0e6, // Sagittarius A*
  metric: 'kerr', // 'schwarzschild' | 'kerr'
  spin: 0.6,
  disk: {
    enabled: true,
    eddRatio: 1e-6, // доля эддингтоновского темпа аккреции
    rOut: 36, // M
    hr: 0.035, // H/r — относительная полутолщина
    tau0: 6, // вертикальная оптическая толщина (от поверхности до плоскости)
    turbulence: 0.55,
  },
  band: 0, // 0 — видимый, 1 — ИК, 2 — научный
  exposureMode: 0, // 0 — глаз, 1 — камера, 2 — ручная
  ev: 0,
  bloom: 0.035,
  skyGrid: false,
  quality: 'high',
  fov: 75,
  sensitivity: 1.0,
  invertY: false,
  drive: 'realistic', // 'realistic' | 'hypothetical'
};

/** Предустановки начальных условий (радиус в M, скорость относительно ZAMO). */
export const START_PRESETS = {
  far: {
    label: 'Дальний подход: r = 600M, покой относительно ZAMO',
    r: 600,
    thetaDeg: 82,
    phiDeg: 0,
    kind: 'rest',
  },
  orbit48: {
    label: 'Круговая орбита r = 48M (за внешним краем диска)',
    r: 48,
    thetaDeg: 90,
    phiDeg: 0,
    kind: 'circular',
  },
  isco: {
    label: 'Орбита ISCO (диск отключён — иначе корабль внутри газа)',
    r: 'isco',
    thetaDeg: 90,
    phiDeg: 0,
    kind: 'circular',
    disk: false,
  },
  plunge: {
    label: 'Радиальное падение с r = 30M над диском',
    r: 30,
    thetaDeg: 70,
    phiDeg: 0,
    kind: 'rest',
  },
  flyby: {
    label: 'Гиперболический пролёт: r₀ = 150M, перицентр ≈ 10M',
    r: 150,
    thetaDeg: 70,
    phiDeg: 0,
    kind: 'custom',
    vr: -0.1155,
    vph: 0.0327,
  },
  nearHorizon: {
    label: 'Свободное падение с покоя у r = 4M',
    r: 4,
    thetaDeg: 75,
    phiDeg: 0,
    kind: 'rest',
  },
};
