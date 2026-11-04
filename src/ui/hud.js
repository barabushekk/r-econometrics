// HUD: приборная индикация поверх изображения.
//  • верхняя панель — режим, камера, ускорение времени, диапазон,
//    экспозиция, производительность, кнопка «Меню» (кнопки кликабельны);
//  • слева — навигация: расстояние, логарифмическая шкала с отметками
//    горизонта, фотонной сферы, ISCO и диска, скорости, ускорения;
//  • справа — хронометрия: часы корабля и удалённого наблюдателя,
//    замедление времени, время до горизонта, радиосвязь;
//  • снизу — корпус: целостность, напряжение, приливы, экипаж, системы;
//  • маркер видимого направления на центр ЧД, бортовой журнал, консоль.

import * as THREE from 'three';
import { formatClock, formatDuration, formatDistance, formatSci } from '../physics/units.js';
import { EXPOSURE_MODES } from '../config.js';

const STAGES = {
  1: [
    'Этап 1 · Дальний подход',
    'Чёрная дыра — небольшое тёмное пятно в сиянии ядра Галактики. Угловой радиус тени для далёкого наблюдателя ≈ 3√3·GM/(c²r). Свободное падение отсюда занимает сутки — используйте ускорение времени ( . и , ).',
  ],
  2: [
    'Этап 2 · Гравитационное линзирование',
    'Изображения звёзд за чёрной дырой смещаются от неё и вытягиваются в дуги, по другую сторону тени появляются вторичные изображения, у края тени — кольцо Эйнштейна. Это результат трассировки лучей, а не наложенный эффект.',
  ],
  3: [
    'Этап 3 · Сильное искривление света',
    'Свет дальней стороны диска огибает ЧД — её изображение видно над и под тенью. Тонкое фотонное кольцо образуют лучи, сделавшие пол-оборота и больше. Приближающаяся сторона диска ярче и голубее, удаляющаяся — тусклее и краснее.',
  ],
  4: [
    'Этап 4 · Окрестность горизонта',
    'Растут гравитационное смещение частот и разница хода часов, небо сжимается к направлению движения (аберрация). Чтобы зависнуть здесь, нужны огромные ускорения — смотрите прибор «для зависания».',
  ],
  6: [
    'Этап 6 · Под горизонтом событий',
    'Координата r стала временеподобной: её уменьшение неизбежно, как ход времени. Тяга в любую сторону лишь сокращает оставшееся собственное время. Внешнюю Вселенную видно — её свет продолжает падать внутрь вслед за вами.',
  ],
};

const BANDS = ['ВИДИМЫЙ', 'ИК 1–5 мкм', 'НАУЧНЫЙ · g'];

const html = String.raw;

export class Hud {
  constructor(root, onAction) {
    this.root = root;
    this.onAction = onAction || (() => {});
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = html`
      <header class="topbar">
        <div class="tb-group">
          <span class="tb-chip strong" data-k="mode"></span>
          <span class="tb-chip" data-k="cam"></span>
        </div>
        <div class="tb-group warp">
          <button class="tb-btn" data-act="warpDown" title="Замедлить время ( , )" aria-label="Замедлить время">◀◀</button>
          <div class="warp-read"><small>ВРЕМЯ</small><b data-k="warp"></b></div>
          <button class="tb-btn" data-act="warpUp" title="Ускорить время ( . )" aria-label="Ускорить время">▶▶</button>
          <button class="tb-btn" data-act="pause" data-k="pausebtn" title="Пауза (P)" aria-label="Пауза">❚❚</button>
        </div>
        <div class="tb-group">
          <button class="tb-chip btn" data-act="band" data-k="band" title="Диапазон (B)"></button>
          <button class="tb-chip btn" data-act="exposure" data-k="exp" title="Экспозиция (X)"></button>
          <button class="tb-chip btn" data-act="toggleExternal" title="Камера (F)">КАМЕРА</button>
          <span class="tb-chip dim" data-k="perf"></span>
          <button class="menu-btn" data-act="menu" title="Меню (Esc)" aria-label="Открыть меню"><span class="burger"><i></i><i></i><i></i></span><span>МЕНЮ</span></button>
        </div>
      </header>
      <div class="alert" data-k="warn"></div>

      <section class="cluster nav">
        <div class="cl-head"><span>НАВИГАЦИЯ</span><em data-k="bh"></em></div>
        <div class="nav-body">
          <canvas class="ladder" width="96" height="260" data-k="ladder"></canvas>
          <div class="nav-main">
            <div class="big"><b data-k="r"></b><small>M</small></div>
            <div class="sub" data-k="rsub"></div>
            <div class="kv"><span>до горизонта</span><b data-k="dh"></b></div>
            <div class="kv"><span>v отн. ZAMO</span><b data-k="v"></b></div>
            <div class="kv"><span>v отн. падающих с ∞</span><b data-k="vr"></b></div>
            <div class="kv"><span>собств. ускорение</span><b data-k="acc"></b></div>
            <div class="kv"><span>для зависания</span><b data-k="hover"></b></div>
            <div class="kv"><span>увлечение ИСО</span><b data-k="drag"></b></div>
          </div>
        </div>
      </section>

      <section class="cluster chrono">
        <div class="cl-head"><span>ХРОНОМЕТРИЯ</span><em>τ — часы корабля</em></div>
        <div class="clock"><small>τ</small><b data-k="tau"></b></div>
        <div class="clock far"><small>t∞</small><b data-k="tbl"></b></div>
        <div class="meter"><span>dτ/dt</span><div class="track"><i data-k="dtbar"></i></div><b data-k="dtdt"></b></div>
        <div class="kv"><span>гравитационный фактор α</span><b data-k="alpha"></b></div>
        <div class="kv"><span>лоренц-фактор γ (ZAMO)</span><b data-k="gamma"></b></div>
        <div class="kv"><span>до горизонта по τ</span><b data-k="tth"></b></div>
        <div class="kv"><span>сигнал ЦУПа / наш у ЦУПа</span><b data-k="radio"></b></div>
      </section>

      <section class="cluster hull">
        <div class="cl-head"><span>КОРПУС</span><em data-k="crew"></em></div>
        <div class="seg" data-k="seg"></div>
        <div class="meter"><span>напряжение</span><div class="track stress"><i data-k="sbar"></i><u data-k="yield"></u></div><b data-k="stress"></b></div>
        <div class="kv"><span>приливы по длине корабля</span><b data-k="tidal"></b></div>
        <div class="systems" data-k="systems"></div>
      </section>

      <div class="reticle"><i></i><i></i><i></i><i></i></div>
      <div class="bh-marker" data-k="marker"><div class="ring"></div><span data-k="mlabel">Sgr A*</span></div>

      <aside class="journal" data-k="journal">
        <div class="j-head"><span>БОРТОВОЙ ЖУРНАЛ</span><button class="j-close" data-act="closeJournal" aria-label="Закрыть">✕</button></div>
        <h3></h3>
        <p></p>
      </aside>
      <div class="console" data-k="log"></div>
      <div class="compact" data-k="compact"></div>
      <div class="hint" data-k="hint">Клик по изображению — обзор мышью · WASD, Space, Ctrl — тяга · стрелки, Q/E — ориентация · ПКМ — развернуть по взгляду · Esc — меню</div>
    `;
    root.appendChild(this.el);
    this.k = {};
    for (const n of this.el.querySelectorAll('[data-k]')) {
      this.k[n.dataset.k] = n;
      n.dataset.base = n.className;
    }
    for (const b of this.el.querySelectorAll('[data-act]')) {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (b.dataset.act === 'closeJournal') this.k.journal.classList.remove('show');
        else this.onAction(b.dataset.act);
      });
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    // сегменты целостности
    this.k.seg.innerHTML = Array.from({ length: 24 }, () => '<i></i>').join('');
    this.segs = [...this.k.seg.children];
    this.timer = 0;
    this.stageTimer = 0;
    this.hintTimer = 25;
    this.visible = true;
    this.minimal = false;
    this.logItems = [];
    this.ladderCtx = this.k.ladder.getContext('2d');
    this._v = new THREE.Vector3();
  }

  setVisible(v) {
    this.visible = v;
    this.el.style.display = v ? '' : 'none';
  }

  setMinimal(m) {
    this.minimal = m;
    this.el.classList.toggle('minimal', m);
  }

  showStage(n, extra = '') {
    const s = STAGES[n];
    if (!s) return;
    this.showMessage(s[0], s[1] + (extra ? ' ' + extra : ''), 16);
  }

  showMessage(title, text, secs = 14) {
    this.k.journal.querySelector('h3').textContent = title;
    this.k.journal.querySelector('p').textContent = text;
    this.k.journal.classList.add('show');
    this.stageTimer = secs;
  }

  log(text, cls = '', tau = null) {
    if (!text) return;
    this.logItems.push({ text, cls, t: 14, stamp: tau });
    if (this.logItems.length > 5) this.logItems.shift();
    this.renderLog();
  }

  renderLog() {
    this.k.log.innerHTML = this.logItems
      .map((i) => `<div class="${i.cls}" style="opacity:${Math.min(1, i.t / 3).toFixed(2)}"><span>›</span>${i.text}</div>`)
      .join('');
  }

  set(k, v, cls) {
    const n = this.k[k];
    if (!n) return;
    if (n.textContent !== v) n.textContent = v;
    const c = [n.dataset.base, cls].filter(Boolean).join(' ');
    if (n.className !== c) n.className = c;
  }

  /** Маркер видимого направления на центр (оси корабля → экран). */
  updateMarker(ctx) {
    const m = this.k.marker;
    const D = ctx.derived;
    if (!D.centerDir || !ctx.camera || ctx.cameraMode === 'free') {
      m.style.display = 'none';
      return;
    }
    const cam = ctx.camera;
    const v = this._v.set(D.centerDir[0], D.centerDir[1], D.centerDir[2]);
    // в мировые оси сцены (оси корабля) → в систему камеры
    v.applyQuaternion(cam.quaternion.clone().invert());
    const W = this.el.clientWidth;
    const H = this.el.clientHeight;
    let x;
    let y;
    let edge = false;
    if (v.z < 0) {
      const p = v.clone().applyMatrix4(cam.projectionMatrix);
      x = (p.x * 0.5 + 0.5) * W;
      y = (-p.y * 0.5 + 0.5) * H;
      if (x < 30 || x > W - 30 || y < 70 || y > H - 30) edge = true;
    } else edge = true;
    if (edge) {
      // направление к краю экрана
      const ang = Math.atan2(-v.y, v.x);
      const cx = W / 2;
      const cy = H / 2;
      const rx = W / 2 - 40;
      const ry = H / 2 - 60;
      const t = Math.min(rx / Math.abs(Math.cos(ang) || 1e-6), ry / Math.abs(Math.sin(ang) || 1e-6));
      x = cx + Math.cos(ang) * t;
      y = cy + Math.sin(ang) * t;
    }
    m.style.display = '';
    m.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    m.classList.toggle('edge', edge);
  }

  drawLadder(sim, D) {
    const g = this.ladderCtx;
    const c = this.k.ladder;
    const W = c.width;
    const H = c.height;
    g.clearRect(0, 0, W, H);
    const rMin = Math.max(0.3 * sim.hz.rPlus, 0.05);
    const rMax = 1500;
    const y = (r) => {
      const t = (Math.log(Math.max(r, rMin)) - Math.log(rMin)) / (Math.log(rMax) - Math.log(rMin));
      return H - 10 - t * (H - 20);
    };
    const x0 = Math.round(W * 0.52);
    g.strokeStyle = 'rgba(143,231,255,0.35)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x0 + 0.5, 6);
    g.lineTo(x0 + 0.5, H - 6);
    g.stroke();
    // декадные деления
    g.font = '9px "IBM Plex Mono", ui-monospace, monospace';
    g.textAlign = 'right';
    g.fillStyle = 'rgba(143,231,255,0.45)';
    for (const r of [1, 10, 100, 1000]) {
      if (r < rMin) continue;
      const yy = Math.round(y(r)) + 0.5;
      g.beginPath();
      g.moveTo(x0 - 4, yy);
      g.lineTo(x0 + 4, yy);
      g.stroke();
      g.fillText(String(r), x0 - 7, yy + 3);
    }
    // зона диска
    if (sim.diskInfo && sim.diskInfo.enabled) {
      g.fillStyle = 'rgba(255,177,74,0.22)';
      const y1 = y(sim.diskInfo.rOut);
      const y2 = y(sim.diskInfo.rIn);
      g.fillRect(x0 + 2, y1, 10, y2 - y1);
    }
    const mark = (r, color, label, left = false) => {
      const yy = Math.round(y(r)) + 0.5;
      g.strokeStyle = color;
      g.beginPath();
      g.moveTo(left ? x0 - 12 : x0 - 2, yy);
      g.lineTo(left ? x0 + 2 : x0 + 14, yy);
      g.stroke();
      g.fillStyle = color;
      g.textAlign = left ? 'right' : 'left';
      g.fillText(label, left ? x0 - 15 : x0 + 16, yy + 3);
    };
    mark(sim.rIsco, 'rgba(255,177,74,0.9)', 'ISCO');
    mark(sim.rPhPro, 'rgba(178,160,255,0.9)', 'фот.');
    mark(sim.hz.rPlus, 'rgba(255,255,255,0.95)', 'r₊', true);
    if (sim.a > 0) mark(sim.hz.rMinus, 'rgba(255,90,72,0.9)', 'r₋', true);
    // корабль
    const ys = y(D.r);
    g.fillStyle = D.outside ? '#ffd27a' : '#ff5a48';
    g.beginPath();
    g.moveTo(x0 + 3, ys);
    g.lineTo(x0 + 13, ys - 6);
    g.lineTo(x0 + 13, ys + 6);
    g.closePath();
    g.fill();
  }

  update(dt, ctx) {
    if (this.stageTimer > 0) {
      this.stageTimer -= dt;
      if (this.stageTimer <= 0) this.k.journal.classList.remove('show');
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.k.hint.classList.add('gone');
    }
    for (const i of this.logItems) i.t -= dt;
    const before = this.logItems.length;
    this.logItems = this.logItems.filter((i) => i.t > 0);
    if (!this.visible) return;
    this.updateMarker(ctx);
    this.timer -= dt;
    if (this.timer > 0) {
      if (before !== this.logItems.length) this.renderLog();
      return;
    }
    this.timer = 0.1;
    this.renderLog();
    const { sim, derived: D, fps, resScale, settings, modeLabel, camLabel } = ctx;
    const S = sim.S;
    const set = (k, v, cls) => this.set(k, v, cls);

    set('mode', modeLabel);
    set('cam', camLabel);
    set('band', BANDS[settings.band]);
    set('exp', `ЭКСП · ${EXPOSURE_MODES[settings.exposureMode].short}${settings.ev ? ` ${settings.ev > 0 ? '+' : ''}${settings.ev}` : ''}`);
    const w = sim.effectiveWarp ?? sim.warp;
    set('warp', sim.paused ? 'ПАУЗА' : `×${formatSci(sim.warp, 2)}${sim.warpLimited ? ` → ×${formatSci(w, 2)}` : ''}`, sim.paused || sim.warpLimited ? 'warn' : '');
    set('pausebtn', sim.paused ? '▶' : '❚❚');
    set('perf', `${fps.toFixed(0)} FPS · ${Math.round(resScale * 100)}% · ${settings.qualityLabel}`);
    set('bh', `M ${formatSci(sim.params.massSolar, 2)} M☉ · a ${sim.a.toFixed(2)}`);

    set('r', formatSci(D.r, 4), D.outside ? '' : 'bad');
    set('rsub', `${formatDistance(D.r * S.L)} · ${formatSci(D.r / sim.hz.rPlus, 3)} r₊`);
    set('dh', D.outside ? formatDistance((D.r - sim.hz.rPlus) * S.L) : 'под горизонтом', D.outside ? '' : 'bad');
    set('v', D.outside && isFinite(D.vZamo) ? `${formatSci(D.vZamo, 3)} c` : 'нет ZAMO');
    set('vr', `${formatSci(D.vRain, 3)} c`);
    set('acc', `${formatSci(D.thrustG, 3)} g${sim.drive().compensated ? ' ⚠' : ''}`);
    set('hover', D.outside && isFinite(D.hoverG) ? `${formatSci(D.hoverG, 3)} g` : 'невозможно', D.outside && isFinite(D.hoverG) && D.hoverG < 10 ? '' : 'warn');
    set('drag', sim.a === 0 ? '0' : isFinite(D.omegaDrag) && D.omegaDrag > 0 ? `ω ${formatSci(D.omegaDrag / S.T, 2)} с⁻¹` : '—');
    this.drawLadder(sim, D);

    set('tau', formatClock(D.tau * S.T));
    set('tbl', D.outside ? formatClock(D.tBL * S.T) : '∞', D.outside ? '' : 'bad');
    const dtdt = isFinite(D.dTauDt) ? D.dTauDt : 0;
    this.k.dtbar.style.width = `${(100 * Math.max(0, Math.min(1, dtdt))).toFixed(1)}%`;
    set('dtdt', isFinite(D.dTauDt) ? formatSci(D.dTauDt, 4) : '—');
    set('alpha', isFinite(D.alpha) ? formatSci(D.alpha, 4) : '—');
    set('gamma', isFinite(D.gZamo) ? formatSci(D.gZamo, 4) : '—');
    const p = D.prediction;
    let tth = '…';
    if (!D.outside) tth = isFinite(p?.tauToEnd) ? `пройден · до конца модели ${formatDuration(p.tauToEnd * S.T)}` : 'пройден';
    else if (p && isFinite(p.tauToHorizon)) tth = formatDuration(p.tauToHorizon * S.T);
    else if (p?.status === 'escape') tth = 'не пересечёт (уход)';
    else if (p?.status === 'bound') tth = 'не пересечёт';
    set('tth', tth, !D.outside ? 'bad' : isFinite(p?.tauToHorizon) ? 'warn' : '');
    set('radio', `×${formatSci(D.rxRatio, 3)} / ${isFinite(D.txRatio) ? '×' + formatSci(D.txRatio, 3) : 'не дойдёт'}`, isFinite(D.txRatio) ? '' : 'bad');

    const st = sim.structure;
    const integ = st.destroyed ? 0 : st.integrity;
    const nOn = Math.round(integ * this.segs.length);
    const segCls = integ > 0.75 ? 'ok' : integ > 0.35 ? 'warn' : 'bad';
    this.segs.forEach((s, i) => {
      const c = i < nOn ? segCls : '';
      if (s.className !== c) s.className = c;
    });
    const fr = Math.min(1, st.stressFrac);
    this.k.sbar.style.width = `${(100 * Math.max(fr, fr > 0 ? 0.004 : 0)).toFixed(2)}%`;
    this.k.sbar.className = fr > 0.8 ? 'bad' : fr > 0.3 ? 'warn' : '';
    this.k.yield.style.left = `${(100 * st.spec.yield) / st.spec.ultimate}%`;
    set('stress', `${formatSci(st.stress / 1e6, 3)} МПа`, fr > 0.8 ? 'bad' : fr > 0.3 ? 'warn' : '');
    set('tidal', `${formatSci(st.tidalAcrossShipG, 3)} g`, st.tidalAcrossShipG > 30 ? 'bad' : st.tidalAcrossShipG > 1 ? 'warn' : '');
    set('crew', st.destroyed ? 'КОРАБЛЬ РАЗРУШЕН' : `ЭКИПАЖ: ${st.crew.toUpperCase()}`, st.destroyed || st.crewLevel >= 2 ? 'bad' : st.crewLevel ? 'warn' : '');
    const sysHtml = st.systems.map((s) => `<span class="${s.ok ? 'ok' : 'bad'}" title="${s.name}">${s.name.split(' ')[0]}</span>`).join('');
    if (this._sys !== sysHtml) {
      this.k.systems.innerHTML = sysHtml;
      this._sys = sysHtml;
    }

    set(
      'compact',
      `r ${formatSci(D.r, 3)}M · v ${formatSci(isFinite(D.vZamo) ? D.vZamo : D.vRain, 3)}c · τ ${formatClock(D.tau * S.T)} · t∞ ${D.outside ? formatClock(D.tBL * S.T) : '∞'} · приливы ${formatSci(st.tidalAcrossShipG, 2)}g`,
    );

    const warns = [];
    if (!D.outside && !sim.ended) warns.push('ПОД ГОРИЗОНТОМ — ВОЗВРАТ НЕВОЗМОЖЕН');
    else if (D.outside && D.r < sim.rPhPro * 1.05) warns.push('ВНУТРИ ФОТОННОЙ СФЕРЫ');
    else if (p && isFinite(p.tauToHorizon) && p.tauToHorizon * S.T < 600) warns.push('БАЛЛИСТИЧЕСКИЙ ЗАХВАТ');
    if (st.stressFrac > 0.5 && !st.destroyed) warns.push('КРИТИЧЕСКИЕ ПРИЛИВНЫЕ НАГРУЗКИ');
    if (st.destroyed) warns.push('КОРАБЛЬ РАЗРУШЕН');
    if (D.outside && D.r < D.ergoR) warns.push('ЭРГОСФЕРА');
    set('warn', warns.join('   ·   '), warns.length ? 'on' : '');
    this.set('mlabel', D.outside ? `Sgr A* · ${formatSci(D.r, 3)} M` : 'центр');
  }
}
