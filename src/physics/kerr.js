// Метрика Керра в декартовых координатах Керра–Шилда (входящих).
//
//   g_μν = η_μν + f · l_μ l_ν,          g^μν = η^μν − f · l^μ l^ν
//   f    = 2 M r³ / (r⁴ + a² z²)
//   l_μ  = (1, (r x + a y)/(r² + a²), (r y − a x)/(r² + a²), z / r)
//   r    : r⁴ − (x² + y² + z² − a²) r² − a² z² = 0  (это r Бойера–Линдквиста)
//
// Почему Керр–Шилд: координаты регулярны на горизонте событий, поэтому
// и корабль, и световые лучи можно непрерывно вести через r = r₊ и дальше
// внутрь (вплоть до внутреннего горизонта Коши при a > 0 или до r → 0 при
// a = 0). При a = 0 метрика переходит в метрику Шварцшильда во входящих
// координатах Эддингтона–Финкельштейна.
//
// Всё в геометрических единицах G = c = M = 1. Индексы: 0 = t, 1 = x, 2 = y, 3 = z.
// Тензоры хранятся в плоских Float64Array, порядок строк — «μ-major».

/** Сфероидальный радиус r (Бойер–Линдквист) по декартовым координатам КШ. */
export function ksRadius(x, y, z, a) {
  const a2 = a * a;
  const w = x * x + y * y + z * z - a2;
  const disc = Math.sqrt(w * w + 4 * a2 * z * z);
  // Численно устойчивая форма корня квадратного уравнения для r².
  const r2 = w >= 0 ? 0.5 * (w + disc) : (2 * a2 * z * z) / (disc - w);
  return Math.sqrt(r2);
}

/**
 * Геометрические величины КШ в точке и их пространственные производные.
 * Возвращает объект (переиспользуемый, если передан out).
 *   r, f, l[3] (пространственная часть l_i; l_0 = 1),
 *   dr[3] = ∂_i r, df[3] = ∂_i f, dl[9] = ∂_i l_j (индекс i*3+j)
 */
export function ksGeometry(x, y, z, a, out = makeGeom()) {
  const a2 = a * a;
  const w = x * x + y * y + z * z - a2;
  const disc = Math.sqrt(w * w + 4 * a2 * z * z);
  const r2 = w >= 0 ? 0.5 * (w + disc) : (2 * a2 * z * z) / (disc - w);
  const r = Math.sqrt(r2);
  const r3 = r2 * r;
  const r4 = r2 * r2;
  const D = r4 + a2 * z * z;
  const invD = 1 / D;
  const f = 2 * r3 * invD;
  const ra2 = r2 + a2;
  const inv = 1 / ra2;

  const lx = (r * x + a * y) * inv;
  const ly = (r * y - a * x) * inv;
  const lz = z / r;

  // ∂_i r = (x r³, y r³, z r (r² + a²)) / (r⁴ + a² z²)
  const drx = x * r3 * invD;
  const dry = y * r3 * invD;
  const drz = z * r * ra2 * invD;

  // ∂f/∂r и явная производная по z
  const dfdr = 2 * r2 * (3 * a2 * z * z - r4) * invD * invD;
  const dfdzExplicit = -4 * r3 * a2 * z * invD * invD;

  out.r = r;
  out.f = f;
  out.l[0] = lx;
  out.l[1] = ly;
  out.l[2] = lz;
  out.dr[0] = drx;
  out.dr[1] = dry;
  out.dr[2] = drz;
  out.df[0] = dfdr * drx;
  out.df[1] = dfdr * dry;
  out.df[2] = dfdr * drz + dfdzExplicit;

  // ∂ l_j / ∂r при фиксированных (x, y, z)
  const inv2 = inv * inv;
  const dlxdr = (x * (a2 - r2) - 2 * a * r * y) * inv2;
  const dlydr = (y * (a2 - r2) + 2 * a * r * x) * inv2;
  const dlzdr = -z / r2;
  const dr = out.dr;
  const dl = out.dl;
  // i = x
  dl[0] = r * inv + dlxdr * dr[0];
  dl[1] = -a * inv + dlydr * dr[0];
  dl[2] = dlzdr * dr[0];
  // i = y
  dl[3] = a * inv + dlxdr * dr[1];
  dl[4] = r * inv + dlydr * dr[1];
  dl[5] = dlzdr * dr[1];
  // i = z
  dl[6] = dlxdr * dr[2];
  dl[7] = dlydr * dr[2];
  dl[8] = 1 / r + dlzdr * dr[2];
  return out;
}

export function makeGeom() {
  return {
    r: 0,
    f: 0,
    l: new Float64Array(3),
    dr: new Float64Array(3),
    df: new Float64Array(3),
    dl: new Float64Array(9),
  };
}

const _geom = makeGeom();

/** Ковариантная метрика g_μν (Float64Array(16)). pos = [t, x, y, z]. */
export function metric(pos, a, out = new Float64Array(16)) {
  const G = ksGeometry(pos[1], pos[2], pos[3], a, _geom);
  const L0 = 1;
  const L1 = G.l[0];
  const L2 = G.l[1];
  const L3 = G.l[2];
  const L = [L0, L1, L2, L3];
  for (let m = 0; m < 4; m++) {
    for (let n = 0; n < 4; n++) {
      const eta = m === n ? (m === 0 ? -1 : 1) : 0;
      out[m * 4 + n] = eta + G.f * L[m] * L[n];
    }
  }
  return out;
}

/** Контравариантная метрика g^μν = η^μν − f l^μ l^ν, l^μ = (−1, l_i). */
export function inverseMetric(pos, a, out = new Float64Array(16)) {
  const G = ksGeometry(pos[1], pos[2], pos[3], a, _geom);
  const L = [-1, G.l[0], G.l[1], G.l[2]];
  for (let m = 0; m < 4; m++) {
    for (let n = 0; n < 4; n++) {
      const eta = m === n ? (m === 0 ? -1 : 1) : 0;
      out[m * 4 + n] = eta - G.f * L[m] * L[n];
    }
  }
  return out;
}

/**
 * Пространственные производные метрики ∂_i g_μν, i = 1..3.
 * Возвращает Float64Array(48), индекс (i−1)*16 + μ*4 + ν. ∂_t g = 0.
 */
export function metricDerivatives(pos, a, out = new Float64Array(48), geom = _geom) {
  const G = ksGeometry(pos[1], pos[2], pos[3], a, geom);
  const L = [1, G.l[0], G.l[1], G.l[2]];
  const f = G.f;
  for (let i = 0; i < 3; i++) {
    const dL = [0, G.dl[i * 3], G.dl[i * 3 + 1], G.dl[i * 3 + 2]];
    const dfi = G.df[i];
    for (let m = 0; m < 4; m++) {
      for (let n = 0; n < 4; n++) {
        out[i * 16 + m * 4 + n] = dfi * L[m] * L[n] + f * (dL[m] * L[n] + L[m] * dL[n]);
      }
    }
  }
  return out;
}

const _dg = new Float64Array(48);
const _gi = new Float64Array(16);
const _low = new Float64Array(64);

/**
 * Символы Кристоффеля Γ^μ_αβ (Float64Array(64), индекс μ*16 + α*4 + β).
 */
export function christoffel(pos, a, out = new Float64Array(64)) {
  metricDerivatives(pos, a, _dg);
  inverseMetric(pos, a, _gi);
  // Γ_ναβ = ½ (∂_α g_νβ + ∂_β g_να − ∂_ν g_αβ)
  const d = (c, m, n) => (c === 0 ? 0 : _dg[(c - 1) * 16 + m * 4 + n]);
  for (let n = 0; n < 4; n++) {
    for (let al = 0; al < 4; al++) {
      for (let be = al; be < 4; be++) {
        const v = 0.5 * (d(al, n, be) + d(be, n, al) - d(n, al, be));
        _low[n * 16 + al * 4 + be] = v;
        _low[n * 16 + be * 4 + al] = v;
      }
    }
  }
  for (let m = 0; m < 4; m++) {
    for (let al = 0; al < 4; al++) {
      for (let be = al; be < 4; be++) {
        let s = 0;
        for (let n = 0; n < 4; n++) s += _gi[m * 4 + n] * _low[n * 16 + al * 4 + be];
        out[m * 16 + al * 4 + be] = s;
        out[m * 16 + be * 4 + al] = s;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Скалярные произведения и вспомогательная алгебра

export function dot4(g, u, v) {
  let s = 0;
  for (let m = 0; m < 4; m++) {
    const um = u[m];
    if (um === 0) continue;
    for (let n = 0; n < 4; n++) s += g[m * 4 + n] * um * v[n];
  }
  return s;
}

export function lower(g, v, out = new Float64Array(4)) {
  for (let m = 0; m < 4; m++) {
    let s = 0;
    for (let n = 0; n < 4; n++) s += g[m * 4 + n] * v[n];
    out[m] = s;
  }
  return out;
}

export function raise(gi, w, out = new Float64Array(4)) {
  return lower(gi, w, out);
}

// ---------------------------------------------------------------------------
// Характерные радиусы (M = 1, прямые орбиты для a ≥ 0)

export function horizons(a) {
  const s = Math.sqrt(Math.max(0, 1 - a * a));
  return { rPlus: 1 + s, rMinus: 1 - s };
}

/** Радиус эргосферы при данном cos θ. */
export function ergosphereRadius(a, cosTheta) {
  return 1 + Math.sqrt(Math.max(0, 1 - a * a * cosTheta * cosTheta));
}

/** ISCO (Bardeen, Press & Teukolsky 1972). prograde = true — прямые орбиты. */
export function iscoRadius(a, prograde = true) {
  const z1 = 1 + Math.cbrt(1 - a * a) * (Math.cbrt(1 + a) + Math.cbrt(1 - a));
  const z2 = Math.sqrt(3 * a * a + z1 * z1);
  const s = Math.sqrt((3 - z1) * (3 + z1 + 2 * z2));
  return prograde ? 3 + z2 - s : 3 + z2 + s;
}

/** Радиус экваториальной круговой фотонной орбиты. */
export function photonOrbitRadius(a, prograde = true) {
  return 2 * (1 + Math.cos((2 / 3) * Math.acos(prograde ? -a : a)));
}

/** Энергия, момент и угловая скорость прямой круговой экваториальной орбиты. */
export function circularOrbit(r, a) {
  const sr = Math.sqrt(r);
  const den = Math.pow(r, 0.75) * Math.sqrt(r * sr - 3 * sr + 2 * a);
  return {
    E: (r * sr - 2 * sr + a) / den,
    L: (r * r - 2 * a * sr + a * a) / den,
    Omega: 1 / (r * sr + a),
  };
}

/**
 * Разница времени КШ и Бойера–Линдквиста: t_KS = t_BL + F(r),
 * dF/dr = 2 M r / Δ. Используется для «времени удалённого наблюдателя».
 * Константа выбрана произвольно (важны только разности).
 */
export function ksMinusBLTime(r, a) {
  const { rPlus, rMinus } = horizons(a);
  if (a < 1e-9) return 2 * Math.log(Math.abs(r - 2));
  return (2 / (rPlus - rMinus)) * (rPlus * Math.log(Math.abs(r - rPlus)) - rMinus * Math.log(Math.abs(r - rMinus)));
}

/** Производная dF/dr = 2r/Δ. */
export function dKsMinusBLdr(r, a) {
  return (2 * r) / (r * r - 2 * r + a * a);
}

/** Декартовы координаты КШ по (r, θ, φ_KS). */
export function ksFromSpheroidal(r, theta, phi, a) {
  const st = Math.sin(theta);
  return [st * (r * Math.cos(phi) - a * Math.sin(phi)), st * (r * Math.sin(phi) + a * Math.cos(phi)), r * Math.cos(theta)];
}

/** Lapse ZAMO α = sqrt(ΔΣ/A): гравитационный фактор хода часов ZAMO относительно t. */
export function zamoLapse(r, cosTheta, a) {
  const a2 = a * a;
  const sigma = r * r + a2 * cosTheta * cosTheta;
  const delta = r * r - 2 * r + a2;
  const sin2 = 1 - cosTheta * cosTheta;
  const A = (r * r + a2) * (r * r + a2) - a2 * delta * sin2;
  if (delta <= 0) return NaN;
  return Math.sqrt((delta * sigma) / A);
}

// ---------------------------------------------------------------------------
// Наблюдатели (4-скорости в координатах КШ, контравариантные компоненты)

/** Статический наблюдатель u ∝ ∂_t (существует только вне эргосферы). */
export function staticObserver(pos, a) {
  const g = metric(pos, a);
  const gtt = g[0];
  if (gtt >= 0) return null;
  return [1 / Math.sqrt(-gtt), 0, 0, 0];
}

/** ZAMO: u ∝ ∂_t + ω ∂_φ, ω = −g(∂t,∂φ)/g(∂φ,∂φ). Существует при r > r₊. */
export function zamoObserver(pos, a) {
  const g = metric(pos, a);
  const ephi = [0, -pos[2], pos[1], 0];
  const et = [1, 0, 0, 0];
  const gtp = dot4(g, et, ephi);
  const gpp = dot4(g, ephi, ephi);
  if (gpp <= 1e-14) {
    // на оси симметрии ZAMO совпадает со статическим наблюдателем
    return staticObserver(pos, a);
  }
  const omega = -gtp / gpp;
  const v = [1, -omega * pos[2], omega * pos[1], 0];
  const n = dot4(g, v, v);
  if (n >= 0) return null;
  const k = 1 / Math.sqrt(-n);
  return v.map((c) => c * k);
}

/**
 * «Дождевой» наблюдатель Дорана: свободно падающий с покоя на бесконечности
 * с нулевым моментом импульса (E = 1, L = 0). Существует везде, включая
 * область под горизонтом. u_μ = (−1, U ∂_i r), U = −2r / (2r + sqrt(2r(r²+a²))).
 */
export function rainObserver(pos, a) {
  const G = ksGeometry(pos[1], pos[2], pos[3], a, makeGeom());
  const r = G.r;
  const U = (-2 * r) / (2 * r + Math.sqrt(2 * r * (r * r + a * a)));
  const cov = [-1, U * G.dr[0], U * G.dr[1], U * G.dr[2]];
  return raise(inverseMetric(pos, a), cov, [0, 0, 0, 0]);
}

/** 4-скорость кругового прямого движения газа (Ω Кеплера) в данной точке. */
export function keplerFluid(pos, a) {
  const r = ksRadius(pos[1], pos[2], pos[3], a);
  const Omega = 1 / (Math.pow(r, 1.5) + a);
  const v = [1, -Omega * pos[2], Omega * pos[1], 0];
  const g = metric(pos, a);
  const n = dot4(g, v, v);
  if (n >= 0) return null;
  const k = 1 / Math.sqrt(-n);
  return v.map((c) => c * k);
}

/** Ортонормирование тетрады (u; e1, e2, e3) методом Грама–Шмидта по g. */
export function orthonormalize(g, u, e) {
  // u: времениподобный, нормировка u·u = −1
  const uu = dot4(g, u, u);
  const ku = 1 / Math.sqrt(-uu);
  for (let m = 0; m < 4; m++) u[m] *= ku;
  // порядок: e3 (ось «назад»), затем e2 (вверх), затем e1 (вправо)
  const order = [2, 1, 0];
  const done = [];
  for (const idx of order) {
    const v = e[idx];
    // проекция на пространство, ортогональное u: v + (u·v) u
    const uv = dot4(g, u, v);
    for (let m = 0; m < 4; m++) v[m] += uv * u[m];
    for (const w of done) {
      const wv = dot4(g, w, v);
      for (let m = 0; m < 4; m++) v[m] -= wv * w[m];
    }
    const vv = dot4(g, v, v);
    const kv = 1 / Math.sqrt(Math.max(vv, 1e-300));
    for (let m = 0; m < 4; m++) v[m] *= kv;
    done.push(v);
  }
}

/**
 * Ортонормальный пространственный базис ZAMO: (e_r̂, e_θ̂, e_φ̂).
 * e_r̂ ∝ ∇r, e_θ̂ ∝ ∇θ (поднятые градиенты), e_φ̂ ∝ ∂_φ — эти векторы
 * координатно-инвариантно ортогональны друг другу и u_ZAMO, т.е. совпадают
 * с базисом ZAMO в координатах Бойера–Линдквиста.
 */
export function zamoFrame(pos, a) {
  const u = zamoObserver(pos, a);
  if (!u) return null;
  const g = metric(pos, a);
  const gi = inverseMetric(pos, a);
  const G = ksGeometry(pos[1], pos[2], pos[3], a, makeGeom());
  const r = G.r;
  const x = pos[1];
  const y = pos[2];
  const z = pos[3];
  const rho = Math.hypot(x, y);
  const er = raise(gi, [0, G.dr[0], G.dr[1], G.dr[2]], [0, 0, 0, 0]);
  const cosT = z / r;
  const sinT = Math.sqrt(Math.max(1e-24, 1 - cosT * cosT));
  // dθ = −(1/sinθ) d(z/r)
  const k = -1 / sinT;
  const dth = [0, k * (-z * G.dr[0]) / (r * r), k * (-z * G.dr[1]) / (r * r), k * (1 / r - (z * G.dr[2]) / (r * r))];
  const eth = raise(gi, dth, [0, 0, 0, 0]);
  const eph = rho > 1e-9 ? [0, -y, x, 0] : [0, 0, 1, 0];
  const e = [eph, eth, er];
  orthonormalize(g, u, e);
  return { u, er: e[2], eth: e[1], eph: e[0] };
}
