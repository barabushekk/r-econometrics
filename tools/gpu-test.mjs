// Сквозной тест GPU-трассировщика: размер тени на отрендеренном кадре
// сравнивается с (1) точной формулой Шварцшильда, (2) бисекцией CPU-копией
// алгоритма (src/physics/photon.js) для Керра — так проверяется, что шейдер
// GLSL эквивалентен протестированному JS-интегратору.
// Запуск: npm run test:gpu (нужен Chromium; используется программный рендер).
import { createServer } from 'vite';
import { createRequire } from 'module';
import { tracePhoton, cameraRayCovector } from '../src/physics/photon.js';
import { ksFromSpheroidal, zamoObserver } from '../src/physics/kerr.js';
import { facingTetrad } from '../src/sim/frames.js';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node-tools/node_modules/playwright'));
}

const W = 640;
const H = 360;
const FOV = 50;
const cases = [
  { a: 0, r: 30, th: 90 },
  { a: 0, r: 12, th: 90 },
  { a: 0.9, r: 30, th: 90 },
  { a: 0.6, r: 20, th: 60 },
];

// угол от центра кадра (по горизонтали) до края тени по CPU-бисекции
function cpuEdge(c, side) {
  const a = c.a;
  const pos = [0, ...ksFromSpheroidal(c.r, (c.th * Math.PI) / 180, 0, a)];
  const T = facingTetrad(pos, a, zamoObserver(pos, a));
  const escaped = (ang) => {
    const d = [side * Math.sin(ang), 0, -Math.cos(ang)];
    const p = cameraRayCovector(pos, a, T.u, T.e, d);
    return tracePhoton([pos[1], pos[2], pos[3]], p, a, { stepScale: 0.01, maxSteps: 60000, escapeR: 200 }).status === 'escaped';
  };
  let lo = 0;
  let hi = 1.2;
  for (let i = 0; i < 30; i++) {
    const m = 0.5 * (lo + hi);
    if (escaped(m)) hi = m;
    else lo = m;
  }
  return 0.5 * (lo + hi);
}

function gpuEdges(row) {
  const cx = (W - 1) / 2;
  const tanH = Math.tan(((FOV / 2) * Math.PI) / 180) * (W / H);
  const ang = (x) => Math.atan(((x + 0.5 - W / 2) / (W / 2)) * tanH);
  let L = Math.floor(cx);
  while (L > 0 && row[L] < 128) L--;
  let R = Math.ceil(cx);
  while (R < W - 1 && row[R] < 128) R++;
  // край — между пикселями L и L+1 (R−1 и R)
  return { left: -ang(L + 0.5), right: ang(R - 0.5), pix: Math.abs(ang(W / 2 + 1) - ang(W / 2)) };
}

const server = await createServer({ server: { port: 5291, open: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = 0;
for (const c of cases) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.goto(`http://localhost:5291/tools/view.html?flat=1&q=ultra&sky=32&w=${W}&h=${H}&fov=${FOV}&a=${c.a}&r=${c.r}&th=${c.th}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => (window.__frames || 0) >= 3, null, { timeout: 240000 });
  const row = await page.evaluate(() => window.__centerRow());
  await page.close();
  const g = gpuEdges(row);
  // в кадре ось X камеры = e1 (направление вращения): правый край — side = +1
  const refR = cpuEdge(c, +1);
  const refL = cpuEdge(c, -1);
  let exact = '';
  if (c.a === 0) exact = Math.asin((3 * Math.sqrt(3) * Math.sqrt(1 - 2 / c.r)) / c.r);
  const tol = 1.5 * g.pix + 1e-3;
  const ok = Math.abs(g.left - refL) < tol && Math.abs(g.right - refR) < tol && (exact === '' || Math.abs(refR - exact) < 2e-3 * exact);
  if (!ok) failed++;
  const deg = (x) => ((x * 180) / Math.PI).toFixed(3) + '°';
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} a=${c.a} r=${c.r} θ=${c.th}: GPU [${deg(g.left)}, ${deg(g.right)}]  CPU [${deg(refL)}, ${deg(refR)}]` +
      (exact !== '' ? `  точно ${deg(exact)}` : '') +
      `  (пиксель ${deg(g.pix)})`,
  );
}
await browser.close();
await server.close();
process.exit(failed ? 1 : 0);
