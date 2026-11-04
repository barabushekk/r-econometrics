// Статический вид для отладки и сквозных GPU-тестов.
// Параметры адресной строки: r, th (°), a, obs=zamo|rain|static, fov, yaw (°),
// band, exp, disk=0|1, edd, q (качество), w/h (разрешение), flat=1 (маска тени), grid=1.
import * as THREE from 'three';
import { RenderPipeline } from '../src/render/pipeline.js';
import { QUALITY, DEFAULTS } from '../src/config.js';
import { horizons, ksFromSpheroidal, zamoObserver, rainObserver, staticObserver } from '../src/physics/kerr.js';
import { facingTetrad, tetradCovectors } from '../src/sim/frames.js';
import { diskProfile } from '../src/physics/disk.js';

const P = new URLSearchParams(location.search);
const num = (k, d) => (P.has(k) ? parseFloat(P.get(k)) : d);
const a = num('a', 0.6);
const r = num('r', 30);
const th = (num('th', 82) * Math.PI) / 180;
const W = num('w', 480);
const H = num('h', 270);
const q = { ...QUALITY[P.get('q') || 'low'] };
if (P.has('sky')) q.skySize = num('sky', q.skySize);
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
renderer.autoClear = false;
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
const pipe = new RenderPipeline(renderer, { ...q, resStart: 1, resMin: 1, resMax: 1, accumulate: false, bloom: P.get('flat') !== '1' });
pipe.resize(W, H);
const prof = diskProfile({ massSolar: 4e6, a, eddRatio: num('edd', DEFAULTS.disk.eddRatio), rOut: DEFAULTS.disk.rOut });
pipe.setDisk(prof, { ...DEFAULTS.disk, enabled: P.get('disk') !== '0' && P.get('flat') !== '1' });
pipe.rtUniforms.uDebugFlatSky.value = P.get('flat') === '1' ? 1 : 0;
const pos = [0, ...ksFromSpheroidal(r, th, 0, a)];
const obs = P.get('obs') || 'zamo';
const u = obs === 'rain' ? rainObserver(pos, a) : obs === 'static' ? staticObserver(pos, a) : zamoObserver(pos, a);
const T = facingTetrad(pos, a, u);
const cov = tetradCovectors(pos, a, T.u, T.e);
const camera = new THREE.PerspectiveCamera(num('fov', 60), W / H, 0.1, 100);
camera.rotation.set(0, (num('yaw', 0) * Math.PI) / 180, 0);
window.__frames = 0;
function frame() {
  pipe.render(
    {
      camera,
      camPos: pos.slice(1),
      ...cov,
      spin: a,
      rPlus: horizons(a).rPlus,
      diskTime: 0,
      band: num('band', 0),
      exposureMode: P.get('flat') === '1' ? 3 : num('exp', 0),
      manualLogE: P.get('flat') === '1' ? 0 : 30,
      ev: 0,
      bloom: 0.035,
      moved: false,
      dt: 0.1,
      skyGrid: P.get('grid') === '1',
    },
    null,
  );
  window.__frames++;
  requestAnimationFrame(frame);
}
frame();

/** Центральная строка итогового кадра (RGBA8) — для измерения тени. */
window.__centerRow = () => {
  const gl = renderer.getContext();
  const buf = new Uint8Array(W * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(0, Math.floor(H / 2), W, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  return Array.from(buf.filter((_, i) => i % 4 === 0));
};
