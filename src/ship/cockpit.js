// Процедурная кабина исследовательского корабля (оси корабля: X — вправо,
// Y — вверх, −Z — нос; глаз пилота в начале координат; единицы — метры).
//
// Интерьер — по образцу реальных пилотируемых кораблей: светлые мягкие
// стеновые панели (бета-ткань) с липучками и маркировкой, приборные панели
// из анодированного алюминия с тумблерами под защитными скобами, подсвеченные
// надписи, поручни, кабельные жгуты, рифлёный пол, кресло с ремнями.
// Свет диска проходит через фонарь и отбрасывает тени от рамы.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function canvasTex(w, h, draw, { srgb = true, repeat = [1, 1] } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// мягкие стеновые панели: бета-ткань, простёжка, липучки, маркировка
function paddedWall(seed) {
  const r = rng(seed);
  const draw = (g, n, m, bump) => {
    g.fillStyle = bump ? '#909090' : '#d8d4ca';
    g.fillRect(0, 0, n, m);
    const cols = 3;
    const rows = 2;
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const x = (i * n) / cols;
        const y = (j * m) / rows;
        const w = n / cols;
        const h = m / rows;
        if (!bump) {
          const v = 205 + Math.floor(r() * 18);
          g.fillStyle = `rgb(${v},${v - 4},${v - 12})`;
          g.fillRect(x + 4, y + 4, w - 8, h - 8);
        }
        // простёжка
        g.strokeStyle = bump ? '#606060' : 'rgba(150,144,132,0.9)';
        g.setLineDash([5, 4]);
        g.lineWidth = bump ? 3 : 1.5;
        g.strokeRect(x + 12, y + 12, w - 24, h - 24);
        g.setLineDash([]);
        // шов между панелями
        g.strokeStyle = bump ? '#202020' : 'rgba(90,86,78,1)';
        g.lineWidth = bump ? 6 : 3;
        g.strokeRect(x + 2, y + 2, w - 4, h - 4);
        // липучки
        if (!bump) {
          for (let k = 0; k < 2; k++) {
            g.fillStyle = 'rgba(40,40,40,0.75)';
            g.fillRect(x + 20 + r() * (w - 70), y + 20 + r() * (h - 60), 30, 18);
          }
        }
      }
    if (!bump) {
      g.fillStyle = 'rgba(30,30,30,0.85)';
      g.font = `600 ${n / 40}px sans-serif`;
      g.fillText('ПАНЕЛЬ 3-Л  · ДОСТУП К ЖГУТАМ', n * 0.05, m * 0.95);
      g.fillStyle = 'rgba(180,40,30,0.9)';
      g.fillText('▲ ОГНЕТУШИТЕЛЬ', n * 0.7, m * 0.1);
    }
  };
  return {
    map: canvasTex(512, 384, (g, n, m) => draw(g, n, m, false)),
    bump: canvasTex(512, 384, (g, n, m) => draw(g, n, m, true), { srgb: false }),
  };
}

// приборная панель: анодированный алюминий, шелкография, контуры групп
function instrumentPanel(seed, title, labels) {
  const r = rng(seed);
  const base = (g, n, m) => {
    g.fillStyle = '#2b2f34';
    g.fillRect(0, 0, n, m);
    for (let k = 0; k < 900; k++) {
      g.fillStyle = `rgba(255,255,255,${r() * 0.025})`;
      g.fillRect(r() * n, r() * m, 1 + r() * 3, 1);
    }
    g.strokeStyle = 'rgba(200,205,210,0.55)';
    g.lineWidth = 2;
    g.strokeRect(6, 6, n - 12, m - 12);
    // винты по углам
    g.fillStyle = '#7c838c';
    for (const [x, y] of [
      [14, 14],
      [n - 14, 14],
      [14, m - 14],
      [n - 14, m - 14],
    ]) {
      g.beginPath();
      g.arc(x, y, 4, 0, Math.PI * 2);
      g.fill();
    }
  };
  const text = (g, n, m, color) => {
    g.fillStyle = color;
    g.font = `700 ${m / 14}px sans-serif`;
    g.fillText(title, 22, m / 7);
    g.font = `600 ${m / 20}px sans-serif`;
    labels.forEach((l, i) => {
      const cols = Math.min(labels.length, 6);
      const x = 22 + (i % cols) * ((n - 40) / cols);
      const y = m * (0.42 + 0.33 * Math.floor(i / cols));
      g.fillText(l, x, y);
      g.strokeStyle = color;
      g.lineWidth = 1.5;
      g.strokeRect(x - 4, y + 6, (n - 60) / cols - 6, m * 0.18);
    });
  };
  const map = canvasTex(512, 256, (g, n, m) => {
    base(g, n, m);
    text(g, n, m, 'rgba(225,228,232,0.92)');
  });
  const emissive = canvasTex(512, 256, (g, n, m) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, n, m);
    text(g, n, m, 'rgba(140,255,190,0.9)');
  });
  return { map, emissive };
}

function diamondPlate() {
  const draw = (g, n, bump) => {
    g.fillStyle = bump ? '#707070' : '#3a3d41';
    g.fillRect(0, 0, n, n);
    for (let y = 0; y < n; y += 16)
      for (let x = 0; x < n; x += 16) {
        const o = (y / 16) % 2 ? 8 : 0;
        g.save();
        g.translate(x + o + 8, y + 8);
        g.rotate(((x + y) / 16) % 2 ? 0.8 : -0.8);
        g.fillStyle = bump ? '#d0d0d0' : '#55595e';
        g.fillRect(-6, -1.5, 12, 3);
        g.restore();
      }
  };
  return {
    map: canvasTex(256, 256, (g, n) => draw(g, n, false), { repeat: [4, 5] }),
    bump: canvasTex(256, 256, (g, n) => draw(g, n, true), { srgb: false, repeat: [4, 5] }),
  };
}

function stripes() {
  return canvasTex(
    128,
    32,
    (g, n, m) => {
      g.fillStyle = '#e0ae1a';
      g.fillRect(0, 0, n, m);
      g.fillStyle = '#141414';
      for (let i = -2; i < 8; i++) {
        g.beginPath();
        g.moveTo(i * 24, 0);
        g.lineTo(i * 24 + 12, 0);
        g.lineTo(i * 24 + 12 + m, m);
        g.lineTo(i * 24 + m, m);
        g.closePath();
        g.fill();
      }
    },
    { repeat: [10, 1] },
  );
}

function placard(text, sub, bg = '#e8e2d0', fg = '#1a1a1a', w = 512, h = 160) {
  return canvasTex(w, h, (g, n, m) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, n, m);
    g.strokeStyle = fg;
    g.lineWidth = 6;
    g.strokeRect(6, 6, n - 12, m - 12);
    g.fillStyle = fg;
    g.font = `700 ${m * 0.3}px sans-serif`;
    g.fillText(text, 22, m * 0.45);
    g.font = `500 ${m * 0.18}px sans-serif`;
    g.fillText(sub, 22, m * 0.78);
  });
}

// Стекло: френелевское отражение света кабины, пыль и микроцарапины,
// подсвеченные внешним светом, трещины при повреждении.
const GLASS_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const GLASS_FRAG = /* glsl */ `
uniform vec3 uExtColor;
uniform vec3 uExtDir;
uniform vec3 uInterior;
uniform float uDamage;
uniform float uTime;
varying vec3 vN;
varying vec3 vV;
varying vec2 vUv;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(vV);
  float fres = pow(1.0 - abs(dot(N, V)), 4.0) * 0.6 + 0.02;
  float dust = n2(vUv * 60.0) * n2(vUv * 13.0 + 3.1);
  dust = smoothstep(0.35, 0.95, dust) * 0.5;
  float scratch = smoothstep(0.985, 1.0, n2(vec2(vUv.x * 400.0, vUv.y * 6.0)));
  // рассеяние внешнего света на пыли (сильнее при свете спереди)
  float fwd = pow(max(dot(-V, normalize(uExtDir)), 0.0), 6.0);
  vec3 col = uInterior * fres + uExtColor * (dust * 0.05 + scratch * 0.08) * (0.3 + 3.0 * fwd);
  float a = clamp(fres + dust * 0.04, 0.0, 0.6);
  // трещины
  if (uDamage > 0.0) {
    vec2 q = vUv * vec2(6.0, 3.0);
    float cr = 0.0;
    for (int i = 0; i < 4; i++) {
      vec2 c = vec2(h(vec2(float(i), 1.0)), h(vec2(float(i), 2.0))) * vec2(6.0, 3.0);
      vec2 d = q - c;
      float ang = atan(d.y, d.x);
      float spoke = abs(fract(ang * 1.4 + h(vec2(float(i), 3.0))) - 0.5);
      float rr = length(d);
      cr += smoothstep(0.03, 0.0, spoke * rr) * smoothstep(1.2 * uDamage + 0.05, 0.0, rr);
      cr += smoothstep(0.02, 0.0, abs(rr - 0.35 * uDamage)) * 0.4 * step(rr, 1.0);
    }
    col += vec3(0.8) * cr * 0.25;
    a = max(a, cr * 0.5);
  }
  gl_FragColor = vec4(col, a);
}`;

export class Cockpit {
  constructor(monitors) {
    this.group = new THREE.Group();
    this.monitors = monitors;
    this.build();
    this.group.traverse((o) => {
      if (o.isMesh && !o.userData.noShadow) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }

  add(geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = this.group) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    parent.add(m);
    return m;
  }

  rbox(w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0, rad = 0.02, parent = this.group) {
    return this.add(new RoundedBoxGeometry(w, h, d, 3, Math.min(rad, w / 2.2, h / 2.2, d / 2.2)), mat, x, y, z, rx, ry, rz, parent);
  }

  tube(points, radius, mat, segs = 48) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, segs, radius, 12, false), mat);
    this.group.add(m);
    return m;
  }

  build() {
    const G = this.group;
    const wall = paddedWall(4);
    const wallMat = new THREE.MeshStandardMaterial({ map: wall.map, bumpMap: wall.bump, bumpScale: 1.5, roughness: 0.92, metalness: 0 });
    const wall2 = paddedWall(17);
    const wallMat2 = new THREE.MeshStandardMaterial({ map: wall2.map, bumpMap: wall2.bump, bumpScale: 1.5, roughness: 0.92, metalness: 0 });
    const painted = new THREE.MeshStandardMaterial({ color: 0x4a4f56, roughness: 0.55, metalness: 0.55 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x5b6068, roughness: 0.38, metalness: 0.85 });
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x1e2125, roughness: 0.5, metalness: 0.6 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.95, metalness: 0 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dde3, roughness: 0.18, metalness: 1 });
    const fabric = new THREE.MeshStandardMaterial({ color: 0x23303f, roughness: 0.95, metalness: 0 });
    const strap = new THREE.MeshStandardMaterial({ color: 0x3a4652, roughness: 0.85, metalness: 0 });
    const orange = new THREE.MeshStandardMaterial({ color: 0xd9541c, roughness: 0.6, metalness: 0.1 });
    const floor = diamondPlate();
    const floorMat = new THREE.MeshStandardMaterial({ map: floor.map, bumpMap: floor.bump, bumpScale: 2, roughness: 0.5, metalness: 0.8 });
    const railMat = new THREE.MeshStandardMaterial({ map: stripes(), roughness: 0.5, metalness: 0.2 });
    const panelTex = (seed, title, labels) => {
      const p = instrumentPanel(seed, title, labels);
      return new THREE.MeshStandardMaterial({ map: p.map, emissiveMap: p.emissive, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.55, metalness: 0.45 });
    };

    // ---------------------------------------------------------------- пол
    this.rbox(2.5, 0.06, 3.3, floorMat, 0, -1.16, 0.1, 0, 0, 0, 0.01);

    // --------------------------------------------------- приборная панель
    const mainPanel = panelTex(3, 'ГЛАВНАЯ ПАНЕЛЬ', ['ДУ ГЛАВН.', 'РСУ', 'ПИТ. А', 'ПИТ. Б', 'СВЯЗЬ', 'НАВ.']);
    mainPanel.map.repeat.set(2, 1);
    mainPanel.emissiveMap.repeat.set(2, 1);
    mainPanel.emissiveIntensity = 0.35;
    this.rbox(2.36, 0.07, 0.6, mainPanel, 0, -0.5, -0.98, -0.42, 0, 0, 0.025);
    this.rbox(2.36, 0.52, 0.5, painted, 0, -0.87, -1.08, 0, 0, 0, 0.04);
    this.rbox(2.42, 0.045, 0.07, chrome, 0, -0.39, -0.7, 0, 0, 0, 0.02);
    // противобликовый козырёк над мониторами
    this.rbox(1.9, 0.022, 0.2, darkMetal, 0, -0.275, -1.1, 0.28, 0, 0, 0.01);

    // мониторы с рамками и кнопками по краю
    const mons = [
      { id: 'nav', x: -0.6, ry: 0.32 },
      { id: 'time', x: 0, ry: 0 },
      { id: 'struct', x: 0.6, ry: -0.32 },
    ];
    const btnGeo = new THREE.BoxGeometry(0.026, 0.018, 0.012);
    const btns = new THREE.InstancedMesh(btnGeo, new THREE.MeshStandardMaterial({ color: 0x2c3035, roughness: 0.6, metalness: 0.3 }), mons.length * 14);
    let bi = 0;
    const m4 = new THREE.Matrix4();
    for (const m of mons) {
      const grp = new THREE.Group();
      grp.position.set(m.x, -0.44, -0.9 + Math.abs(m.x) * 0.25);
      grp.rotation.set(-0.42, m.ry, 0, 'YXZ');
      this.rbox(0.6, 0.4, 0.04, darkMetal, 0, 0, -0.022, 0, 0, 0, 0.015, grp);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.325), this.monitors.material(m.id));
      screen.position.z = 0.0;
      screen.userData.noShadow = true;
      grp.add(screen);
      G.add(grp);
      grp.updateMatrixWorld();
      for (let k = 0; k < 7; k++) {
        for (const yy of [-0.185, 0.185]) {
          m4.makeTranslation(-0.21 + k * 0.07, yy, 0.002);
          m4.premultiply(grp.matrixWorld);
          btns.setMatrixAt(bi++, m4);
        }
      }
    }
    G.add(btns);

    // --------------------------------------------- тумблеры и ручки (instanced)
    const switchBase = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.009, 0.011, 0.012, 10), chrome, 160);
    const switchLever = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0035, 0.0045, 0.03, 8), chrome, 160);
    const guards = new THREE.InstancedMesh(new THREE.TorusGeometry(0.016, 0.0025, 6, 12, Math.PI), new THREE.MeshStandardMaterial({ color: 0xc8c8c8, roughness: 0.4, metalness: 0.9 }), 80);
    const knobs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.014, 0.016, 0.018, 16), rubber, 40);
    let si = 0;
    let gi = 0;
    let ki = 0;
    const r = rng(99);
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const placeRow = (origin, rot, n, dx, withGuards, tiltSign = 1) => {
      // origin — точка на поверхности панели, rot — её ориентация (нормаль = +Y)
      const basis = new THREE.Matrix4().makeRotationFromEuler(rot);
      for (let i = 0; i < n; i++) {
        const local = new THREE.Vector3(i * dx, 0, 0).applyMatrix4(basis).add(origin);
        m4.compose(local, q.setFromEuler(rot), new THREE.Vector3(1, 1, 1));
        switchBase.setMatrixAt(si, m4);
        const up = r() > 0.4 ? 1 : -1;
        e.copy(rot);
        const lev = new THREE.Matrix4().makeRotationFromEuler(rot).multiply(new THREE.Matrix4().makeRotationX(0.45 * up * tiltSign));
        const p2 = new THREE.Vector3(0, 0.017, 0).applyMatrix4(lev).add(local);
        m4.compose(p2, new THREE.Quaternion().setFromRotationMatrix(lev), new THREE.Vector3(1, 1, 1));
        switchLever.setMatrixAt(si, m4);
        si++;
        if (withGuards && i % 2 === 0 && gi < 80) {
          const gm = new THREE.Matrix4().makeRotationFromEuler(rot).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2));
          m4.compose(new THREE.Vector3(0, 0.002, 0).applyMatrix4(basis).add(local), new THREE.Quaternion().setFromRotationMatrix(gm), new THREE.Vector3(1, 1, 1));
          guards.setMatrixAt(gi++, m4);
        }
      }
    };
    const placeKnobs = (origin, rot, n, dx) => {
      const basis = new THREE.Matrix4().makeRotationFromEuler(rot);
      for (let i = 0; i < n && ki < 40; i++) {
        const local = new THREE.Vector3(i * dx, 0.006, 0).applyMatrix4(basis).add(origin);
        m4.compose(local, q.setFromEuler(rot), new THREE.Vector3(1, 1, 1));
        knobs.setMatrixAt(ki++, m4);
      }
    };
    // на главной панели — два ряда тумблеров слева и справа от мониторов
    const panelRot = new THREE.Euler(-0.42, 0, 0);
    placeRow(new THREE.Vector3(-1.08, -0.455, -0.78), panelRot, 6, 0.045, true);
    placeRow(new THREE.Vector3(0.86, -0.455, -0.78), panelRot, 6, 0.045, true);
    placeKnobs(new THREE.Vector3(-1.06, -0.475, -0.84), panelRot, 4, 0.06);
    placeKnobs(new THREE.Vector3(0.88, -0.475, -0.84), panelRot, 4, 0.06);

    // ------------------------------------------------------ боковые пульты
    for (const s of [-1, 1]) {
      this.rbox(0.42, 0.44, 1.4, painted, s * 0.82, -0.95, 0.15, 0, 0, 0, 0.04);
      const sideMat = panelTex(20 + s, s < 0 ? 'ПУЛЬТ ЛЕВ. · ДУ' : 'ПУЛЬТ ПРАВ. · СЖО', s < 0 ? ['ТЯГА', 'ФОРСАЖ', 'РЕЗЕРВ', 'ПОДАЧА'] : ['O₂', 'ДАВЛ.', 'ТЕМП.', 'CO₂']);
      const top = this.rbox(0.38, 0.03, 1.3, sideMat, s * 0.8, -0.72, 0.15, 0, 0, s * 0.12, 0.01);
      top.material.map.rotation = Math.PI / 2;
      top.material.map.center.set(0.5, 0.5);
      const small = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2), this.monitors.material(s < 0 ? 'aux' : 'disk'));
      small.position.set(s * 0.8, -0.698, -0.25);
      small.rotation.set(-Math.PI / 2 + 0.5, 0, 0);
      small.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), s * 0.12);
      small.userData.noShadow = true;
      G.add(small);
      const rot = new THREE.Euler(0, Math.PI / 2, s * 0.12, 'XYZ');
      placeRow(new THREE.Vector3(s * 0.8 - s * 0.08, -0.7, 0.05), new THREE.Euler(0, 0, s * 0.12), 1, 0, false);
      for (let row = 0; row < 3; row++) placeRow(new THREE.Vector3(s * 0.74, -0.70 + s * 0.006 * row, 0.15 + row * 0.12), new THREE.Euler(0, Math.PI / 2, s * 0.12), 6, 0.05, row === 0);
      void rot;
    }

    // ------------------------------------------------- верхний пульт (потолок)
    const overhead = panelTex(31, 'ВЕРХНИЙ ПУЛЬТ · ЭНЕРГОСИСТЕМА', ['РЕАКТОР', 'ШИНА А', 'ШИНА Б', 'АККУМ.', 'РАДИАТ.', 'ОСВЕЩ.']);
    const ohRot = new THREE.Euler(Math.PI + 0.25, 0, 0);
    this.rbox(1.2, 0.06, 0.8, overhead, 0, 1.02, 0.35, ohRot.x, 0, 0, 0.02);
    for (let row = 0; row < 3; row++) {
      placeRow(new THREE.Vector3(-0.45, 0.985 - row * 0.045, 0.12 + row * 0.18), ohRot, 10, 0.1, row !== 1, -1);
    }
    for (const im of [switchBase, switchLever, guards, knobs]) {
      im.count = im === switchBase || im === switchLever ? si : im === guards ? gi : ki;
      im.instanceMatrix.needsUpdate = true;
      G.add(im);
    }

    // ---------------------------------------------- сигнальные лампы (табло)
    this.lamps = [];
    const lampColors = [0x2aff6a, 0x2aff6a, 0xffb020, 0x2aff6a, 0xff3020, 0x2aff6a, 0x2aa0ff, 0xffb020];
    lampColors.forEach((c, i) => {
      const m = new THREE.MeshStandardMaterial({ color: 0x050505, emissive: c, emissiveIntensity: 0.9 });
      const l = this.rbox(0.05, 0.022, 0.03, m, -0.21 + i * 0.06, -0.37, -0.74, -0.42, 0, 0, 0.004);
      l.userData.noShadow = true;
      this.lamps.push({ mat: m, base: c, phase: i * 0.37 });
    });

    // --------------------------------------------- рама фонаря и стекло
    const L = [
      [-1.08, -0.38, -1.22],
      [-1.0, 0.2, -0.95],
      [-0.82, 0.8, -0.5],
      [-0.7, 1.02, -0.2],
    ];
    const R = L.map(([x, y, z]) => [-x, y, z]);
    this.tube(L, 0.07, frameMat);
    this.tube(R, 0.07, frameMat);
    this.tube(
      [
        [-0.7, 1.02, -0.2],
        [0, 1.08, -0.26],
        [0.7, 1.02, -0.2],
      ],
      0.065,
      frameMat,
    );
    this.tube(
      [
        [-1.08, -0.38, -1.22],
        [0, -0.36, -1.34],
        [1.08, -0.38, -1.22],
      ],
      0.06,
      frameMat,
    );
    this.tube(L.map(([x, y, z]) => [x * 0.96, y, z + 0.045]), 0.024, rubber);
    this.tube(R.map(([x, y, z]) => [x * 0.96, y, z + 0.045]), 0.024, rubber);
    // болты по стойкам
    const bolts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.009, 0.009, 0.012, 6), chrome, 40);
    const cL = new THREE.CatmullRomCurve3(L.map((p) => new THREE.Vector3(...p)));
    let bo = 0;
    for (const sgn of [-1, 1])
      for (let i = 1; i < 20; i++) {
        const p = cL.getPoint(i / 20);
        p.x *= sgn === -1 ? 1 : -1;
        p.z += 0.06;
        m4.makeRotationX(Math.PI / 2);
        m4.setPosition(p);
        bolts.setMatrixAt(bo++, m4);
      }
    bolts.count = bo;
    G.add(bolts);

    const lowerC = new THREE.CatmullRomCurve3([new THREE.Vector3(-1.08, -0.38, -1.22), new THREE.Vector3(0, -0.36, -1.34), new THREE.Vector3(1.08, -0.38, -1.22)]);
    const leftC = new THREE.CatmullRomCurve3(L.map((p) => new THREE.Vector3(...p)));
    const rightC = new THREE.CatmullRomCurve3(R.map((p) => new THREE.Vector3(...p)));
    const upperC = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.7, 1.02, -0.2), new THREE.Vector3(0, 1.08, -0.26), new THREE.Vector3(0.7, 1.02, -0.2)]);
    const segU = 40;
    const segV = 24;
    const pos = [];
    const uvs = [];
    const idx = [];
    const tmp = new THREE.Vector3();
    for (let j = 0; j <= segV; j++) {
      const v = j / segV;
      const pl = leftC.getPoint(v);
      const pr = rightC.getPoint(v);
      for (let i = 0; i <= segU; i++) {
        const u = i / segU;
        const lo = lowerC.getPoint(u);
        const up = upperC.getPoint(u);
        const p = new THREE.Vector3().copy(lo).multiplyScalar(1 - v).addScaledVector(up, v).addScaledVector(pl, 1 - u).addScaledVector(pr, u);
        tmp.copy(lowerC.getPoint(0)).multiplyScalar((1 - u) * (1 - v));
        p.sub(tmp);
        tmp.copy(lowerC.getPoint(1)).multiplyScalar(u * (1 - v));
        p.sub(tmp);
        tmp.copy(upperC.getPoint(0)).multiplyScalar((1 - u) * v);
        p.sub(tmp);
        tmp.copy(upperC.getPoint(1)).multiplyScalar(u * v);
        p.sub(tmp);
        const bulge = 0.08 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
        p.z -= bulge;
        p.y += bulge * 0.3;
        pos.push(p.x, p.y, p.z);
        uvs.push(u, v);
      }
    }
    for (let j = 0; j < segV; j++)
      for (let i = 0; i < segU; i++) {
        const a = j * (segU + 1) + i;
        const b = a + 1;
        const c = a + segU + 1;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    gg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    gg.setIndex(idx);
    gg.computeVertexNormals();
    this.glassUniforms = {
      uExtColor: { value: new THREE.Color(0, 0, 0) },
      uExtDir: { value: new THREE.Vector3(0, 0, -1) },
      uInterior: { value: new THREE.Color(0.1, 0.12, 0.14) },
      uDamage: { value: 0 },
      uTime: { value: 0 },
    };
    const glass = new THREE.Mesh(
      gg,
      new THREE.ShaderMaterial({ vertexShader: GLASS_VERT, fragmentShader: GLASS_FRAG, uniforms: this.glassUniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    glass.renderOrder = 10;
    glass.userData.noShadow = true;
    G.add(glass);

    // ------------------------------------- стены, потолок, иллюминаторы, люк
    for (const s of [-1, 1]) {
      const x = s * 1.22;
      const wm = s < 0 ? wallMat : wallMat2;
      // цельная стенка с эллиптическим вырезом под иллюминатор
      const shape = new THREE.Shape();
      shape.moveTo(-0.45, -1.16);
      shape.lineTo(1.5, -1.16);
      shape.lineTo(1.5, 1.12);
      shape.lineTo(-0.45, 1.12);
      shape.closePath();
      const hole = new THREE.Path();
      hole.absellipse(0.45, 0.02, 0.4, 0.29, 0, Math.PI * 2, true);
      shape.holes.push(hole);
      const wg = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2, curveSegments: 40 });
      const wmat = wm.clone();
      wmat.map = wm.map.clone();
      // на левой стенке развёртка зеркальна — отражаем текстуру, чтобы надписи читались
      wmat.map.repeat.set(s < 0 ? -0.75 : 0.75, 0.75);
      wmat.map.needsUpdate = true;
      wmat.bumpMap = wm.bumpMap.clone();
      wmat.bumpMap.repeat.set(s < 0 ? -0.75 : 0.75, 0.75);
      wmat.bumpMap.needsUpdate = true;
      const wallMesh = new THREE.Mesh(wg, wmat);
      wallMesh.rotation.y = -Math.PI / 2;
      wallMesh.position.x = s > 0 ? 1.26 : -1.18;
      G.add(wallMesh);
      // остекление иллюминатора: тонированное стекло с отражениями
      const pg = new THREE.Mesh(
        new THREE.CircleGeometry(1, 48),
        new THREE.MeshStandardMaterial({ color: 0x0a1018, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.12, depthWrite: false }),
      );
      pg.scale.set(0.4, 0.29, 1);
      pg.position.set(s * 1.235, 0.02, 0.45);
      pg.rotation.y = -s * Math.PI / 2;
      pg.userData.noShadow = true;
      G.add(pg);
      const fr = new THREE.Mesh(new THREE.TorusGeometry(1, 0.11, 12, 48), frameMat);
      fr.position.set(x - s * 0.04, 0.02, 0.45);
      fr.rotation.y = Math.PI / 2;
      fr.scale.set(0.4, 0.29, 0.4);
      G.add(fr);
      // поручни вдоль потолка
      this.tube(
        [
          [s * 1.02, 0.92, -0.05],
          [s * 1.06, 0.98, 0.05],
          [s * 1.06, 0.98, 1.15],
          [s * 1.02, 0.92, 1.25],
        ],
        0.017,
        railMat,
        24,
      );
      // кабельные жгуты у пола
      for (let k = 0; k < 3; k++) {
        this.tube(
          [
            [s * (1.13 - k * 0.025), -1.08 + k * 0.03, -0.6],
            [s * (1.12 - k * 0.025), -1.02 + k * 0.03, 0.3],
            [s * (1.14 - k * 0.025), -1.06 + k * 0.03, 1.4],
          ],
          0.012,
          k === 1 ? orange : rubber,
          20,
        );
      }
    }
    this.rbox(2.5, 0.09, 2.0, wallMat2, 0, 1.13, 0.5, 0, 0, 0, 0.03);
    // «щёки»: линейчатые поверхности между стойками фонаря и боковыми стенками
    // (кабина замкнута — свет снаружи попадает только через остекление)
    for (const s of [-1, 1]) {
      const pts = (s < 0 ? L : R).map((p) => new THREE.Vector3(...p));
      const curve = new THREE.CatmullRomCurve3(pts);
      const n = 24;
      const pos2 = [];
      const idx2 = [];
      const uv2 = [];
      for (let i = 0; i <= n; i++) {
        const p = curve.getPoint(i / n);
        p.x += s * 0.05; // под трубой стойки
        pos2.push(p.x, p.y, p.z, s * 1.24, p.y, p.z);
        uv2.push(i / n, 0, i / n, 1);
      }
      // продолжение вверх до потолка
      const top = curve.getPoint(1);
      pos2.push(top.x + s * 0.05, 1.18, top.z, s * 1.24, 1.18, top.z);
      uv2.push(1, 0, 1, 1);
      for (let i = 0; i <= n; i++) {
        const a = i * 2;
        idx2.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      const cg = new THREE.BufferGeometry();
      cg.setAttribute('position', new THREE.Float32BufferAttribute(pos2, 3));
      cg.setAttribute('uv', new THREE.Float32BufferAttribute(uv2, 2));
      cg.setIndex(idx2);
      cg.computeVertexNormals();
      const cheek = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({ color: 0x4a4f56, roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide }));
      G.add(cheek);
      // нижняя закрывающая панель между пультом и стенкой
      this.rbox(0.16, 0.8, 0.9, painted, s * 1.16, -0.78, -0.8, 0, 0, 0, 0.02);
    }
    // светодиодные панели на потолке
    const ledMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xfff1df, emissiveIntensity: 1.6 });
    for (const x of [-0.72, 0.72]) {
      const l = this.rbox(0.42, 0.02, 0.7, ledMat, x, 1.08, 0.7, 0, 0, 0, 0.008);
      l.userData.noShadow = true;
    }
    // задняя стена с люком
    this.rbox(2.58, 2.4, 0.1, wallMat, 0, -0.03, 1.5, 0, 0, 0, 0.03);
    const hatch = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.06, 14, 48), frameMat);
    hatch.position.set(0, -0.25, 1.43);
    G.add(hatch);
    this.rbox(0.74, 0.74, 0.05, painted, 0, -0.25, 1.45, 0, 0, Math.PI / 4, 0.3);
    this.add(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 24).rotateX(Math.PI / 2), chrome, 0, -0.25, 1.41);
    this.tube(
      [
        [-0.62, -0.7, 1.42],
        [-0.64, -0.25, 1.4],
        [-0.62, 0.2, 1.42],
      ],
      0.017,
      railMat,
      16,
    );
    // таблички
    const sign1 = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.13), new THREE.MeshStandardMaterial({ map: placard('АВАРИЙНЫЙ ЛЮК', 'ПОВЕРНУТЬ ПРОТИВ ЧАСОВОЙ · 3 ОБ.'), roughness: 0.6 }));
    sign1.position.set(0, 0.32, 1.44);
    sign1.rotation.y = Math.PI;
    G.add(sign1);
    const sign2 = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.1),
      new THREE.MeshStandardMaterial({ map: placard('⚠ РАДИАЦИЯ', 'ТЕНЕВАЯ ЗАЩИТА РЕАКТОРА — КОРМА', '#f2c21b', '#111'), roughness: 0.6 }),
    );
    sign2.position.set(1.17, 0.45, 1.0);
    sign2.rotation.y = -Math.PI / 2;
    G.add(sign2);
    const sign3 = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.09), new THREE.MeshStandardMaterial({ map: placard('ИК «ГОРИЗОНТ»', 'БОРТ 01 · ЭКИПАЖ 3', '#1c2733', '#cfe6ff'), roughness: 0.6 }));
    sign3.position.set(-1.17, 0.48, 1.0);
    sign3.rotation.y = Math.PI / 2;
    G.add(sign3);

    // ---------------------------------------------------------- кресло
    this.rbox(0.62, 0.13, 0.58, fabric, 0, -0.72, 0.3, 0, 0, 0, 0.05);
    this.rbox(0.62, 0.95, 0.13, fabric, 0, -0.2, 0.68, -0.18, 0, 0, 0.05);
    this.rbox(0.36, 0.26, 0.15, fabric, 0, 0.42, 0.79, -0.18, 0, 0, 0.06);
    for (const s of [-1, 1]) {
      this.rbox(0.09, 0.85, 0.16, fabric, s * 0.33, -0.22, 0.64, -0.18, 0, 0, 0.04);
      this.rbox(0.09, 0.08, 0.55, painted, s * 0.37, -0.55, 0.25, 0, 0, 0, 0.03);
      // ремни
      this.rbox(0.05, 0.7, 0.012, strap, s * 0.13, -0.18, 0.6, -0.18, 0, s * 0.16, 0.006);
    }
    this.rbox(0.05, 0.3, 0.012, strap, 0, -0.55, 0.555, -0.6, 0, 0, 0.006);
    this.add(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 20).rotateX(Math.PI / 2 - 0.3), chrome, 0, -0.42, 0.57);
    this.rbox(0.12, 0.45, 0.12, darkMetal, 0, -0.98, 0.32, 0, 0, 0, 0.02);

    // ручки управления: слева РУД (тяга), справа ручка ориентации
    this.throttle = new THREE.Group();
    this.throttle.position.set(-0.46, -0.5, 0.05);
    this.rbox(0.03, 0.18, 0.03, darkMetal, 0, 0.09, 0, 0, 0, 0, 0.01, this.throttle);
    this.rbox(0.08, 0.06, 0.1, orange, 0, 0.2, 0, 0, 0, 0, 0.02, this.throttle);
    G.add(this.throttle);
    this.stick = new THREE.Group();
    this.stick.position.set(0.46, -0.5, 0.05);
    this.rbox(0.03, 0.2, 0.03, darkMetal, 0, 0.1, 0, 0, 0, 0, 0.01, this.stick);
    this.rbox(0.055, 0.09, 0.06, rubber, 0, 0.23, 0, 0, 0, 0, 0.02, this.stick);
    this.add(new THREE.CylinderGeometry(0.008, 0.008, 0.01, 10), new THREE.MeshStandardMaterial({ color: 0x990000, emissive: 0x550000 }), 0, 0.28, 0, 0, 0, 0, this.stick);
    G.add(this.stick);

    // аварийная световая полоса над панелью
    this.alertMat = new THREE.MeshStandardMaterial({ color: 0x110000, emissive: 0xff1a00, emissiveIntensity: 0 });
    const strip = this.rbox(2.0, 0.012, 0.02, this.alertMat, 0, -0.395, -0.69, 0, 0, 0, 0.004);
    strip.userData.noShadow = true;

    // ---------------------------------------------------------- освещение
    this.cabinLight = new THREE.PointLight(0xffefe0, 2.2, 5.5, 1.5);
    this.cabinLight.position.set(0, 0.9, 0.7);
    G.add(this.cabinLight);
    this.keySpot = new THREE.SpotLight(0xfff4e8, 6, 4, 0.9, 0.7, 1.4);
    this.keySpot.position.set(0, 1.0, 0.95);
    this.keySpot.target.position.set(0, -0.6, -0.8);
    this.keySpot.castShadow = true;
    this.keySpot.shadow.mapSize.set(1024, 1024);
    this.keySpot.shadow.bias = -0.0008;
    this.keySpot.shadow.camera.near = 0.1;
    this.keySpot.shadow.camera.far = 5;
    G.add(this.keySpot);
    G.add(this.keySpot.target);
    this.screenLight = new THREE.PointLight(0x6fb6ff, 0.5, 2.5, 2);
    this.screenLight.position.set(0, -0.3, -0.7);
    G.add(this.screenLight);
    this.alertLight = new THREE.PointLight(0xff2200, 0, 6, 1.5);
    this.alertLight.position.set(0, 0.6, 0.9);
    G.add(this.alertLight);
  }

  update(dt, t, { thrust = [0, 0, 0], rot = [0, 0, 0], alert = 0, damage = 0, extColor, extDir, failures = 0 }) {
    this.throttle.rotation.x = 0.5 * thrust[2];
    this.throttle.rotation.z = -0.3 * thrust[0];
    this.stick.rotation.x = -0.35 * Math.sign(rot[0]) * Math.min(1, Math.abs(rot[0]) * 3);
    this.stick.rotation.z = 0.35 * Math.sign(rot[1]) * Math.min(1, Math.abs(rot[1]) * 3);
    this.stick.rotation.y = 0.3 * Math.sign(rot[2]) * Math.min(1, Math.abs(rot[2]) * 3);
    const blink = alert > 0 ? 0.5 + 0.5 * Math.sin(t * 9) : 0;
    this.alertMat.emissiveIntensity = alert * (0.3 + 2.5 * blink);
    this.alertLight.intensity = alert * 2.5 * blink;
    // табло: часть ламп мигает, отказы гасят лампы
    this.lamps.forEach((l, i) => {
      const dead = failures > i;
      const flick = l.base === 0xffb020 ? 0.6 + 0.4 * Math.sin(t * 3 + l.phase * 10) : 1;
      l.mat.emissiveIntensity = dead ? (i % 2 ? 0 : 0.9 * (Math.sin(t * 7 + i) > 0 ? 1 : 0)) : 0.9 * flick;
      if (dead) l.mat.emissive.setHex(0xff3020);
      else l.mat.emissive.setHex(l.base);
    });
    this.glassUniforms.uDamage.value = damage;
    this.glassUniforms.uTime.value = t;
    if (extColor) this.glassUniforms.uExtColor.value.copy(extColor);
    if (extDir) this.glassUniforms.uExtDir.value.copy(extDir);
  }
}
