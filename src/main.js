// Точка входа: игровой цикл, связывающий физику, рендеринг, камеру,
// управление, корабль, интерфейс и звук.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { QUALITY, DEFAULTS, START_PRESETS, EXPOSURE_MODES } from './config.js';
import { RenderPipeline } from './render/pipeline.js';
import { Simulation, FreeCamera, WARP_LEVELS } from './sim/simulation.js';
import { diskProfile } from './physics/disk.js';
import { CameraRig } from './camera/cameraRig.js';
import { Input } from './input/input.js';
import { setupTouch } from './input/touch.js';
import { Cockpit } from './ship/cockpit.js';
import { ShipExterior } from './ship/exterior.js';
import { Monitors } from './ui/monitors.js';
import { Hud } from './ui/hud.js';
import { SciencePanel } from './ui/panel.js';
import { Screens, MODES } from './ui/screens.js';
import { PauseMenu } from './ui/menu.js';
import { CabinAudio } from './audio/audio.js';

const root = document.getElementById('app');
const canvas = document.getElementById('view');

// ---------------------------------------------------------------- настройки
const SETTINGS_KEY = 'bh-sim-settings-v2';
const settings = {
  band: DEFAULTS.band,
  exposureMode: DEFAULTS.exposureMode,
  fusion: DEFAULTS.fusion,
  ev: DEFAULTS.ev,
  manualLogE: 30,
  bloom: DEFAULTS.bloom,
  skyGrid: DEFAULTS.skyGrid,
  quality: DEFAULTS.quality,
  dynamicRes: true,
  fov: DEFAULTS.fov,
  sensitivity: DEFAULTS.sensitivity,
  smoothing: 0.06,
  invertY: DEFAULTS.invertY,
  hud: true,
  muted: false,
};
try {
  Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'));
} catch (e) {
  /* хранилище недоступно */
}
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    /* нет доступа к хранилищу */
  }
}

// параметры адресной строки (для отладки/тестов): ?q=low&autostart=1
const URLP = new URLSearchParams(location.search);
if (URLP.get('q') && QUALITY[URLP.get('q')]) settings.quality = URLP.get('q');

const state = {
  mode: 'exploration',
  presetKey: 'far',
  custom: { r: 40, thetaDeg: 80, vr: 0, vph: 0 },
  params: {
    massSolar: DEFAULTS.massSolar,
    metric: DEFAULTS.metric,
    spin: DEFAULTS.spin,
    disk: { ...DEFAULTS.disk },
    drive: DEFAULTS.drive,
    start: START_PRESETS.far,
  },
  cameraMode: 'cockpit',
  prevCameraMode: 'cockpit',
  freeFall: false,
  started: false,
  endShown: false,
};

// ---------------------------------------------------------------- рендерер
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
} catch (e) {
  fatal('Не удалось создать контекст WebGL 2. Обновите браузер или включите аппаратное ускорение.');
  throw e;
}
if (!renderer.capabilities.isWebGL2) fatal('Требуется WebGL 2.');
renderer.autoClear = false;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const gl = renderer.getContext();
if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) {
  console.warn('Нет EXT_color_buffer_float: HDR-рендеринг может быть недоступен');
}

let pipeline = new RenderPipeline(renderer, QUALITY[settings.quality]);
const sim = new Simulation(state.params);
const free = new FreeCamera();
const rig = new CameraRig(settings.fov);
rig.smoothing = settings.smoothing;
const monitors = new Monitors();
const cockpit = new Cockpit(monitors);
const exterior = new ShipExterior();

const scene = new THREE.Scene();
scene.add(cockpit.group);
scene.add(exterior.group);
const pmrem = new THREE.PMREMGenerator(renderer);
// окружение для отражений: в кабине — приглушённое «комнатное», снаружи — тёмный космос
const envCabin = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const envSpace = pmrem.fromScene(makeSpaceEnv(), 0.02).texture;
scene.environment = envCabin;
const extLight = new THREE.DirectionalLight(0xffffff, 0);
extLight.position.set(0, 0, -1);
extLight.castShadow = true;
extLight.shadow.mapSize.set(2048, 2048);
extLight.shadow.bias = -0.0004;
extLight.shadow.normalBias = 0.02;
scene.add(extLight);
scene.add(extLight.target);
const extAmbient = new THREE.HemisphereLight(0xffffff, 0x000000, 0);
scene.add(extAmbient);
// отражения окружения в металле — приглушённые (освещение кабины в основном внутреннее)
scene.traverse((o) => {
  if (o.material && 'envMapIntensity' in o.material) o.material.envMapIntensity = 0.35;
});

const hud = new Hud(root, (a) => handleAction(a));
const menu = new PauseMenu(root, (a) => handleMenu(a));
hud.setVisible(settings.hud);
const audio = new CabinAudio();
const input = new Input(canvas);
setupTouch(input, root);
const panel = new SciencePanel(
  root,
  () => ({ params: state.params, settings, presetKey: state.presetKey, custom: state.custom }),
  onPanelChange,
);
const screens = new Screens(root, {
  onStart: startExperiment,
  onRestart: () => {
    screens.hideEnd();
    restart();
  },
  onLab: () => {
    screens.hideEnd();
    panel.toggle(true);
  },
});

applyDisk();
resize();
window.addEventListener('resize', resize);

function makeSpaceEnv() {
  // тёмная сфера с полосой Галактики: даёт металлу корпуса правдоподобные отражения
  const env = new THREE.Scene();
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 512, 256);
  const grd = g.createLinearGradient(0, 70, 0, 190);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(0.5, 'rgba(70,60,48,1)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 70, 512, 120);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(255,${200 + Math.random() * 55},${170 + Math.random() * 85},${Math.random()})`;
    g.fillRect(Math.random() * 512, Math.random() * 256, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sph = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide }));
  sph.rotation.z = 0.5;
  env.add(sph);
  return env;
}

function fatal(msg) {
  const d = document.createElement('div');
  d.className = 'fatal';
  d.textContent = msg;
  document.body.appendChild(d);
}

function resize() {
  const q = QUALITY[settings.quality];
  const pr = Math.min(window.devicePixelRatio || 1, settings.quality === 'ultra' ? 2 : 1.5);
  renderer.setPixelRatio(pr);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  pipeline.resize(window.innerWidth * pr, window.innerHeight * pr);
  rig.setAspect(window.innerWidth / Math.max(1, window.innerHeight));
  void q;
}

function applyDisk() {
  // диск строится для работающей симуляции (масса и спин меняются только при перезапуске)
  const P = state.params;
  const a = sim.a;
  const prof = diskProfile({ massSolar: sim.params.massSolar, a, eddRatio: P.disk.eddRatio, rOut: P.disk.rOut });
  pipeline.setDisk(prof, P.disk);
  state.diskInfo = { enabled: P.disk.enabled, rIn: prof.rIn, rOut: prof.rOut, Tmax: prof.Tmax };
  sim.diskInfo = state.diskInfo;
}

function startExperiment(opt) {
  screens.start.classList.add('hidden');
  state.mode = opt.mode;
  state.presetKey = opt.preset;
  state.params.start = START_PRESETS[opt.preset];
  state.params.metric = opt.metric;
  settings.quality = opt.quality;
  if (opt.mode === 'cinematic') {
    settings.quality = matchMedia('(pointer: coarse)').matches ? 'medium' : 'ultra';
    settings.smoothing = 0.35;
    hud.setMinimal(true);
  } else {
    hud.setMinimal(false);
    settings.smoothing = Math.min(settings.smoothing, 0.2);
  }
  rig.smoothing = settings.smoothing;
  state.freeFall = opt.mode === 'freefall';
  setQuality(settings.quality);
  audio.start();
  audio.setMuted(settings.muted);
  restart();
  state.started = true;
  if (opt.mode === 'lab') panel.toggle(true);
  try {
    const pl = canvas.requestPointerLock?.();
    if (pl && pl.catch) pl.catch(() => {});
  } catch (e) {
    /* без захвата указателя: обзор перетаскиванием */
  }
}

function setQuality(key) {
  settings.quality = key;
  pipeline.setQuality(QUALITY[key]);
  resize();
  saveSettings();
}

function restart() {
  const P = state.params;
  if (state.presetKey === 'custom') {
    P.start = { label: 'Свои начальные условия', r: state.custom.r, thetaDeg: state.custom.thetaDeg, phiDeg: 0, kind: 'custom', vr: state.custom.vr, vph: state.custom.vph };
  }
  if (P.start.disk === false) P.disk.enabled = false;
  sim.reset(P);
  sim.setWarp(0);
  applyDisk();
  pipeline.resetExposure = true;
  state.endShown = false;
  state.lastStageShown = 0;
  screens.hideEnd();
  exterior.group.children.forEach((c) => {
    if (c.userData.base) c.position.copy(c.userData.base);
  });
  if (state.cameraMode === 'free') setCameraMode('cockpit');
  rig.resetLook();
  hud.log(`Эксперимент: ${MODES[state.mode].label}. ${P.start.label}`);
}

function onPanelChange(p, v) {
  const P = state.params;
  switch (p) {
    case 'metric':
      P.metric = v;
      break;
    case 'logMass':
      P.massSolar = Math.pow(10, v);
      break;
    case 'spin':
      P.spin = v;
      break;
    case 'diskOn':
      P.disk.enabled = v;
      applyDisk();
      break;
    case 'logEdd':
      P.disk.eddRatio = Math.pow(10, v);
      applyDisk();
      break;
    case 'rOut':
      P.disk.rOut = v;
      applyDisk();
      break;
    case 'hr':
      P.disk.hr = v;
      applyDisk();
      break;
    case 'logTau':
      P.disk.tau0 = Math.pow(10, v);
      applyDisk();
      break;
    case 'turb':
      P.disk.turbulence = v;
      applyDisk();
      break;
    case 'preset':
      state.presetKey = v;
      if (v !== 'custom') P.start = START_PRESETS[v];
      break;
    case 'cr':
      state.custom.r = v;
      break;
    case 'cth':
      state.custom.thetaDeg = v;
      break;
    case 'cvr':
      state.custom.vr = v;
      break;
    case 'cvp':
      state.custom.vph = v;
      break;
    case 'drive':
      P.drive = v;
      sim.params.drive = v;
      break;
    case 'band':
      settings.band = parseInt(v, 10);
      break;
    case 'exposureMode':
      settings.exposureMode = parseInt(v, 10);
      break;
    case 'fusion':
      settings.fusion = v;
      break;
    case 'ev':
      settings.ev = v;
      break;
    case 'manual':
      settings.manualLogE = v;
      break;
    case 'bloom':
      settings.bloom = v;
      break;
    case 'grid':
      settings.skyGrid = v;
      break;
    case 'quality':
      setQuality(v);
      break;
    case 'dynres':
      settings.dynamicRes = v;
      break;
    case 'fov':
      settings.fov = v;
      rig.setFov(v);
      break;
    case 'sens':
      settings.sensitivity = v;
      break;
    case 'smooth':
      settings.smoothing = v;
      rig.smoothing = v;
      break;
    case 'invertY':
      settings.invertY = v;
      break;
    case 'restart':
      restart();
      break;
  }
  saveSettings();
}

function setCameraMode(m) {
  if (m === 'free') {
    const D = sim.derived;
    free.init(D.pos, sim.a);
    rig.free.tyaw = rig.free.yaw = 0;
    rig.free.tpitch = rig.free.pitch = 0;
  }
  state.prevCameraMode = state.cameraMode;
  state.cameraMode = m;
  rig.mode = m;
  audio.setVacuum(m !== 'cockpit');
  hud.log(m === 'cockpit' ? 'Камера: кабина' : m === 'external' ? 'Камера: внешняя (в вакууме звука нет)' : 'Свободная камера-зонд: наблюдатель ZAMO, WASD — перемещение (не динамика)');
}

// ---------------------------------------------------------------- события
const RADIO = {
  1: 'Горизонт, это ЦУП. Телеметрия в норме. Начинайте сближение.',
  2: 'Горизонт, ЦУП. Видим, как изображения звёзд вокруг объекта расходятся в дуги. Продолжайте наблюдения.',
  3: 'Горизонт, ваши часы заметно отстают от наших. Сигнал смещён по частоте.',
  4: 'Горизонт, вы в зоне сильного поля. Зависнуть на ваших двигателях невозможно.',
};

function handleEvents() {
  for (const ev of sim.takeEvents()) {
    switch (ev.type) {
      case 'stage':
        if (ev.stage !== state.lastStageShown) {
          state.lastStageShown = ev.stage;
          hud.showStage(ev.stage, sim.a > 0 && ev.stage === 6 ? `Для a = ${sim.a.toFixed(2)} падение продолжится до внутреннего горизонта r₋ = ${sim.hz.rMinus.toFixed(3)} M.` : '');
          audio.beep(880, 0.08);
          if (RADIO[ev.stage]) audio.radio(RADIO[ev.stage], sim.derived?.rxRatio ?? 1);
        }
        break;
      case 'horizon':
        hud.showMessage(
          'Этап 5 · Горизонт событий пройден',
          `${ev.text} Для удалённого наблюдателя корабль никогда не пересечёт горизонт: его изображение застывает и гаснет, краснея. Приливная нагрузка сейчас — ${formatG(sim.structure.tidalAcrossShipG)} по длине корабля.`,
          18,
        );
        hud.log('Горизонт пройден. Передача на ЦУП более невозможна.', 'bad');
        audio.alarm(2);
        break;
      case 'system':
      case 'yield':
      case 'crew':
        hud.log(ev.text, 'warn');
        audio.alarm(1);
        break;
      case 'destroyed':
        hud.log(ev.text, 'bad');
        audio.alarm(2);
        audio.creak(1);
        state.flash = 1;
        break;
      case 'destroyed-info':
        hud.showMessage('Разрушение корабля', ev.text + ' Разрушение определено вычисленными приливными напряжениями, а не заданным расстоянием.', 16);
        break;
      case 'end':
        hud.log('Граница применимости модели', 'bad');
        break;
      default:
        hud.log(ev.text);
    }
  }
}

function formatG(g) {
  if (g < 1e-3) return `${(g * 1e6).toFixed(2)} мкg`;
  if (g < 1) return `${(g * 1e3).toFixed(2)} мg`;
  return `${g.toFixed(1)} g`;
}

// ---------------------------------------------------------------- цикл
let last = performance.now();
let fps = 60;
const prevQuat = new THREE.Quaternion();
let prevPos = [0, 0, 0, 0];
let prevDiskTime = 0;
const shipAngVel = [0, 0, 0];
const tmpV = new THREE.Vector3();
const camRot = new THREE.Matrix3();
let lastMode = state.cameraMode;

function frame(now) {
  requestAnimationFrame(frame);
  const dtMs = Math.min(100, now - last);
  last = now;
  const dt = dtMs / 1000;
  fps = fps * 0.95 + (1000 / Math.max(dtMs, 1)) * 0.05;
  const t = now / 1000;

  const ctl = input.poll();
  for (const a of ctl.actions) handleAction(a);

  // ориентация корабля: команды РСУ с ограниченным угловым ускорением
  const maxRate = ctl.boost ? 0.9 : 0.45;
  const target = [ctl.rot[0] * maxRate, ctl.rot[1] * maxRate, ctl.rot[2] * maxRate * 1.4];
  if (ctl.align && state.cameraMode === 'cockpit') {
    target[0] = Math.max(-maxRate, Math.min(maxRate, 1.8 * rig.head.pitch));
    target[1] = Math.max(-maxRate, Math.min(maxRate, 1.8 * rig.head.yaw));
  }
  let rcs = 0;
  for (let i = 0; i < 3; i++) {
    const d = target[i] - shipAngVel[i];
    const step = Math.sign(d) * Math.min(Math.abs(d), 1.2 * dt);
    shipAngVel[i] += step;
    rcs += Math.abs(step) / (1.2 * dt + 1e-9);
  }
  const freeFall = state.freeFall || state.cameraMode === 'free';
  const thrustCtl = state.cameraMode === 'free' ? [0, 0, 0] : ctl.thrust;
  const rotCtl = state.cameraMode === 'free' ? [0, 0, 0] : shipAngVel;
  if (state.started) sim.update(dt, { thrust: thrustCtl, boost: ctl.boost, rot: rotCtl, freeFall });
  if (ctl.align && state.cameraMode === 'cockpit') rig.compensateShipRotation(shipAngVel[0] * dt, shipAngVel[1] * dt);
  handleEvents();
  if (sim.ended && !state.endShown) {
    state.endShown = true;
    setTimeout(() => screens.showEnd(sim, sim.endReason), 1500);
  }

  // камера
  const st = sim.structure;
  rig.update(dt, ctl, { sensitivity: settings.sensitivity, invertY: settings.invertY, vibration: st.vibration });
  if (state.cameraMode === 'free') {
    const v = new THREE.Vector3(ctl.thrust[0], ctl.thrust[1], ctl.thrust[2]).applyQuaternion(rig.camera.quaternion);
    free.move([v.x, v.y, v.z], dt * (ctl.boost ? 4 : 1));
  }
  const camData = state.cameraMode === 'free' ? free.cameraData() : sim.cameraData();
  const D = sim.derived;

  // признак движения (для накопления кадров)
  const q = rig.camera.quaternion;
  const dq = Math.abs(q.dot(prevQuat));
  const p = camData.pos;
  const dp = Math.hypot(p[1] - prevPos[1], p[2] - prevPos[2], p[3] - prevPos[3]) / Math.max(1, Math.hypot(p[1], p[2], p[3]));
  const diskTime = sim.y[0] % 2e4;
  const moved = dq < 0.9999995 || dp > 1e-6 || Math.abs(diskTime - prevDiskTime) > 0.02 || lastMode !== state.cameraMode;
  prevQuat.copy(q);
  prevPos = p.slice();
  prevDiskTime = diskTime;
  lastMode = state.cameraMode;

  // видимость моделей
  cockpit.group.visible = state.cameraMode === 'cockpit';
  exterior.group.visible = state.cameraMode === 'external';

  // освещение кабины/корабля светом снаружи (по снимку изображения)
  updateExternalLight();

  pipeline.adaptResolution(dtMs, settings.dynamicRes);
  state.flash = Math.max(0, (state.flash || 0) - dt * 0.8);
  const endFade = sim.ended ? Math.min(0.85, (state.endFadeT = (state.endFadeT || 0) + dt * 0.25)) : (state.endFadeT = 0);
  pipeline.render(
    {
      camera: rig.camera,
      camPos: [p[1], p[2], p[3]],
      U: camData.U,
      E1: camData.E1,
      E2: camData.E2,
      E3: camData.E3,
      spin: sim.a,
      rPlus: sim.hz.rPlus,
      diskTime,
      band: settings.band,
      exposureMode: settings.exposureMode,
      fusion: settings.fusion,
      ev: settings.ev,
      manualLogE: settings.manualLogE,
      bloom: settings.bloom,
      skyGrid: settings.skyGrid,
      moved,
      dt,
      blackout: endFade,
      flash: state.flash * 0.8,
      flashColor: new THREE.Color(1, 0.9, 0.8),
    },
    state.cameraMode === 'free' ? null : (target) => {
      renderer.setRenderTarget(target);
      renderer.clearDepth();
      renderer.render(scene, rig.camera);
    },
  );

  // приборы, кабина, звук
  const failures = {};
  if (!st.systemOk('nav')) failures.nav = 1;
  if (!st.systemOk('sensors')) failures.struct = 0.6;
  if (!st.systemOk('antenna')) failures.time = 0.3;
  if (st.destroyed) {
    failures.nav = failures.time = failures.struct = failures.aux = failures.disk = 1;
  }
  const alert = st.destroyed ? 1 : st.stressFrac > 0.3 || (!D.outside && !sim.ended) ? 1 : D.r < sim.rPhPro * 1.2 ? 0.4 : 0;
  if (state.cameraMode === 'cockpit') {
    monitors.update(dt, { sim, derived: D, disk: state.diskInfo, band: settings.band, exposureMode: settings.exposureMode, failures });
    cockpit.update(dt, t, {
      thrust: thrustCtl,
      rot: shipAngVel,
      alert,
      damage: Math.min(1, st.plasticStrain * 25 + (st.destroyed ? 1 : 0)),
      extColor: state.extColor,
      extDir: state.extDir,
      failures: st.systems.filter((s) => !s.ok).length,
    });
  }
  exterior.update(dt, t, {
    rcs: rcs / 3,
    thrust: sim.thrustG > 0 ? Math.min(1.5, 0.4 + Math.log10(1 + sim.thrustG) / 3) : 0,
    deform: st.plasticStrain,
    failures: { antenna: !st.systemOk('antenna'), radiators: !st.systemOk('radiators') },
    breakup: st.destroyed ? Math.min(8, (sim.tau - sim.destroyedTau) * sim.S.T * 40 + 0.5) : 0,
  });
  audio.update(dt, {
    thrustFrac: sim.thrustG > 0 ? Math.min(1, 0.35 + sim.thrustG / sim.drive().boost) : 0,
    rcs: rcs / 3,
    vibration: st.vibration,
    stressFrac: st.stressFrac,
  });
  if (alert >= 1 && state.cameraMode === 'cockpit' && !sim.ended) audio.alarm(st.stressFrac > 0.6 ? 2 : 1);

  hud.update(dt, {
    sim,
    derived: D,
    fps,
    resScale: pipeline.resScale,
    settings: { ...settings, qualityLabel: QUALITY[settings.quality].label },
    modeLabel: `${MODES[state.mode].label.toUpperCase()}${state.freeFall && state.mode !== 'freefall' ? ' · ДВИГ. ВЫКЛ' : ''}`,
    camLabel: state.cameraMode === 'free' ? 'КАМЕРА-ЗОНД' : state.cameraMode === 'external' ? 'ВНЕШНЯЯ КАМЕРА' : 'КАБИНА',
    camera: rig.camera,
    cameraMode: state.cameraMode,
  });
}

function updateExternalLight() {
  // 1) снимок изображения 4×4: цвет и рассеянная подсветка от того, что в кадре
  const cam = rig.camera;
  camRot.setFromMatrix4(cam.matrixWorld);
  const probeDir = new THREE.Vector3(0, 0, -1);
  const col = new THREE.Color(1, 1, 1);
  let mean = 0;
  if (pipeline.probeReady) {
    const px = pipeline.probe;
    let total = 0;
    col.setRGB(0, 0, 0);
    probeDir.set(0, 0, 0);
    for (let j = 0; j < 4; j++)
      for (let i = 0; i < 4; i++) {
        const o = (j * 4 + i) * 4;
        const r = px[o] / 255;
        const g = px[o + 1] / 255;
        const b = px[o + 2] / 255;
        const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        tmpV.set(((i + 0.5) / 4) * 2 - 1, ((j + 0.5) / 4) * 2 - 1, 1).applyMatrix4(cam.projectionMatrixInverse).normalize().applyMatrix3(camRot);
        probeDir.addScaledVector(tmpV, L);
        col.r += r;
        col.g += g;
        col.b += b;
        total += L;
      }
    mean = total / 16;
    if (total > 1e-4) probeDir.normalize();
    else probeDir.set(0, 0, -1);
    const m = Math.max(col.r, col.g, col.b, 1e-4);
    col.multiplyScalar(1 / m);
  }
  // 2) основной свет — от диска, из видимого направления на ЧД.
  //    Освещённость ∝ телесному углу диска ~ (r_диска/r)²; при экспозиции по
  //    ярким областям сам диск ≈ белый, поэтому корпус с альбедо ~0.8 выглядит
  //    ярким только вблизи диска.
  const D = sim.derived;
  const disk = state.diskInfo;
  const dir = D.centerDir ? tmpV.set(D.centerDir[0], D.centerDir[1], D.centerDir[2]).clone() : probeDir.clone();
  const omega = disk && disk.enabled ? Math.min(1.3, Math.pow(disk.rOut / Math.max(D.r, 1), 2)) : 0;
  const k = 0.12;
  state.extColor = (state.extColor || new THREE.Color()).lerp(col.clone().multiplyScalar(0.25 + mean * 4 + omega), k);
  state.extDir = (state.extDir || new THREE.Vector3(0, 0, -1)).lerp(dir, k).normalize();
  extLight.color.copy(col).lerp(new THREE.Color(1, 0.97, 0.92), 0.5);
  const target = Math.PI * (0.06 + 1.4 * omega) + mean * 3;
  extLight.intensity += (target - extLight.intensity) * k;
  const ext = state.cameraMode === 'external';
  const S = ext ? 48 : 1.9;
  const sc = extLight.shadow.camera;
  if (sc.right !== S) {
    sc.left = -S;
    sc.right = S;
    sc.top = S;
    sc.bottom = -S;
    sc.near = ext ? 1 : 0.05;
    sc.far = ext ? 220 : 14;
    sc.updateProjectionMatrix();
  }
  extLight.position.copy(state.extDir).multiplyScalar(ext ? 100 : 6);
  extLight.target.position.set(0, 0, ext ? 4 : -0.3);
  extAmbient.color.copy(col);
  extAmbient.intensity += (0.05 + mean * 1.2 - extAmbient.intensity) * k;
  scene.environment = ext ? envSpace : envCabin;
}

function handleAction(a) {
  switch (a) {
    case 'toggleExternal':
      setCameraMode(state.cameraMode === 'external' ? 'cockpit' : 'external');
      break;
    case 'toggleFree':
      setCameraMode(state.cameraMode === 'free' ? (state.prevCameraMode === 'free' ? 'cockpit' : state.prevCameraMode) : 'free');
      break;
    case 'toggleHud':
      settings.hud = !settings.hud;
      hud.setVisible(settings.hud);
      saveSettings();
      break;
    case 'pause':
      sim.paused = !sim.paused;
      hud.log(sim.paused ? 'Пауза (изображение уточняется накоплением кадров)' : 'Продолжение');
      break;
    case 'restart':
      restart();
      break;
    case 'warpUp':
      sim.setWarp((sim.warpIndex ?? 0) + 1);
      audio.beep(1400, 0.04, 0.06);
      break;
    case 'warpDown':
      sim.setWarp((sim.warpIndex ?? 0) - 1);
      audio.beep(900, 0.04, 0.06);
      break;
    case 'band':
      settings.band = (settings.band + 1) % 3;
      hud.log(['Диапазон: видимый свет', 'Диапазон: условный ИК 1–5 мкм', 'Научный режим: цвет — отношение частот g (синий — синее смещение)'][settings.band]);
      saveSettings();
      break;
    case 'exposure':
      settings.exposureMode = (settings.exposureMode + 1) % EXPOSURE_MODES.length;
      hud.log(`Экспозиция — ${EXPOSURE_MODES[settings.exposureMode].label}`);
      saveSettings();
      break;
    case 'grid':
      settings.skyGrid = !settings.skyGrid;
      saveSettings();
      break;
    case 'panel':
      panel.toggle();
      if (panel.open) document.exitPointerLock?.();
      break;
    case 'freeFall':
      if (state.mode === 'freefall') break;
      state.freeFall = !state.freeFall;
      hud.log(state.freeFall ? 'Двигатели выключены: свободное падение по геодезической' : 'Двигатели включены');
      break;
    case 'mute':
      settings.muted = !settings.muted;
      audio.setMuted(settings.muted);
      saveSettings();
      break;
    case 'help':
      screens.toggleHelp();
      break;
    case 'quality': {
      const keys = Object.keys(QUALITY);
      setQuality(keys[(keys.indexOf(settings.quality) + 1) % keys.length]);
      hud.log(`Качество: ${QUALITY[settings.quality].label}`);
      break;
    }
    case 'resetLook':
      rig.resetLook();
      break;
    case 'hudFull':
      hud.el.classList.toggle('full');
      break;
    case 'menu':
      if (menu.open) closeMenu();
      else openMenu();
      break;
    case 'escape':
      if (panel.open) panel.toggle(false);
      else if (!screens.help.classList.contains('hidden')) screens.toggleHelp(false);
      else if (menu.open) {
        // Esc, снявший захват указателя, мог уже открыть меню — не закрываем его сразу
        if (performance.now() - (state.menuOpenedAt || 0) > 400) closeMenu();
      } else if (state.started) openMenu();
      break;
  }
}

// ---------------------------------------------------------------- меню паузы
let ownUnlock = false;
function openMenu() {
  if (menu.open || !state.started) return;
  state.menuOpenedAt = performance.now();
  state.pausedBeforeMenu = sim.paused;
  sim.paused = true;
  if (document.pointerLockElement) {
    ownUnlock = true;
    document.exitPointerLock?.();
  }
  const D = sim.derived;
  menu.show(
    `${MODES[state.mode].label} · ${state.params.start.label}. Сейчас: r = ${D.r.toPrecision(4)} M, τ = ${(sim.tau * sim.S.T).toFixed(1)} с по часам корабля${sim.ended ? ' · эксперимент завершён' : ''}.`,
    settings.muted,
  );
}
function closeMenu(relock = true) {
  if (!menu.open) return;
  menu.hide();
  sim.paused = !!state.pausedBeforeMenu;
  if (relock && !input.touchActive) {
    try {
      const pl = canvas.requestPointerLock?.();
      if (pl && pl.catch) pl.catch(() => {});
    } catch (e) {
      /* обзор перетаскиванием */
    }
  }
}
function handleMenu(a) {
  switch (a) {
    case 'resume':
      closeMenu();
      break;
    case 'restart':
      closeMenu(true);
      restart();
      break;
    case 'lab':
    case 'settings':
      closeMenu(false);
      panel.toggle(true);
      if (a === 'settings') panel.el.querySelector('[data-section=image]')?.scrollIntoView({ block: 'start' });
      break;
    case 'help':
      closeMenu(false);
      screens.toggleHelp(true);
      break;
    case 'mute':
      handleAction('mute');
      break;
    case 'mainMenu':
      closeMenu(false);
      state.started = false;
      screens.start.classList.remove('hidden');
      break;
  }
}
// потеря захвата указателя во время полёта (например, Esc) → меню
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) return;
  if (ownUnlock) {
    ownUnlock = false;
    return;
  }
  if (state.started && !menu.open && !panel.open && screens.help.classList.contains('hidden')) openMenu();
});

sim.setWarp(0);
requestAnimationFrame(frame);
if (URLP.get('autostart')) {
  startExperiment({ mode: URLP.get('mode') || 'exploration', preset: URLP.get('preset') || 'far', quality: settings.quality, metric: URLP.get('metric') || 'kerr' });
}
window.__sim = sim; // для отладки из консоли
window.__app = { state, settings, pipeline, startExperiment, setCameraMode, WARP_LEVELS, rig };
