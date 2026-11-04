// Меню паузы: открывается кнопкой «Меню», клавишей Esc или при потере
// захвата указателя во время полёта. Симуляция на это время ставится на паузу.

export class PauseMenu {
  constructor(root, onAction) {
    this.onAction = onAction;
    this.el = document.createElement('div');
    this.el.className = 'pause-menu hidden';
    this.el.innerHTML = `
      <div class="pm-card" role="dialog" aria-modal="true" aria-labelledby="pm-title">
        <div class="pm-head">
          <span class="pm-eyebrow">ИК «ГОРИЗОНТ» · БОРТОВОЙ КОМПЬЮТЕР</span>
          <h2 id="pm-title">Пауза</h2>
          <p class="pm-status" data-k="status"></p>
        </div>
        <nav class="pm-list">
          <button data-act="resume" class="primary"><b>Продолжить полёт</b><span>Esc</span></button>
          <button data-act="restart"><b>Перезапустить эксперимент</b><span>R</span></button>
          <button data-act="lab"><b>Научная лаборатория</b><span>масса, спин, диск, начальные условия · Tab</span></button>
          <button data-act="settings"><b>Изображение и управление</b><span>качество, экспозиция, мышь, поле зрения</span></button>
          <button data-act="help"><b>Справка и клавиши</b><span>F1</span></button>
          <button data-act="mainMenu"><b>Главное меню</b><span>выбор режима и начальных условий</span></button>
        </nav>
        <div class="pm-foot">
          <label class="pm-toggle"><input type="checkbox" id="pm-sound" data-act="mute"> звук выключен</label>
          <span>Изображение — трассировка лучей в метрике Керра; продолжает уточняться, пока стоит пауза.</span>
        </div>
      </div>`;
    root.appendChild(this.el);
    this.open = false;
    for (const b of this.el.querySelectorAll('button[data-act]')) {
      b.addEventListener('click', () => this.onAction(b.dataset.act));
    }
    this.el.querySelector('#pm-sound').addEventListener('change', () => this.onAction('mute'));
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.onAction('resume');
    });
  }

  show(statusText, muted) {
    this.open = true;
    this.el.querySelector('[data-k=status]').textContent = statusText;
    this.el.querySelector('#pm-sound').checked = !!muted;
    this.el.classList.remove('hidden');
    this.el.querySelector('button.primary').focus({ preventScroll: true });
  }

  hide() {
    this.open = false;
    this.el.classList.add('hidden');
  }
}
