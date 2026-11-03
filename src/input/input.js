// Ввод: клавиатура, мышь (pointer lock), колесо, сенсорные джойстики.
// Сводится к единому состоянию управления на кадр.

const ACTIONS = {
  KeyF: 'toggleExternal',
  KeyC: 'toggleFree',
  KeyH: 'toggleHud',
  KeyP: 'pause',
  KeyR: 'restart',
  Period: 'warpUp',
  BracketRight: 'warpUp',
  Comma: 'warpDown',
  BracketLeft: 'warpDown',
  KeyB: 'band',
  KeyX: 'exposure',
  Tab: 'panel',
  KeyG: 'grid',
  KeyT: 'freeFall',
  KeyM: 'mute',
  F1: 'help',
  Slash: 'help',
  Escape: 'escape',
  Backquote: 'quality',
  KeyZ: 'resetLook',
};

export class Input {
  constructor(element) {
    this.el = element;
    this.keys = new Set();
    this.actions = [];
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.rmb = false;
    this.locked = false;
    this.enabled = true;
    this.touch = { move: [0, 0], look: [0, 0], rot: [0, 0], up: 0, boost: false, roll: 0, align: false };
    this.touchActive = false;

    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1', 'ControlLeft', 'ControlRight'].includes(e.code)) e.preventDefault();
      if (e.ctrlKey && e.code === 'KeyW') e.preventDefault();
      if (!e.repeat && ACTIONS[e.code]) this.actions.push(ACTIONS[e.code]);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    element.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button === 2) this.rmb = true;
      if (!this.locked && e.button === 0 && !this.touchActive) element.requestPointerLock?.();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.rmb = false;
    });
    element.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === element;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    element.addEventListener(
      'wheel',
      (e) => {
        this.wheel += Math.sign(e.deltaY);
        e.preventDefault();
      },
      { passive: false },
    );
  }

  key(code) {
    return this.keys.has(code);
  }

  /** Снимок управления. */
  poll() {
    const k = (c) => (this.keys.has(c) ? 1 : 0);
    const t = this.touch;
    const thrust = [
      k('KeyD') - k('KeyA') + t.move[0],
      k('Space') - (k('ControlLeft') || k('ControlRight') ? 1 : 0) + t.up,
      k('KeyS') - k('KeyW') - t.move[1],
    ];
    const rot = [
      k('ArrowUp') - k('ArrowDown') + t.rot[1], // тангаж
      k('ArrowLeft') - k('ArrowRight') - t.rot[0], // рысканье
      k('KeyQ') - k('KeyE') + t.roll, // крен
    ];
    const out = {
      thrust: thrust.map((v) => Math.max(-1, Math.min(1, v))),
      rot,
      boost: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || t.boost,
      align: this.rmb || this.keys.has('KeyV') || t.align,
      lookDX: this.mouseDX + t.look[0] * 9,
      lookDY: this.mouseDY + t.look[1] * 9,
      wheel: this.wheel,
      actions: this.actions,
    };
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.actions = [];
    return out;
  }
}
