// Минималистичный научный HUD поверх изображения.

import { formatClock, formatDuration, formatDistance, formatSci } from '../physics/units.js';

const STAGES = {
  1: [
    'Этап 1 · Дальний подход',
    'Чёрная дыра выглядит небольшим тёмным пятном: тень почти не искажает звёзды вокруг. Угловой радиус тени для далёкого наблюдателя ≈ 3√3·GM/(c²·r). Используйте ускорение времени ( . / , ) — свободное падение отсюда занимает сутки. Звёзды рядом с ярким диском глаз не различит (яркость поверхности диска сравнима с солнечной): клавиша X — экспозиция «по фону», B — научный режим, Tab — можно отключить диск.',
  ],
  2: [
    'Этап 2 · Гравитационное линзирование',
    'Изображения звёзд за чёрной дырой смещаются от неё, вытягиваются в дуги; по другую сторону тени появляются вторичные изображения. Около тени — кольцо Эйнштейна. Всё это — результат трассировки лучей, а не наложенный эффект.',
  ],
  3: [
    'Этап 3 · Сильное искривление света',
    'Свет от дальней стороны диска огибает чёрную дыру: её изображение видно над и под тенью. Тонкое фотонное кольцо образуют лучи, сделавшие пол-оборота и больше. Приближающаяся сторона диска ярче и голубее (доплеровское усиление), удаляющаяся — тусклее и краснее.',
  ],
  4: [
    'Этап 4 · Окрестность горизонта',
    'Растут гравитационное смещение частот и разница хода часов, небо сжимается к направлению движения (аберрация). Для зависания здесь потребовались бы огромные ускорения — см. прибор «ускорение для зависания».',
  ],
  6: [
    'Этап 6 · Под горизонтом событий',
    'Координата r стала временеподобной: её уменьшение неизбежно, как ход времени. Тяга в любую сторону лишь сокращает оставшееся собственное время. Внешняя Вселенная видна — её свет продолжает падать внутрь вслед за вами.',
  ],
};

export class Hud {
  constructor(root) {
    this.root = root;
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud-top">
        <div class="hud-mode"><span data-k="mode"></span><span class="sep">·</span><span data-k="band"></span><span class="sep">·</span><span data-k="exp"></span></div>
        <div class="hud-warp" data-k="warp"></div>
        <div class="hud-perf" data-k="perf"></div>
      </div>
      <div class="hud-warn" data-k="warn"></div>
      <div class="hud-compact" data-k="compact"></div>
      <div class="hud-panel left">
        <h4>НАВИГАЦИЯ</h4>
        <div class="row"><span>Масса ЧД</span><b data-k="mass"></b></div>
        <div class="row"><span>Спин a</span><b data-k="spin"></b></div>
        <div class="row"><span>Горизонт r₊</span><b data-k="rplus"></b></div>
        <div class="row"><span>Расстояние r</span><b data-k="r"></b></div>
        <div class="row"><span></span><b data-k="rkm" class="sub"></b></div>
        <div class="row"><span>До горизонта (r − r₊)</span><b data-k="dh"></b></div>
        <div class="row"><span data-k="vlabel">Скорость отн. ZAMO</span><b data-k="v"></b></div>
        <div class="row"><span>Скорость отн. падающего с ∞</span><b data-k="vr"></b></div>
        <div class="row"><span>Собств. ускорение</span><b data-k="acc"></b></div>
        <div class="row"><span>Для зависания нужно</span><b data-k="hover"></b></div>
        <div class="row"><span>Увлечение ИСО ω</span><b data-k="drag"></b></div>
      </div>
      <div class="hud-panel right">
        <h4>ВРЕМЯ</h4>
        <div class="row"><span>Часы корабля τ</span><b data-k="tau"></b></div>
        <div class="row"><span>Удалённый наблюдатель t</span><b data-k="tbl"></b></div>
        <div class="row"><span>dτ/dt</span><b data-k="dtdt"></b></div>
        <div class="row"><span>Гравитац. фактор α</span><b data-k="alpha"></b></div>
        <div class="row"><span>Лоренц-фактор γ</span><b data-k="gamma"></b></div>
        <div class="row"><span>До горизонта по τ</span><b data-k="tth"></b></div>
        <h4>КОРПУС</h4>
        <div class="row"><span>Приливы по длине</span><b data-k="tidal"></b></div>
        <div class="row"><span>Напряжение</span><b data-k="stress"></b></div>
        <div class="row"><span>Целостность</span><b data-k="integ"></b></div>
        <div class="row"><span>Экипаж</span><b data-k="crew"></b></div>
      </div>
      <div class="hud-stage" data-k="stage"><h3></h3><p></p></div>
      <div class="hud-log" data-k="log"></div>
      <div class="hud-cross"></div>
      <div class="hud-hint" data-k="hint">Клик — захват мыши · WASD/Space/Ctrl — тяга · ←↑→↓ Q/E — ориентация · ПКМ/V — повернуть корабль по взгляду · . , — время · Tab — лаборатория · F1 — справка</div>
    `;
    root.appendChild(this.el);
    this.k = {};
    for (const n of this.el.querySelectorAll('[data-k]')) {
      this.k[n.dataset.k] = n;
      n.dataset.base = n.className;
    }
    this.timer = 0;
    this.stageTimer = 0;
    this.visible = true;
    this.minimal = false;
    this.logItems = [];
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
    this.k.stage.querySelector('h3').textContent = s[0];
    this.k.stage.querySelector('p').textContent = s[1] + (extra ? ' ' + extra : '');
    this.k.stage.classList.add('show');
    this.stageTimer = 14;
  }

  showMessage(title, text, secs = 14) {
    this.k.stage.querySelector('h3').textContent = title;
    this.k.stage.querySelector('p').textContent = text;
    this.k.stage.classList.add('show');
    this.stageTimer = secs;
  }

  log(text, cls = '') {
    if (!text) return;
    this.logItems.push({ text, cls, t: 12 });
    if (this.logItems.length > 6) this.logItems.shift();
    this.renderLog();
  }

  renderLog() {
    this.k.log.innerHTML = this.logItems.map((i) => `<div class="${i.cls}" style="opacity:${Math.min(1, i.t / 3)}">${i.text}</div>`).join('');
  }

  update(dt, ctx) {
    if (this.stageTimer > 0) {
      this.stageTimer -= dt;
      if (this.stageTimer <= 0) this.k.stage.classList.remove('show');
    }
    let changed = false;
    for (const i of this.logItems) {
      i.t -= dt;
      changed = true;
    }
    this.logItems = this.logItems.filter((i) => i.t > 0);
    this.timer -= dt;
    if (this.timer > 0 || !this.visible) {
      if (changed && Math.random() < 0.1) this.renderLog();
      return;
    }
    this.timer = 0.1;
    this.renderLog();
    const { sim, derived: D, fps, resScale, settings, modeLabel } = ctx;
    const S = sim.S;
    const set = (k, v, cls) => {
      const n = this.k[k];
      if (!n) return;
      if (n.textContent !== v) n.textContent = v;
      const c = [n.dataset.base, cls].filter(Boolean).join(' ');
      if (n.className !== c) n.className = c;
    };
    set('mode', modeLabel);
    set('band', ['Видимый свет', 'ИК 1–5 мкм', 'Научный (g)'][settings.band]);
    set('exp', ['Экспозиция: глаз', 'Экспозиция: по фону', 'Экспозиция: ручная'][settings.exposureMode] + (settings.ev ? ` ${settings.ev > 0 ? '+' : ''}${settings.ev} EV` : ''));
    const w = sim.effectiveWarp ?? sim.warp;
    set('warp', sim.paused ? '❚❚ ПАУЗА' : `ВРЕМЯ ×${formatSci(sim.warp, 2)}${sim.warpLimited ? ` → ×${formatSci(w, 2)} (огр. точностью)` : ''}`, sim.warpLimited ? 'warn' : '');
    set('perf', `${fps.toFixed(0)} FPS · ${Math.round(resScale * 100)}% · ${settings.qualityLabel}`);
    set('mass', `${formatSci(sim.params.massSolar, 3)} M☉`);
    set('spin', sim.a === 0 ? '0 (Шварцшильд)' : sim.a.toFixed(3));
    set('rplus', `${formatDistance(sim.hz.rPlus * S.L)}`);
    set('r', `${formatSci(D.r, 4)} M · ${formatSci(D.r / sim.hz.rPlus, 4)} r₊`, D.outside ? '' : 'bad');
    set('rkm', formatDistance(D.r * S.L));
    set('dh', D.outside ? formatDistance((D.r - sim.hz.rPlus) * S.L) : 'под горизонтом', D.outside ? '' : 'bad');
    if (D.outside && isFinite(D.vZamo)) {
      set('vlabel', 'Скорость отн. ZAMO');
      set('v', `${formatSci(D.vZamo, 4)} c (${formatSci(D.vZamo * 299792.458, 4)} км/с)`);
    } else {
      set('vlabel', 'Скорость отн. ZAMO');
      set('v', 'нет ZAMO под горизонтом');
    }
    set('vr', `${formatSci(D.vRain, 4)} c`);
    set('acc', `${formatSci(D.thrustG, 3)} g${sim.drive().compensated ? ' (компенс.)' : ''}`);
    set('hover', D.outside ? (isFinite(D.hoverG) ? `${formatSci(D.hoverG, 3)} g` : 'невозможно') : 'невозможно', D.outside && isFinite(D.hoverG) && D.hoverG < 10 ? '' : 'warn');
    set(
      'drag',
      sim.a === 0 ? '0 (нет вращения)' : isFinite(D.omegaDrag) && D.omegaDrag > 0 ? `${formatSci(D.omegaDrag / S.T, 3)} рад/с (оборот за ${formatDuration((2 * Math.PI * S.T) / D.omegaDrag)})` : '—',
    );
    set('tau', formatClock(D.tau * S.T));
    set('tbl', D.outside ? formatClock(D.tBL * S.T) : '∞', D.outside ? '' : 'bad');
    set('dtdt', isFinite(D.dTauDt) ? formatSci(D.dTauDt, 5) : '—');
    set('alpha', isFinite(D.alpha) ? formatSci(D.alpha, 5) : '—');
    set('gamma', isFinite(D.gZamo) ? formatSci(D.gZamo, 5) : '—');
    const p = D.prediction;
    let tth = '…';
    if (!D.outside) tth = isFinite(p?.tauToEnd) ? `пройден; до конца модели ${formatDuration(p.tauToEnd * S.T)}` : 'пройден';
    else if (p && isFinite(p.tauToHorizon)) tth = formatDuration(p.tauToHorizon * S.T);
    else if (p?.status === 'escape') tth = 'не пересечёт (уход)';
    else if (p?.status === 'bound') tth = 'не пересечёт (за горизонт прогноза)';
    set('tth', tth, !D.outside ? 'bad' : isFinite(p?.tauToHorizon) ? 'warn' : '');
    const st = sim.structure;
    set('tidal', `${formatSci(st.tidalAcrossShipG, 3)} g`, st.tidalAcrossShipG > 30 ? 'bad' : st.tidalAcrossShipG > 1 ? 'warn' : '');
    set('stress', `${formatSci(st.stress / 1e6, 3)} МПа (${formatSci(100 * st.stressFrac, 3)}%)`, st.stressFrac > 0.8 ? 'bad' : st.stressFrac > 0.3 ? 'warn' : '');
    set('integ', st.destroyed ? 'РАЗРУШЕН' : `${(100 * st.integrity).toFixed(1)}%`, st.destroyed ? 'bad' : st.integrity < 1 ? 'warn' : '');
    set('crew', st.crew, ['', 'warn', 'bad', 'bad'][st.crewLevel]);
    set(
      'compact',
      `r ${formatSci(D.r, 3)}M · v ${formatSci(isFinite(D.vZamo) ? D.vZamo : D.vRain, 3)}c · τ ${formatClock(D.tau * S.T)} · t ${D.outside ? formatClock(D.tBL * S.T) : '∞'} · приливы ${formatSci(st.tidalAcrossShipG, 2)}g · корпус ${st.destroyed ? '✕' : (100 * st.integrity).toFixed(0) + '%'}`,
    );

    const warns = [];
    if (!D.outside && !sim.ended) warns.push('ПОД ГОРИЗОНТОМ · ВОЗВРАТ НЕВОЗМОЖЕН');
    else if (D.outside && D.r < sim.rPhPro * 1.05 && D.r > sim.hz.rPlus) warns.push('ВНУТРИ ФОТОННОЙ СФЕРЫ');
    else if (p && isFinite(p.tauToHorizon) && p.tauToHorizon * S.T < 600) warns.push('БАЛЛИСТИЧЕСКИЙ ЗАХВАТ: ПАДЕНИЕ ЗА ГОРИЗОНТ');
    if (st.stressFrac > 0.5 && !st.destroyed) warns.push('КРИТИЧЕСКИЕ ПРИЛИВНЫЕ НАГРУЗКИ');
    if (st.destroyed) warns.push('КОРАБЛЬ РАЗРУШЕН');
    if (D.cosT !== undefined && D.outside && D.r < D.ergoR) warns.push('ЭРГОСФЕРА: ПОКОЙ НЕВОЗМОЖЕН');
    set('warn', warns.join('  ·  '), warns.length ? 'on' : '');
  }
}
