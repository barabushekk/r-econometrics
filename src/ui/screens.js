// Экраны: старт (выбор режима), справка, завершение эксперимента.

import { START_PRESETS, QUALITY } from '../config.js';
import { formatClock, formatSci } from '../physics/units.js';

export const MODES = {
  exploration: { label: 'Исследование', desc: 'Свободный полёт: тяга, ориентация, ускорение времени. Можно облететь ЧД, исследовать диск и пересечь горизонт.' },
  freefall: { label: 'Свободное падение', desc: 'Двигатели отключены: корабль движется строго по геодезической. Управление — только обзор и ориентация.' },
  lab: { label: 'Научная лаборатория', desc: 'Изменяйте массу, вращение, параметры диска и начальные условия; свободная камера-зонд (C).' },
  cinematic: { label: 'Кинематографический', desc: 'Максимальное качество, плавная камера, минимум интерфейса.' },
};

export class Screens {
  constructor(root, { onStart, onRestart, onLab }) {
    this.root = root;
    this.onStart = onStart;
    this.start = document.createElement('div');
    this.start.className = 'screen start';
    const isTouch = matchMedia('(pointer: coarse)').matches;
    this.start.innerHTML = `
      <div class="card">
        <span class="eyebrow">ИССЛЕДОВАТЕЛЬСКИЙ КОРАБЛЬ «ГОРИЗОНТ» · ЦЕНТР ГАЛАКТИКИ</span>
        <h1>Горизонт событий</h1>
        <p class="lead">Полёт к сверхмассивной чёрной дыре массой 4·10⁶ M☉ — как Sagittarius A*. Каждый пиксель — световой луч, рассчитанный в метрике Керра в реальном времени; корабль движется по уравнениям общей теории относительности.</p>
        <div class="facts"><span>масса <b>4.0·10⁶ M☉</b></span><span>радиус горизонта <b>≈ 11.8 млн км</b></span><span>единица времени GM/c³ <b>19.7 с</b></span><span>до Земли <b>≈ 26 000 св. лет</b></span></div>
        <div class="modes">${Object.entries(MODES)
          .map(([k, m], i) => `<label class="mode"><input type="radio" name="mode" value="${k}" ${i === 0 ? 'checked' : ''}><b>${m.label}</b><span>${m.desc}</span></label>`)
          .join('')}</div>
        <div class="opts">
          <label>Начальные условия <select name="preset">${Object.entries(START_PRESETS)
            .map(([k, v]) => `<option value="${k}">${v.label}</option>`)
            .join('')}</select></label>
          <label>Качество <select name="quality">${Object.entries(QUALITY)
            .map(([k, v]) => `<option value="${k}" ${k === (isTouch ? 'low' : 'medium') ? 'selected' : ''}>${v.label}</option>`)
            .join('')}</select></label>
          <label>Метрика <select name="metric"><option value="kerr">Керр, a = 0.6</option><option value="schwarzschild">Шварцшильд, a = 0</option></select></label>
        </div>
        <button class="primary big" data-act="go">Начать</button>
        <details><summary>Управление</summary>${HELP_HTML}</details>
        <p class="fine">Звук есть только внутри корабля. Для обзора мышью кликните по изображению (захват указателя). Требуется браузер с WebGL 2.</p>
      </div>`;
    root.appendChild(this.start);
    this.start.querySelector('[data-act=go]').addEventListener('click', () => {
      const f = (n) => this.start.querySelector(`[name=${n}]${n === 'mode' ? ':checked' : ''}`).value;
      this.start.classList.add('hidden');
      onStart({ mode: f('mode'), preset: f('preset'), quality: f('quality'), metric: f('metric') });
    });

    this.help = document.createElement('div');
    this.help.className = 'screen help hidden';
    this.help.innerHTML = `<div class="card"><h2>Справка</h2>${HELP_HTML}${PHYS_HTML}<button class="primary" data-act="close">Закрыть</button></div>`;
    root.appendChild(this.help);
    this.help.querySelector('[data-act=close]').addEventListener('click', () => this.toggleHelp(false));

    this.end = document.createElement('div');
    this.end.className = 'screen end hidden';
    root.appendChild(this.end);
    this.onRestart = onRestart;
    this.onLab = onLab;
  }

  toggleHelp(v) {
    this.help.classList.toggle('hidden', v === undefined ? !this.help.classList.contains('hidden') : !v);
  }

  showEnd(sim, reason) {
    const S = sim.S;
    const st = sim.structure;
    this.end.innerHTML = `<div class="card">
      <h2>Научная симуляция завершена</h2>
      <p>${reason}</p>
      <div class="stats">
        <div><span>Собственное время полёта</span><b>${formatClock(sim.tau * S.T)}</b></div>
        <div><span>Время от горизонта до конца (по часам корабля)</span><b>${isFinite(sim.crossTau) ? formatSci((sim.tau - sim.crossTau) * S.T, 3) + ' с' : '—'}</b></div>
        <div><span>Конечный радиус</span><b>${formatSci(sim.r, 3)} M</b></div>
        <div><span>Максимальное напряжение корпуса</span><b>${formatSci(st.maxStressFrac * 100, 3)}% предела прочности</b></div>
        <div><span>Состояние корабля</span><b>${st.destroyed ? 'разрушен приливными силами' : 'цел'}</b></div>
        <div><span>Удалённый наблюдатель</span><b>${isFinite(sim.crossTau) ? 'видит корабль вечно «застывшим» у горизонта, всё более тусклым и красным' : '—'}</b></div>
      </div>
      <div class="btns"><button class="primary" data-act="restart">Перезапуск (R)</button><button data-act="lab">Изменить параметры</button><button data-act="close">Остаться и смотреть</button></div>
    </div>`;
    this.end.classList.remove('hidden');
    this.end.querySelector('[data-act=restart]').addEventListener('click', () => this.onRestart());
    this.end.querySelector('[data-act=lab]').addEventListener('click', () => this.onLab());
    this.end.querySelector('[data-act=close]').addEventListener('click', () => this.hideEnd());
  }

  hideEnd() {
    this.end.classList.add('hidden');
  }
}

const HELP_HTML = `<table class="keys">
<tr><td>W / S</td><td>тяга вперёд / назад</td></tr>
<tr><td>A / D</td><td>боковая тяга</td></tr>
<tr><td>Space / Ctrl</td><td>тяга вверх / вниз</td></tr>
<tr><td>Shift</td><td>форсаж</td></tr>
<tr><td>Мышь</td><td>обзор (клик — захват указателя)</td></tr>
<tr><td>↑ ↓ ← →</td><td>тангаж и рысканье корабля</td></tr>
<tr><td>Q / E</td><td>крен</td></tr>
<tr><td>ПКМ или V (удерживать)</td><td>развернуть корабль туда, куда смотрите</td></tr>
<tr><td>. / , (или ] / [)</td><td>ускорение / замедление времени</td></tr>
<tr><td>F</td><td>кабина ↔ внешняя камера (колесо — дистанция)</td></tr>
<tr><td>C</td><td>свободная камера-зонд</td></tr>
<tr><td>T</td><td>двигатели вкл/выкл (свободное падение)</td></tr>
<tr><td>B</td><td>диапазон: видимый / ИК / научный</td></tr>
<tr><td>X</td><td>экспозиция: глаз / камера / по фону / ручная</td></tr>
<tr><td>G</td><td>координатная сетка неба</td></tr>
<tr><td>Esc / «МЕНЮ»</td><td>меню паузы</td></tr>
<tr><td>Tab</td><td>научная лаборатория (параметры)</td></tr>
<tr><td>H / P / R</td><td>скрыть интерфейс / пауза / перезапуск</td></tr>
<tr><td>\` (тильда)</td><td>качество Low → Ultra</td></tr>
<tr><td>M / F1</td><td>звук / справка</td></tr>
</table>`;

const PHYS_HTML = `<div class="phys">
<h3>Что моделируется</h3>
<ul>
<li>Метрика Керра в координатах Керра–Шилда (регулярны на горизонте). a = 0 — Шварцшильд.</li>
<li>Каждый пиксель — луч, проинтегрированный назад во времени по изотропной геодезической (РК4, адаптивный шаг). Тень, фотонное кольцо, многократные изображения, искажение диска — следствия расчёта.</li>
<li>Цвет: чёрное тело температуры g·T, где g — полное отношение частот (гравитационное смещение + Доплер + аберрация). Усиление яркости — из инварианта I_ν/ν³.</li>
<li>Диск: тонкий диск Новикова–Торна (температура из Ṁ и M) с объёмной турбулентной структурой и серой атмосферой Эддингтона.</li>
<li>Корабль: геодезическая с собственным ускорением тяги, ориентация переносится по Ферми–Уокеру (гироскопы).</li>
<li>Приливы: тензор Римана в системе корабля; напряжения корпуса и экипажа считаются из него.</li>
<li>Часы: τ — собственное время; t — время Бойера–Линдквиста удалённого наблюдателя.</li>
</ul>
<p>Подробности и все приближения — в docs/PHYSICS.md.</p></div>`;
