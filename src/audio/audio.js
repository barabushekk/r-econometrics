// Звуки — только внутри корабля (WebAudio, процедурный синтез):
// двигатели, РСУ, гул систем, вибрации и скрипы конструкции,
// предупреждения, сигналы приборов, радиосвязь с ЦУПом.
// Сама чёрная дыра звука не издаёт: в вакууме звук не распространяется.
// Во внешней и свободной камерах (наблюдатель в вакууме) звука нет.

export class CabinAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.speechOk = 'speechSynthesis' in window;
    this.lastCreak = 0;
    this.lastAlarm = 0;
  }

  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(ctx.destination);
    this.cabin = ctx.createGain(); // всё «внутри корабля»
    this.cabin.gain.value = 1;
    this.cabin.connect(this.master);

    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02; // коричневый шум
      d[i] = last * 3.5;
    }
    this.noiseBuf = noiseBuf;
    const white = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const wd = white.getChannelData(0);
    for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;
    this.whiteBuf = white;

    const loop = (buf) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.start();
      return s;
    };

    // гул систем жизнеобеспечения и электроники
    const hum = ctx.createOscillator();
    hum.type = 'sine';
    hum.frequency.value = 58;
    const humG = ctx.createGain();
    humG.gain.value = 0.025;
    hum.connect(humG).connect(this.cabin);
    hum.start();
    const fan = loop(noiseBuf);
    const fanF = ctx.createBiquadFilter();
    fanF.type = 'bandpass';
    fanF.frequency.value = 420;
    fanF.Q.value = 0.7;
    const fanG = ctx.createGain();
    fanG.gain.value = 0.035;
    fan.connect(fanF).connect(fanG).connect(this.cabin);

    // двигатель: низкочастотный рокот + шум, громкость по тяге
    const eng = loop(noiseBuf);
    this.engF = ctx.createBiquadFilter();
    this.engF.type = 'lowpass';
    this.engF.frequency.value = 120;
    this.engG = ctx.createGain();
    this.engG.gain.value = 0;
    eng.connect(this.engF).connect(this.engG).connect(this.cabin);
    const engO = ctx.createOscillator();
    engO.type = 'sawtooth';
    engO.frequency.value = 36;
    this.engO = engO;
    const engOF = ctx.createBiquadFilter();
    engOF.type = 'lowpass';
    engOF.frequency.value = 90;
    this.engOG = ctx.createGain();
    this.engOG.gain.value = 0;
    engO.connect(engOF).connect(this.engOG).connect(this.cabin);
    engO.start();

    // РСУ (двигатели ориентации): шипение
    const rcs = loop(white);
    const rcsF = ctx.createBiquadFilter();
    rcsF.type = 'highpass';
    rcsF.frequency.value = 2500;
    this.rcsG = ctx.createGain();
    this.rcsG.gain.value = 0;
    rcs.connect(rcsF).connect(this.rcsG).connect(this.cabin);

    // вибрация конструкции
    const vib = loop(noiseBuf);
    const vibF = ctx.createBiquadFilter();
    vibF.type = 'lowpass';
    vibF.frequency.value = 60;
    this.vibG = ctx.createGain();
    this.vibG.gain.value = 0;
    vib.connect(vibF).connect(this.vibG).connect(this.cabin);
  }

  setVacuum(isVacuum) {
    if (!this.ctx) return;
    this.cabin.gain.setTargetAtTime(isVacuum ? 0 : 1, this.ctx.currentTime, 0.15);
  }

  setMuted(m) {
    this.enabled = !m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.05);
    if (m && this.speechOk) speechSynthesis.cancel();
  }

  update(dt, { thrustFrac = 0, rcs = 0, vibration = 0, stressFrac = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engG.gain.setTargetAtTime(0.5 * thrustFrac, t, 0.12);
    this.engOG.gain.setTargetAtTime(0.18 * thrustFrac, t, 0.12);
    this.engF.frequency.setTargetAtTime(90 + 260 * thrustFrac, t, 0.2);
    this.engO.frequency.setTargetAtTime(32 + 14 * thrustFrac, t, 0.3);
    this.rcsG.gain.setTargetAtTime(0.06 * Math.min(1, rcs), t, 0.03);
    this.vibG.gain.setTargetAtTime(0.9 * vibration, t, 0.2);
    // скрипы корпуса при высоких напряжениях
    if (stressFrac > 0.25 && t - this.lastCreak > 0.6 + Math.random() * 3 / (stressFrac + 0.1)) {
      this.lastCreak = t;
      this.creak(stressFrac);
    }
  }

  creak(level) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f0 = 70 + Math.random() * 160;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * (0.5 + Math.random()), t + 0.8);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 300 + Math.random() * 500;
    f.Q.value = 8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.25 * Math.min(1, level), t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
    o.connect(f).connect(g).connect(this.cabin);
    o.start(t);
    o.stop(t + 1.1);
  }

  beep(freq = 1200, dur = 0.07, vol = 0.12, type = 'sine') {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.cabin);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  alarm(level = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (t - this.lastAlarm < (level > 1 ? 0.7 : 1.6)) return;
    this.lastAlarm = t;
    this.beep(level > 1 ? 880 : 660, 0.16, 0.12, 'square');
    setTimeout(() => this.beep(level > 1 ? 660 : 520, 0.16, 0.12, 'square'), 200);
  }

  static() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.whiteBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    f.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    s.connect(f).connect(g).connect(this.cabin);
    s.start(t);
    s.stop(t + 0.55);
  }

  /**
   * Радиосообщение ЦУПа. rate — отношение частот принимаемого сигнала
   * (синее смещение ускоряет запись, красное — замедляет): так изменился
   * бы темп записанного на Земле сообщения при приёме на корабле.
   */
  radio(text, rate = 1) {
    if (!this.enabled) return;
    this.static();
    if (!this.speechOk) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ru-RU';
      u.rate = Math.max(0.5, Math.min(3, rate));
      u.pitch = Math.max(0.3, Math.min(2, rate));
      u.volume = 0.8;
      speechSynthesis.speak(u);
    } catch (e) {
      // синтез речи недоступен
    }
  }
}
