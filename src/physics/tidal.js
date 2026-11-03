// Тензор Римана и приливный тензор в системе отсчёта корабля.
//
// R^ρ_σμν = ∂_μ Γ^ρ_νσ − ∂_ν Γ^ρ_μσ + Γ^ρ_μλ Γ^λ_νσ − Γ^ρ_νλ Γ^λ_μσ
//
// Символы Кристоффеля вычисляются аналитически (kerr.js), их производные —
// центральными разностями 2-го порядка в двойной точности (относительная
// погрешность ~1e-8, проверяется тестом по скаляру Кречмана).
//
// Приливный («электрический») тензор: E_ab = R_{μανβ} e_a^μ u^α e_b^ν u^β.
// Уравнение девиации геодезических: d²ξ^a/dτ² = −E^a_b ξ^b.
// Отрицательное собственное значение — растяжение, положительное — сжатие.

import { christoffel, metric, ksRadius } from './kerr.js';

const _gp = new Float64Array(64);
const _gm = new Float64Array(64);
const _g0 = new Float64Array(64);
const _dG = [new Float64Array(64), new Float64Array(64), new Float64Array(64), new Float64Array(64)];

/** Полный тензор Римана R^ρ_σμν (Float64Array(256), индекс ρ*64+σ*16+μ*4+ν). */
export function riemann(pos, a, out = new Float64Array(256)) {
  const r = ksRadius(pos[1], pos[2], pos[3], a);
  const h = 2e-4 * Math.max(r, 0.02);
  christoffel(pos, a, _g0);
  _dG[0].fill(0); // ∂_t Γ = 0 (стационарность)
  const p = [pos[0], pos[1], pos[2], pos[3]];
  for (let i = 1; i < 4; i++) {
    p[i] = pos[i] + h;
    christoffel(p, a, _gp);
    p[i] = pos[i] - h;
    christoffel(p, a, _gm);
    p[i] = pos[i];
    const d = _dG[i];
    for (let k = 0; k < 64; k++) d[k] = (_gp[k] - _gm[k]) / (2 * h);
  }
  const G = _g0;
  for (let rho = 0; rho < 4; rho++) {
    for (let sig = 0; sig < 4; sig++) {
      for (let mu = 0; mu < 4; mu++) {
        for (let nu = 0; nu < 4; nu++) {
          if (nu === mu) {
            out[rho * 64 + sig * 16 + mu * 4 + nu] = 0;
            continue;
          }
          let v = _dG[mu][rho * 16 + nu * 4 + sig] - _dG[nu][rho * 16 + mu * 4 + sig];
          for (let lam = 0; lam < 4; lam++) {
            v += G[rho * 16 + mu * 4 + lam] * G[lam * 16 + nu * 4 + sig] - G[rho * 16 + nu * 4 + lam] * G[lam * 16 + mu * 4 + sig];
          }
          out[rho * 64 + sig * 16 + mu * 4 + nu] = v;
        }
      }
    }
  }
  return out;
}

const _R = new Float64Array(256);
const _g = new Float64Array(16);

/**
 * Приливный тензор E_ab (3×3, массив из 9 чисел) для наблюдателя с
 * 4-скоростью u и ортонормальной тройкой e[0..2] в точке pos.
 */
export function tidalTensor(pos, a, u, e) {
  riemann(pos, a, _R);
  metric(pos, a, _g);
  const W = [];
  for (let b = 0; b < 3; b++) {
    const eb = e[b];
    const w = new Float64Array(4);
    for (let rho = 0; rho < 4; rho++) {
      let s = 0;
      for (let al = 0; al < 4; al++) {
        if (u[al] === 0) continue;
        for (let nu = 0; nu < 4; nu++) {
          if (eb[nu] === 0) continue;
          for (let be = 0; be < 4; be++) {
            s += _R[rho * 64 + al * 16 + nu * 4 + be] * u[al] * eb[nu] * u[be];
          }
        }
      }
      w[rho] = s;
    }
    W.push(w);
  }
  const E = new Array(9);
  for (let ai = 0; ai < 3; ai++) {
    for (let b = 0; b < 3; b++) {
      let s = 0;
      for (let m = 0; m < 4; m++) for (let n = 0; n < 4; n++) s += _g[m * 4 + n] * e[ai][m] * W[b][n];
      E[ai * 3 + b] = s;
    }
  }
  // симметризация (подавление численного шума)
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      const m = 0.5 * (E[i * 3 + j] + E[j * 3 + i]);
      E[i * 3 + j] = m;
      E[j * 3 + i] = m;
    }
  }
  return E;
}

/** Собственные значения и векторы симметричной 3×3 матрицы (метод Якоби). */
export function symmetricEigen3(Ain) {
  const A = [
    [Ain[0], Ain[1], Ain[2]],
    [Ain[3], Ain[4], Ain[5]],
    [Ain[6], Ain[7], Ain[8]],
  ];
  const V = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = Math.abs(A[0][1]) + Math.abs(A[0][2]) + Math.abs(A[1][2]);
    const scale = Math.abs(A[0][0]) + Math.abs(A[1][1]) + Math.abs(A[2][2]) + 1e-300;
    if (off < 1e-15 * scale) break;
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(A[p][q]) < 1e-300) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = A[k][p];
          const akq = A[k][q];
          A[k][p] = c * akp - s * akq;
          A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = A[p][k];
          const aqk = A[q][k];
          A[p][k] = c * apk - s * aqk;
          A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = V[k][p];
          const vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const vals = [A[0][0], A[1][1], A[2][2]];
  const vecs = [0, 1, 2].map((i) => [V[0][i], V[1][i], V[2][i]]);
  return { values: vals, vectors: vecs };
}

/** Скаляр Кречмана K = R_abcd R^abcd (для проверки). */
export function kretschmann(pos, a) {
  const R = riemann(pos, a);
  const g = metric(pos, a);
  // обратная метрика
  const gi = new Float64Array(16);
  invert4(g, gi);
  // R_ρσμν
  const Rl = new Float64Array(256);
  for (let rho = 0; rho < 4; rho++)
    for (let s = 0; s < 4; s++)
      for (let m = 0; m < 4; m++)
        for (let n = 0; n < 4; n++) {
          let v = 0;
          for (let al = 0; al < 4; al++) v += g[rho * 4 + al] * R[al * 64 + s * 16 + m * 4 + n];
          Rl[rho * 64 + s * 16 + m * 4 + n] = v;
        }
  // R^ρσμν = g^ρα g^σβ g^μγ g^νδ R_αβγδ
  const raise1 = (T, slot) => {
    const out = new Float64Array(256);
    const idx = [0, 0, 0, 0];
    for (let i0 = 0; i0 < 4; i0++)
      for (let i1 = 0; i1 < 4; i1++)
        for (let i2 = 0; i2 < 4; i2++)
          for (let i3 = 0; i3 < 4; i3++) {
            idx[0] = i0;
            idx[1] = i1;
            idx[2] = i2;
            idx[3] = i3;
            let v = 0;
            const keep = idx[slot];
            for (let k = 0; k < 4; k++) {
              idx[slot] = k;
              v += gi[keep * 4 + k] * T[idx[0] * 64 + idx[1] * 16 + idx[2] * 4 + idx[3]];
            }
            idx[slot] = keep;
            out[i0 * 64 + i1 * 16 + i2 * 4 + i3] = v;
          }
    return out;
  };
  let Ru = Rl;
  for (let s = 0; s < 4; s++) Ru = raise1(Ru, s);
  let K = 0;
  for (let i = 0; i < 256; i++) K += Rl[i] * Ru[i];
  return K;
}

/** Аналитический скаляр Кречмана для Керра. */
export function kretschmannExact(r, cosTheta, a) {
  const c2 = cosTheta * cosTheta;
  const a2 = a * a;
  const S = r * r + a2 * c2;
  const r2 = r * r;
  return (48 * (r2 * r2 * r2 - 15 * a2 * r2 * r2 * c2 + 15 * a2 * a2 * r2 * c2 * c2 - a2 * a2 * a2 * c2 * c2 * c2)) / Math.pow(S, 6);
}

export function invert4(m, out) {
  const inv = new Float64Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  const k = 1 / det;
  for (let i = 0; i < 16; i++) out[i] = inv[i] * k;
  return out;
}
