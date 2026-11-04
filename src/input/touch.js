// Сенсорное управление: два виртуальных джойстика и кнопки.
//  левый джойстик — тяга вперёд/назад и вбок; правый — тангаж и рысканье;
//  перетаскивание по свободной области — обзор; кнопки — вверх/вниз, крен,
//  форсаж, камера, меню.

export function setupTouch(input, root, handlers) {
  const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (!isTouch) return null;
  input.touchActive = true;
  const ui = document.createElement('div');
  ui.className = 'touch-ui';
  ui.innerHTML = `
    <div class="stick left" data-stick="move"><div class="knob"></div><span>тяга</span></div>
    <div class="stick right" data-stick="rot"><div class="knob"></div><span>ориентация</span></div>
    <div class="tbtns right-col">
      <button data-hold="up">▲</button>
      <button data-hold="down">▼</button>
      <button data-hold="boost">⚡</button>
    </div>
    <div class="tbtns left-col">
      <button data-hold="rollL">⟲</button>
      <button data-hold="rollR">⟳</button>
      <button data-hold="align">◎</button>
    </div>
    <div class="tbtns top-row">
      <button data-act="toggleExternal">F</button>
      <button data-act="toggleFree">C</button>
      <button data-act="warpDown">«</button>
      <button data-act="warpUp">»</button>
      <button data-act="band">λ</button>
      <button data-act="menu">☰</button>
      <button data-act="pause">❚❚</button>
      <button data-act="hudFull">i</button>
    </div>`;
  root.appendChild(ui);
  const t = input.touch;
  const holds = { up: 0, down: 0, boost: 0, rollL: 0, rollR: 0, align: 0 };
  const applyHolds = () => {
    t.up = holds.up - holds.down;
    t.boost = !!holds.boost;
    t.roll = holds.rollL - holds.rollR;
    t.align = !!holds.align;
  };

  for (const stick of ui.querySelectorAll('.stick')) {
    const knob = stick.querySelector('.knob');
    let id = null;
    let cx = 0;
    let cy = 0;
    const R = 46;
    const set = (dx, dy) => {
      const m = Math.hypot(dx, dy);
      const k = m > R ? R / m : 1;
      dx *= k;
      dy *= k;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const v = [dx / R, -dy / R];
      if (stick.dataset.stick === 'move') t.move = v;
      else t.rot = v;
    };
    stick.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      const b = stick.getBoundingClientRect();
      cx = b.left + b.width / 2;
      cy = b.top + b.height / 2;
      stick.setPointerCapture(id);
      set(e.clientX - cx, e.clientY - cy);
      e.preventDefault();
    });
    stick.addEventListener('pointermove', (e) => {
      if (e.pointerId === id) set(e.clientX - cx, e.clientY - cy);
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      set(0, 0);
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
  }

  for (const b of ui.querySelectorAll('[data-hold]')) {
    const key = b.dataset.hold;
    b.addEventListener('pointerdown', (e) => {
      holds[key] = 1;
      applyHolds();
      b.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    const up = () => {
      holds[key] = 0;
      applyHolds();
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
  }
  for (const b of ui.querySelectorAll('[data-act]')) {
    b.addEventListener('click', (e) => {
      input.actions.push(b.dataset.act);
      e.preventDefault();
    });
  }

  // обзор перетаскиванием по канве
  const canvas = input.el;
  let lookId = null;
  let lx = 0;
  let ly = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    lookId = e.pointerId;
    lx = e.clientX;
    ly = e.clientY;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lookId) return;
    input.mouseDX += (e.clientX - lx) * 1.4;
    input.mouseDY += (e.clientY - ly) * 1.4;
    lx = e.clientX;
    ly = e.clientY;
  });
  const endLook = (e) => {
    if (e.pointerId === lookId) lookId = null;
  };
  canvas.addEventListener('pointerup', endLook);
  canvas.addEventListener('pointercancel', endLook);
  handlers?.onReady?.(ui);
  return ui;
}
