// Мониторы кабины: canvas-текстуры, перерисовываемые ~8 раз в секунду.

import * as THREE from 'three';
import { formatClock, formatDuration, formatDistance, formatSci } from '../physics/units.js';
import { EXPOSURE_MODES } from '../config.js';

const SIZES = { nav: [640, 400], time: [640, 400], struct: [640, 400], aux: [384, 256], disk: [384, 256] };
const CYAN = '#5ad1ff';
const DIM = '#2b6f8f';
const WARN = '#ffb347';
const RED = '#ff4a3a';
const GREEN = '#59e08a';

export class Monitors {
  constructor() {
    this.canvases = {};
    this.textures = {};
    this.materials = {};
    for (const [id, [w, h]] of Object.entries(SIZES)) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      this.canvases[id] = c;
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      this.textures[id] = t;
      this.materials[id] = new THREE.MeshBasicMaterial({ map: t, toneMapped: false });
    }
    this.timer = 0;
    this.failed = {};
  }

  material(id) {
    return this.materials[id];
  }

  update(dt, ctx) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.12;
    const t = performance.now() / 1000;
    for (const id of Object.keys(SIZES)) {
      const c = this.canvases[id];
      const g = c.getContext('2d');
      const failed = ctx.failures && ctx.failures[id];
      this.frame(g, c.width, c.height);
      if (failed && Math.sin(t * 13 + id.length) > -0.2) {
        this.noise(g, c.width, c.height, failed);
      } else {
        try {
          this['draw_' + id](g, c.width, c.height, ctx);
        } catch (e) {
          // не роняем кадр из-за отрисовки прибора
        }
        if (failed) this.noise(g, c.width, c.height, failed * 0.5);
      }
      this.textures[id].needsUpdate = true;
    }
  }

  frame(g, w, h) {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#04101a');
    grad.addColorStop(1, '#020509');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(90,209,255,0.25)';
    g.lineWidth = 2;
    g.strokeRect(4, 4, w - 8, h - 8);
    g.font = '600 18px "IBM Plex Mono", ui-monospace, monospace';
    g.textBaseline = 'top';
  }

  noise(g, w, h, amount) {
    const n = 400 * amount;
    for (let i = 0; i < n; i++) {
      g.fillStyle = `rgba(${150 + Math.random() * 100},${150 + Math.random() * 100},255,${Math.random() * 0.5})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 30, 2);
    }
    g.fillStyle = RED;
    g.font = '700 22px "IBM Plex Mono", ui-monospace, monospace';
    g.fillText('ОТКАЗ ДАТЧИКОВ', 16, h - 34);
  }

  title(g, text, w) {
    g.fillStyle = DIM;
    g.font = '700 15px "IBM Plex Mono", ui-monospace, monospace';
    g.fillText(text, 14, 12);
    g.fillStyle = 'rgba(90,209,255,0.18)';
    g.fillRect(14, 32, w - 28, 1);
  }

  kv(g, x, y, k, v, color = CYAN) {
    g.font = '500 14px "IBM Plex Mono", ui-monospace, monospace';
    g.fillStyle = DIM;
    g.fillText(k, x, y);
    g.font = '700 19px "IBM Plex Mono", ui-monospace, monospace';
    g.fillStyle = color;
    g.fillText(v, x, y + 16);
  }

  draw_nav(g, w, h, ctx) {
    const D = ctx.derived;
    const sim = ctx.sim;
    this.title(g, 'НАВИГАЦИЯ · ВИД СВЕРХУ (экв. плоскость)', w);
    const cx = w * 0.4;
    const cy = h * 0.56;
    const r = D.r;
    const viewR = Math.min(4000, Math.max(9, 1.5 * Math.hypot(D.pos[1], D.pos[2], D.pos[3])));
    const k = (h * 0.42) / viewR;
    const a = sim.a;
    const circ = (rad, style, fill) => {
      g.beginPath();
      g.arc(cx, cy, Math.sqrt(rad * rad + a * a) * k, 0, Math.PI * 2);
      if (fill) {
        g.fillStyle = fill;
        g.fill();
      }
      if (style) {
        g.strokeStyle = style;
        g.stroke();
      }
    };
    // диск
    if (ctx.disk && ctx.disk.enabled) {
      g.beginPath();
      g.arc(cx, cy, ctx.disk.rOut * k, 0, Math.PI * 2);
      g.arc(cx, cy, ctx.disk.rIn * k, 0, Math.PI * 2, true);
      g.fillStyle = 'rgba(255,170,80,0.13)';
      g.fill();
    }
    g.lineWidth = 1;
    g.setLineDash([4, 4]);
    circ(sim.rIsco, 'rgba(255,190,90,0.7)');
    circ(sim.rPhPro, 'rgba(160,140,255,0.7)');
    circ(sim.rPhRetro, 'rgba(160,140,255,0.4)');
    g.setLineDash([]);
    circ(2, 'rgba(255,80,60,0.5)'); // эргосфера (на экваторе r = 2M)
    circ(sim.hz.rPlus, null, '#000');
    circ(sim.hz.rPlus, 'rgba(255,255,255,0.8)');
    // прогноз траектории
    const path = D.prediction?.path;
    if (path && path.length > 1) {
      g.strokeStyle = 'rgba(89,224,138,0.75)';
      g.lineWidth = 1.5;
      g.beginPath();
      path.forEach((p, i) => {
        const X = cx + p[0] * k;
        const Y = cy - p[1] * k;
        if (i === 0) g.moveTo(X, Y);
        else g.lineTo(X, Y);
      });
      g.stroke();
    }
    // корабль
    const sx = cx + D.pos[1] * k;
    const sy = cy - D.pos[2] * k;
    g.fillStyle = WARN;
    g.beginPath();
    g.arc(sx, sy, 5, 0, Math.PI * 2);
    g.fill();
    // нос корабля (проекция −e3)
    const nx = -D.e[2][1];
    const ny = -D.e[2][2];
    const nn = Math.hypot(nx, ny) || 1;
    g.strokeStyle = WARN;
    g.beginPath();
    g.moveTo(sx, sy);
    g.lineTo(sx + (nx / nn) * 18, sy - (ny / nn) * 18);
    g.stroke();
    // вид сбоку (ρ, z)
    const bx = w * 0.74;
    const by = 50;
    const bw = w * 0.24;
    const bh = h * 0.42;
    g.strokeStyle = 'rgba(90,209,255,0.25)';
    g.strokeRect(bx, by, bw, bh);
    const k2 = (bh * 0.45) / viewR;
    const c2x = bx + bw * 0.15;
    const c2y = by + bh / 2;
    g.fillStyle = 'rgba(255,170,80,0.3)';
    if (ctx.disk && ctx.disk.enabled) g.fillRect(c2x + ctx.disk.rIn * k2, c2y - 1, (ctx.disk.rOut - ctx.disk.rIn) * k2, 2);
    g.fillStyle = '#000';
    g.strokeStyle = '#fff';
    g.beginPath();
    g.ellipse(c2x, c2y, Math.max(2, Math.sqrt(sim.hz.rPlus ** 2 + a * a) * k2), Math.max(2, sim.hz.rPlus * k2), 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    const rho = Math.hypot(D.pos[1], D.pos[2]);
    g.fillStyle = WARN;
    g.beginPath();
    g.arc(c2x + rho * k2, c2y - D.pos[3] * k2, 3.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = DIM;
    g.font = '500 12px "IBM Plex Mono", ui-monospace, monospace';
    g.fillText('вид сбоку', bx + 4, by + 4);
    // подписи
    this.kv(g, bx, by + bh + 10, 'r (Бойер–Линдквист)', `${formatSci(r, 4)} M`);
    this.kv(g, bx, by + bh + 52, 'r / r₊', `${formatSci(r / sim.hz.rPlus, 4)}`, D.outside ? CYAN : RED);
    g.fillStyle = DIM;
    g.font = '500 12px "IBM Plex Mono", ui-monospace, monospace';
    g.fillText(`шкала: ${formatSci(viewR, 3)} M`, 14, h - 22);
    g.fillStyle = 'rgba(255,190,90,0.9)';
    g.fillText('ISCO', 160, h - 22);
    g.fillStyle = 'rgba(160,140,255,0.9)';
    g.fillText('фотонные орбиты', 210, h - 22);
    g.fillStyle = 'rgba(89,224,138,0.9)';
    g.fillText('прогноз', 350, h - 22);
  }

  draw_time(g, w, h, ctx) {
    const D = ctx.derived;
    const S = ctx.sim.S;
    this.title(g, 'ХРОНОМЕТРИЯ', w);
    g.font = '500 14px "IBM Plex Mono", ui-monospace, monospace';
    g.fillStyle = DIM;
    g.fillText('СОБСТВЕННОЕ ВРЕМЯ КОРАБЛЯ τ', 14, 44);
    g.font = '700 38px "IBM Plex Mono", ui-monospace, monospace';
    g.fillStyle = CYAN;
    g.fillText(formatClock(D.tau * S.T), 14, 62);
    g.font = '500 14px "IBM Plex Mono", ui-monospace, monospace';
    g.fillStyle = DIM;
    g.fillText('ВРЕМЯ УДАЛЁННОГО НАБЛЮДАТЕЛЯ t (Б–Л)', 14, 112);
    g.font = '700 30px "IBM Plex Mono", ui-monospace, monospace';
    g.fillStyle = D.outside ? '#cfe9ff' : RED;
    g.fillText(D.outside ? formatClock(D.tBL * S.T) : '∞ — недостижимо', 14, 130);
    const col2 = w * 0.52;
    this.kv(g, 14, 180, 'dτ/dt (итог)', isFinite(D.dTauDt) ? formatSci(D.dTauDt, 5) : '—');
    this.kv(g, col2, 180, 'гравитац. фактор α (ZAMO)', isFinite(D.alpha) ? formatSci(D.alpha, 5) : 'нет статич. набл.');
    this.kv(g, 14, 226, 'Лоренц-фактор γ отн. ZAMO', isFinite(D.gZamo) ? formatSci(D.gZamo, 5) : '—');
    const p = D.prediction;
    let ttxt = '…';
    let tcol = CYAN;
    if (!D.outside) {
      ttxt = 'пройден';
      tcol = RED;
    } else if (p && isFinite(p.tauToHorizon)) {
      ttxt = formatDuration(p.tauToHorizon * S.T);
      tcol = WARN;
    } else if (p && p.status === 'escape') ttxt = 'уход (не пересечёт)';
    else if (p && p.status === 'bound') ttxt = `нет за ${formatDuration(p.tauMax * S.T)}`;
    this.kv(g, col2, 226, 'до горизонта по τ (баллист.)', ttxt, tcol);
    const rx = D.rxRatio;
    this.kv(g, 14, 272, 'сигнал ЦУПа: частота ×', formatSci(rx, 4), rx > 1.001 ? '#8fb8ff' : rx < 0.999 ? '#ff9a80' : CYAN);
    this.kv(g, col2, 272, 'наш сигнал у ЦУПа ×', isFinite(D.txRatio) ? formatSci(D.txRatio, 4) : 'не дойдёт', isFinite(D.txRatio) ? CYAN : RED);
    if (!D.outside && p && isFinite(p.tauToEnd)) this.kv(g, 14, 318, 'до границы модели по τ', formatDuration(p.tauToEnd * S.T), RED);
    else if (D.outside) this.kv(g, 14, 318, 'ускорение для зависания', isFinite(D.hoverG) ? `${formatSci(D.hoverG, 3)} g` : 'невозможно (эргосфера)');
  }

  draw_struct(g, w, h, ctx) {
    const D = ctx.derived;
    const st = ctx.sim.structure;
    this.title(g, 'КОНСТРУКЦИЯ · ПРИЛИВНЫЕ НАГРУЗКИ', w);
    // силуэт корабля с окраской по нагрузке
    const frac = Math.min(1, st.stressFrac);
    const col = frac < 0.3 ? GREEN : frac < 0.8 ? WARN : RED;
    g.save();
    g.translate(w * 0.27, h * 0.5);
    g.fillStyle = col;
    g.globalAlpha = 0.25 + 0.6 * frac;
    g.beginPath();
    g.moveTo(-120, 0);
    g.lineTo(-90, -14);
    g.lineTo(90, -18);
    g.lineTo(120, -30);
    g.lineTo(120, 30);
    g.lineTo(90, 18);
    g.lineTo(-90, 14);
    g.closePath();
    g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = col;
    g.stroke();
    g.restore();
    // полоса напряжения
    const bx = 14;
    const by = h - 70;
    const bw = w * 0.5;
    g.fillStyle = 'rgba(90,209,255,0.12)';
    g.fillRect(bx, by, bw, 14);
    g.fillStyle = col;
    g.fillRect(bx, by, bw * frac, 14);
    const yieldX = bx + (bw * st.spec.yield) / st.spec.ultimate;
    g.fillStyle = WARN;
    g.fillRect(yieldX, by - 4, 2, 22);
    g.fillStyle = DIM;
    g.font = '500 13px "IBM Plex Mono", ui-monospace, monospace';
    g.fillText(`σ = ${formatSci(st.stress / 1e6, 3)} МПа (${(100 * st.stressFrac).toFixed(st.stressFrac < 0.01 ? 4 : 1)}% предела)`, bx, by + 20);
    const x2 = w * 0.56;
    this.kv(g, x2, 44, 'λ растяжения', `${formatSci(D.lamStretch, 3)} с⁻²`);
    this.kv(g, x2, 90, 'Δa по длине корабля', `${formatSci(st.tidalAcrossShipG, 3)} g`, st.tidalAcrossShipG > 1 ? WARN : CYAN);
    this.kv(g, x2, 136, 'Δa голова–ноги', `${formatSci(st.tidalAcrossBodyG, 3)} g`, st.crewLevel >= 2 ? RED : CYAN);
    this.kv(g, x2, 182, 'экипаж', st.crew, ['#59e08a', WARN, RED, RED][st.crewLevel]);
    g.font = '500 12px "IBM Plex Mono", ui-monospace, monospace';
    let yy = 236;
    for (const s of st.systems) {
      g.fillStyle = s.ok ? GREEN : RED;
      g.fillRect(x2, yy + 3, 8, 8);
      g.fillStyle = s.ok ? DIM : RED;
      g.fillText(s.name, x2 + 14, yy);
      yy += 18;
    }
  }

  draw_aux(g, w, h, ctx) {
    this.title(g, 'ДИАПАЗОН / ЭКСПОЗИЦИЯ', w);
    const bands = ['ВИДИМЫЙ (CIE 1931)', 'ИК 1–5 мкм (усл. цвета)', 'НАУЧНЫЙ: смещение g'];
    this.kv(g, 14, 44, 'режим', bands[ctx.band] || '');
    this.kv(g, 14, 90, 'экспозиция', EXPOSURE_MODES[ctx.exposureMode].short);
    this.kv(g, 14, 136, 'ускорение времени', `×${formatSci(ctx.sim.effectiveWarp ?? ctx.sim.warp, 2)}${ctx.sim.warpLimited ? ' (огр.)' : ''}`, ctx.sim.warpLimited ? WARN : CYAN);
    this.kv(g, 14, 182, 'тяга', `${formatSci(ctx.sim.thrustG, 2)} g`);
  }

  draw_disk(g, w, h, ctx) {
    this.title(g, 'НАПРАВЛЕНИЕ НА ЦЕНТР', w);
    const D = ctx.derived;
    // −∇r в осях корабля (координатная оценка)
    const R = Math.hypot(D.pos[1], D.pos[2], D.pos[3]);
    const dirC = [0, -D.pos[1] / R, -D.pos[2] / R, -D.pos[3] / R];
    const comp = [0, 1, 2].map((i) => dirC[1] * D.e[i][1] + dirC[2] * D.e[i][2] + dirC[3] * D.e[i][3]);
    const n = Math.hypot(...comp) || 1;
    const v = comp.map((c) => c / n);
    const cx = w / 2;
    const cy = h * 0.58;
    const rad = h * 0.32;
    g.strokeStyle = DIM;
    g.beginPath();
    g.arc(cx, cy, rad, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(cx - rad, cy);
    g.lineTo(cx + rad, cy);
    g.moveTo(cx, cy - rad);
    g.lineTo(cx, cy + rad);
    g.stroke();
    const front = v[2] < 0;
    g.fillStyle = front ? WARN : 'rgba(255,179,71,0.35)';
    g.beginPath();
    g.arc(cx + v[0] * rad, cy - v[1] * rad, 7, 0, Math.PI * 2);
    g.fill();
    g.font = '500 12px "IBM Plex Mono", ui-monospace, monospace';
    g.fillStyle = DIM;
    g.fillText(front ? 'впереди' : 'позади', 14, h - 22);
  }
}

export { formatDistance };
