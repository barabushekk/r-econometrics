// Научная панель: параметры ЧД, диска, начальных условий, изображения.

import { START_PRESETS, QUALITY, EXPOSURE_MODES } from '../config.js';
import { DRIVES } from '../sim/simulation.js';
import { diskProfile } from '../physics/disk.js';
import { horizons, iscoRadius } from '../physics/kerr.js';
import { bhScales, formatSci, formatDistance } from '../physics/units.js';

export class SciencePanel {
  constructor(root, getState, onChange) {
    this.getState = getState;
    this.onChange = onChange;
    this.el = document.createElement('aside');
    this.el.className = 'sci-panel';
    root.appendChild(this.el);
    this.open = false;
    this.render();
  }

  toggle(v = !this.open) {
    this.open = v;
    this.el.classList.toggle('open', v);
    if (v) this.render();
  }

  render() {
    const s = this.getState();
    const P = s.params;
    const presetOpts = Object.entries(START_PRESETS)
      .map(([k, v]) => `<option value="${k}" ${s.presetKey === k ? 'selected' : ''}>${v.label}</option>`)
      .join('');
    const qOpts = Object.entries(QUALITY)
      .map(([k, v]) => `<option value="${k}" ${s.settings.quality === k ? 'selected' : ''}>${v.label}</option>`)
      .join('');
    const dOpts = Object.entries(DRIVES)
      .map(([k, v]) => `<option value="${k}" ${P.drive === k ? 'selected' : ''}>${v.label}</option>`)
      .join('');
    const cust = s.custom;
    this.el.innerHTML = `
      <header><h2>Научная лаборатория</h2><button class="close" data-act="close">✕</button></header>
      <section>
        <h3>Чёрная дыра <small>(изменения — с перезапуском)</small></h3>
        <label>Метрика
          <select data-p="metric">
            <option value="schwarzschild" ${P.metric === 'schwarzschild' ? 'selected' : ''}>Шварцшильд (a = 0)</option>
            <option value="kerr" ${P.metric === 'kerr' ? 'selected' : ''}>Керр (вращающаяся)</option>
          </select></label>
        <label>Масса: <b data-o="mass"></b>
          <input type="range" data-p="logMass" min="0.5" max="10.3" step="0.05" value="${Math.log10(P.massSolar)}"></label>
        <label class="${P.metric === 'kerr' ? '' : 'disabled'}">Спин a = J c/(G M²): <b data-o="spin"></b>
          <input type="range" data-p="spin" min="0" max="0.998" step="0.001" value="${P.spin}" ${P.metric === 'kerr' ? '' : 'disabled'}></label>
        <div class="derived" data-o="bhinfo"></div>
      </section>
      <section>
        <h3>Аккреционный диск <small>(Новиков–Торн, применяется сразу)</small></h3>
        <label class="chk"><input type="checkbox" data-p="diskOn" ${P.disk.enabled ? 'checked' : ''}> диск включён</label>
        <label>Темп аккреции ṁ = Ṁ/Ṁ_Эдд: <b data-o="edd"></b>
          <input type="range" data-p="logEdd" min="-9" max="0" step="0.1" value="${Math.log10(P.disk.eddRatio)}"></label>
        <label>Внешний радиус: <b data-o="rout"></b>
          <input type="range" data-p="rOut" min="10" max="120" step="1" value="${P.disk.rOut}"></label>
        <label>Полутолщина H/r: <b data-o="hr"></b>
          <input type="range" data-p="hr" min="0.005" max="0.15" step="0.005" value="${P.disk.hr}"></label>
        <label>Оптическая толщина τ₀: <b data-o="tau0"></b>
          <input type="range" data-p="logTau" min="-2" max="2" step="0.05" value="${Math.log10(P.disk.tau0)}"></label>
        <label>Турбулентность: <b data-o="turb"></b>
          <input type="range" data-p="turb" min="0" max="1.2" step="0.05" value="${P.disk.turbulence}"></label>
        <div class="derived" data-o="diskinfo"></div>
      </section>
      <section>
        <h3>Начальные условия <small>(с перезапуском)</small></h3>
        <label>Пресет <select data-p="preset">${presetOpts}<option value="custom" ${s.presetKey === 'custom' ? 'selected' : ''}>Свои параметры…</option></select></label>
        <div class="custom ${s.presetKey === 'custom' ? '' : 'hidden'}">
          <label>r₀ (M): <b data-o="cr"></b><input type="range" data-p="cr" min="1.5" max="2000" step="0.5" value="${cust.r}"></label>
          <label>Полярный угол θ₀ (°): <b data-o="cth"></b><input type="range" data-p="cth" min="5" max="175" step="1" value="${cust.thetaDeg}"></label>
          <label>v_r отн. ZAMO (c): <b data-o="cvr"></b><input type="range" data-p="cvr" min="-0.9" max="0.9" step="0.01" value="${cust.vr}"></label>
          <label>v_φ отн. ZAMO (c): <b data-o="cvp"></b><input type="range" data-p="cvp" min="-0.9" max="0.9" step="0.01" value="${cust.vph}"></label>
        </div>
        <label>Двигатель <select data-p="drive">${dOpts}</select></label>
      </section>
      <section data-section="image">
        <h3>Изображение</h3>
        <label>Диапазон <select data-p="band">
          <option value="0" ${s.settings.band === 0 ? 'selected' : ''}>Видимый свет (CIE 1931 → sRGB)</option>
          <option value="1" ${s.settings.band === 1 ? 'selected' : ''}>Условный ИК 1–5 мкм (ложные цвета)</option>
          <option value="2" ${s.settings.band === 2 ? 'selected' : ''}>Научный: смещение частоты g</option>
        </select></label>
        <label>Экспозиция <select data-p="exposureMode">
          ${EXPOSURE_MODES.map((m, i) => `<option value="${i}" ${s.settings.exposureMode === i ? 'selected' : ''}>${m.label}</option>`).join('')}
        </select></label>
        <label>Ночная адаптация (модель зрения): <b data-o="fusion"></b><input type="range" data-p="fusion" min="0" max="0.7" step="0.02" value="${s.settings.fusion}"></label>
        <label>Поправка: <b data-o="ev"></b><input type="range" data-p="ev" min="-8" max="8" step="0.5" value="${s.settings.ev}"></label>
        <label>Ручная экспозиция log₂E: <b data-o="man"></b><input type="range" data-p="manual" min="-10" max="40" step="0.5" value="${s.settings.manualLogE}"></label>
        <label>Ореол (рассеяние в глазу): <b data-o="bloom"></b><input type="range" data-p="bloom" min="0" max="0.12" step="0.005" value="${s.settings.bloom}"></label>
        <label class="chk"><input type="checkbox" data-p="grid" ${s.settings.skyGrid ? 'checked' : ''}> координатная сетка неба (наглядно)</label>
        <label>Качество <select data-p="quality">${qOpts}</select></label>
        <label class="chk"><input type="checkbox" data-p="dynres" ${s.settings.dynamicRes ? 'checked' : ''}> динамическое разрешение</label>
        <label>Поле зрения: <b data-o="fov"></b><input type="range" data-p="fov" min="40" max="110" step="1" value="${s.settings.fov}"></label>
        <label>Чувствительность мыши: <b data-o="sens"></b><input type="range" data-p="sens" min="0.2" max="3" step="0.05" value="${s.settings.sensitivity}"></label>
        <label>Инерция камеры: <b data-o="smooth"></b><input type="range" data-p="smooth" min="0.01" max="0.6" step="0.01" value="${s.settings.smoothing}"></label>
        <label class="chk"><input type="checkbox" data-p="invertY" ${s.settings.invertY ? 'checked' : ''}> инвертировать ось Y</label>
      </section>
      <footer><button class="primary" data-act="restart">Применить и перезапустить</button></footer>
    `;
    this.bind();
    this.refreshOutputs();
  }

  bind() {
    for (const inp of this.el.querySelectorAll('[data-p]')) {
      const ev = inp.tagName === 'SELECT' || inp.type === 'checkbox' ? 'change' : 'input';
      inp.addEventListener(ev, () => {
        const p = inp.dataset.p;
        const v = inp.type === 'checkbox' ? inp.checked : inp.tagName === 'SELECT' ? inp.value : parseFloat(inp.value);
        this.onChange(p, v);
        if (p === 'metric' || p === 'preset') this.render();
        else this.refreshOutputs();
      });
    }
    this.el.querySelector('[data-act=close]').addEventListener('click', () => this.toggle(false));
    this.el.querySelector('[data-act=restart]').addEventListener('click', () => this.onChange('restart'));
  }

  refreshOutputs() {
    const s = this.getState();
    const P = s.params;
    const o = (k, v) => {
      const n = this.el.querySelector(`[data-o="${k}"]`);
      if (n) n.textContent = v;
    };
    const a = P.metric === 'kerr' ? P.spin : 0;
    const S = bhScales(P.massSolar);
    const hz = horizons(a);
    o('mass', `${formatSci(P.massSolar, 3)} M☉`);
    o('spin', a.toFixed(3));
    o(
      'bhinfo',
      `r₊ = ${hz.rPlus.toFixed(3)} M = ${formatDistance(hz.rPlus * S.L)} · ISCO = ${iscoRadius(a).toFixed(3)} M · единица времени GM/c³ = ${formatSci(S.T, 3)} с`,
    );
    o('edd', formatSci(P.disk.eddRatio, 2));
    o('rout', `${P.disk.rOut} M`);
    o('hr', P.disk.hr.toFixed(3));
    o('tau0', formatSci(P.disk.tau0, 3));
    o('turb', P.disk.turbulence.toFixed(2));
    const prof = diskProfile({ massSolar: P.massSolar, a, eddRatio: P.disk.eddRatio, rOut: P.disk.rOut });
    o(
      'diskinfo',
      `T_max = ${formatSci(prof.Tmax, 3)} К при r ≈ ${prof.rPeak.toFixed(1)} M · Ṁ = ${formatSci(prof.mdotSolarPerYear, 3)} M☉/год · L = ${formatSci(prof.luminosity, 3)} Вт · КПД η = ${(prof.eta * 100).toFixed(1)}%`,
    );
    const c = s.custom;
    o('cr', `${c.r}`);
    o('cth', `${c.thetaDeg}°`);
    o('cvr', `${c.vr}`);
    o('cvp', `${c.vph}`);
    o('ev', `${s.settings.ev > 0 ? '+' : ''}${s.settings.ev} EV`);
    o('man', `${s.settings.manualLogE}`);
    o('bloom', s.settings.bloom.toFixed(3));
    o('fusion', (s.settings.fusion ?? 0).toFixed(2));
    o('fov', `${s.settings.fov}°`);
    o('sens', s.settings.sensitivity.toFixed(2));
    o('smooth', `${s.settings.smoothing.toFixed(2)} с`);
  }
}
