// Внешняя модель исследовательского корабля «Горизонт» (длина 74 м).
//
// Компоновка — как у проектов реальных пилотируемых кораблей дальнего
// космоса с ядерной энергоустановкой: командный модуль с иллюминаторами и
// стыковочным узлом; жилой модуль в экранно-вакуумной изоляции (ЭВТИ);
// ферменная балка с баками рабочего тела; большие радиаторы (отвод тепла
// реактора — самая заметная часть такого корабля); теневая защита, реактор
// и плазменный двигатель с магнитным соплом. Освещение — свет диска
// (направленный, с тенями) и собственные прожекторы корабля.
// Пластическая деформация показывается визуально усиленной ×40.

import * as THREE from 'three';

// ------------------------------------------------------- процедурные текстуры

function canvasTex(size, draw, { repeat = [1, 1], srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// белые панели терморегулирующего покрытия со швами, заклёпками и загрязнением
function whitePanels(seed, cols = 6, rows = 4) {
  const r = rng(seed);
  const draw = (g, n, bump) => {
    g.fillStyle = bump ? '#808080' : '#d9d8d2';
    g.fillRect(0, 0, n, n);
    const cw = n / cols;
    const rh = n / rows;
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        if (!bump) {
          const v = 200 + Math.floor(r() * 30);
          g.fillStyle = `rgb(${v},${v - 2},${v - 8})`;
          g.fillRect(i * cw + 2, j * rh + 2, cw - 4, rh - 4);
          // потёки и загрязнение
          for (let k = 0; k < 6; k++) {
            g.fillStyle = `rgba(90,85,75,${r() * 0.06})`;
            g.fillRect(i * cw + r() * cw, j * rh + r() * rh, 2 + r() * 20, 8 + r() * 40);
          }
        }
        g.strokeStyle = bump ? '#303030' : 'rgba(60,60,60,0.85)';
        g.lineWidth = bump ? 3 : 2;
        g.strokeRect(i * cw + 1, j * rh + 1, cw - 2, rh - 2);
        g.fillStyle = bump ? '#b0b0b0' : 'rgba(70,70,70,0.9)';
        for (let k = 0; k < 4; k++) {
          const x = i * cw + (k % 2 ? cw - 7 : 7);
          const y = j * rh + (k < 2 ? 7 : rh - 7);
          g.beginPath();
          g.arc(x, y, 2, 0, Math.PI * 2);
          g.fill();
        }
      }
    if (!bump) {
      // маркировка
      g.fillStyle = 'rgba(160,40,30,0.85)';
      g.font = `bold ${n / 22}px sans-serif`;
      g.fillText('ГОРИЗОНТ', n * 0.08, n * 0.2);
      g.fillStyle = 'rgba(30,30,30,0.7)';
      g.font = `${n / 40}px monospace`;
      g.fillText('ИК-01  НЕ НАСТУПАТЬ', n * 0.55, n * 0.9);
    }
  };
  return {
    map: canvasTex(512, (g, n) => draw(g, n, false)),
    bump: canvasTex(512, (g, n) => draw(g, n, true), { srgb: false }),
  };
}

// экранно-вакуумная теплоизоляция: мятая фольга
function mliFoil(seed, tint = [212, 168, 70]) {
  const r = rng(seed);
  const draw = (g, n, bump) => {
    g.fillStyle = bump ? '#808080' : `rgb(${tint[0]},${tint[1]},${tint[2]})`;
    g.fillRect(0, 0, n, n);
    for (let k = 0; k < 900; k++) {
      const x = r() * n;
      const y = r() * n;
      const w = 6 + r() * 40;
      const a = r() * Math.PI;
      g.save();
      g.translate(x, y);
      g.rotate(a);
      const v = r();
      g.fillStyle = bump ? `rgba(${v > 0.5 ? 255 : 0},${v > 0.5 ? 255 : 0},${v > 0.5 ? 255 : 0},0.18)` : `rgba(${v > 0.5 ? 255 : 60},${v > 0.5 ? 240 : 40},${v > 0.5 ? 200 : 10},0.12)`;
      g.beginPath();
      g.moveTo(-w, 0);
      g.lineTo(0, -w * 0.3);
      g.lineTo(w, 0);
      g.lineTo(0, w * 0.25);
      g.closePath();
      g.fill();
      g.restore();
    }
    // швы одеял и липучки
    g.strokeStyle = bump ? '#202020' : 'rgba(80,60,20,0.8)';
    g.lineWidth = 3;
    for (let i = 1; i < 3; i++) {
      g.beginPath();
      g.moveTo((i * n) / 3, 0);
      g.lineTo((i * n) / 3, n);
      g.stroke();
    }
  };
  return {
    map: canvasTex(512, (g, n) => draw(g, n, false)),
    bump: canvasTex(512, (g, n) => draw(g, n, true), { srgb: false }),
  };
}

function radiatorTex() {
  return canvasTex(
    512,
    (g, n) => {
      g.fillStyle = '#2b3036';
      g.fillRect(0, 0, n, n);
      for (let i = 0; i < 32; i++) {
        const x = (i + 0.5) * (n / 32);
        g.fillStyle = 'rgba(150,155,160,0.35)';
        g.fillRect(x - 1.5, 0, 3, n);
      }
      g.strokeStyle = 'rgba(10,10,12,0.9)';
      g.lineWidth = 4;
      for (let j = 1; j < 4; j++) {
        g.beginPath();
        g.moveTo(0, (j * n) / 4);
        g.lineTo(n, (j * n) / 4);
        g.stroke();
      }
    },
    { repeat: [2, 1] },
  );
}

function stripeTex() {
  return canvasTex(
    128,
    (g, n) => {
      g.fillStyle = '#d6a51c';
      g.fillRect(0, 0, n, n);
      g.fillStyle = '#151515';
      for (let i = -2; i < 6; i++) {
        g.beginPath();
        g.moveTo(i * 32, 0);
        g.lineTo(i * 32 + 16, 0);
        g.lineTo(i * 32 + 16 + n, n);
        g.lineTo(i * 32 + n, n);
        g.closePath();
        g.fill();
      }
    },
    { repeat: [12, 1] },
  );
}

// ----------------------------------------------------------------- модель

export class ShipExterior {
  constructor() {
    this.group = new THREE.Group();
    this.build();
  }

  mesh(geo, mat, x = 0, y = 0, z = 0, parent = this.group) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  build() {
    const G = this.group;
    const wp = whitePanels(11);
    const wp2 = whitePanels(23, 8, 3);
    const gold = mliFoil(5);
    const silver = mliFoil(9, [196, 200, 206]);
    const white = new THREE.MeshStandardMaterial({ map: wp.map, bumpMap: wp.bump, bumpScale: 0.6, metalness: 0.05, roughness: 0.62, color: 0xffffff });
    const white2 = new THREE.MeshStandardMaterial({ map: wp2.map, bumpMap: wp2.bump, bumpScale: 0.6, metalness: 0.05, roughness: 0.6 });
    const goldMat = new THREE.MeshStandardMaterial({ map: gold.map, bumpMap: gold.bump, bumpScale: 1.2, metalness: 1.0, roughness: 0.34 });
    const silverMat = new THREE.MeshStandardMaterial({ map: silver.map, bumpMap: silver.bump, bumpScale: 1.0, metalness: 1.0, roughness: 0.3 });
    const truss = new THREE.MeshStandardMaterial({ color: 0x3c4148, metalness: 0.85, roughness: 0.42 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c1f24, metalness: 0.7, roughness: 0.5 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 1.0, roughness: 0.28 });
    const copper = new THREE.MeshStandardMaterial({ color: 0xb06a3a, metalness: 1.0, roughness: 0.35 });
    const radMat = new THREE.MeshStandardMaterial({ map: radiatorTex(), metalness: 0.4, roughness: 0.75, emissive: 0x2a0c02, emissiveIntensity: 0.35, side: THREE.DoubleSide });
    const rail = new THREE.MeshStandardMaterial({ map: stripeTex(), metalness: 0.3, roughness: 0.5 });
    const windowMat = new THREE.MeshStandardMaterial({ color: 0x0b1420, metalness: 0.9, roughness: 0.06, emissive: 0xffc890, emissiveIntensity: 0.0 });
    this.windowMat = windowMat;

    // --- командный модуль: z ∈ [−37, −24]
    const cmdProfile = [
      [0.0, -37.2],
      [1.1, -37.0],
      [2.1, -36.0],
      [2.8, -34.4],
      [3.2, -32.0],
      [3.3, -24.0],
    ].map(([r, z]) => new THREE.Vector2(r, z));
    const cmdGeo = new THREE.LatheGeometry(cmdProfile, 48);
    cmdGeo.rotateX(Math.PI / 2);
    this.mesh(cmdGeo, white);
    // полоса иллюминаторов кабины (сверху спереди)
    for (let i = -3; i <= 3; i++) {
      const a = (i * 0.17);
      const w = this.mesh(new THREE.BoxGeometry(0.85, 0.12, 0.62), windowMat, Math.sin(a) * 2.9, Math.cos(a) * 2.9, -33.0);
      w.rotation.z = -a;
      w.rotation.x = -0.35;
      w.castShadow = false;
    }
    // стыковочный узел
    this.mesh(new THREE.CylinderGeometry(0.9, 1.0, 0.8, 32).rotateX(Math.PI / 2), steel, 0, 0, -37.5);
    this.mesh(new THREE.TorusGeometry(1.05, 0.12, 12, 40), dark, 0, 0, -37.9);
    // ЭВТИ на задней части модуля
    this.mesh(new THREE.CylinderGeometry(3.35, 3.35, 4.0, 48, 1, true).rotateX(Math.PI / 2), goldMat, 0, 0, -26.2);

    // --- жилой/лабораторный модуль: z ∈ [−24, −10]
    this.mesh(new THREE.CylinderGeometry(3.9, 3.9, 13, 48, 1, true).rotateX(Math.PI / 2), silverMat, 0, 0, -17);
    this.mesh(new THREE.CylinderGeometry(3.3, 3.9, 1.0, 48).rotateX(Math.PI / 2), white2, 0, 0, -23.6);
    this.mesh(new THREE.CylinderGeometry(3.9, 2.0, 1.2, 48).rotateX(Math.PI / 2), white2, 0, 0, -9.9);
    // поручни и кабельные трассы вдоль модуля
    for (const a of [0.6, -0.6, Math.PI - 0.5, Math.PI + 0.5]) {
      const tube = new THREE.CylinderGeometry(0.06, 0.06, 12, 8).rotateX(Math.PI / 2);
      this.mesh(tube, rail, Math.sin(a) * 4.15, Math.cos(a) * 4.15, -17);
    }
    // приборные отсеки на корпусе
    for (let i = 0; i < 5; i++) {
      const a = Math.PI / 2 + (i - 2) * 0.28;
      const b = this.mesh(new THREE.BoxGeometry(1.1, 0.5, 1.6), white2, Math.sin(a) * 4.1, Math.cos(a) * 4.1, -20 + i * 2.2);
      b.rotation.z = -a;
    }
    // иллюминаторы жилого модуля (тёплый свет изнутри)
    this.habWindows = new THREE.MeshStandardMaterial({ color: 0x050608, emissive: 0xffc27a, emissiveIntensity: 1.4 });
    for (let i = 0; i < 4; i++) {
      const w = this.mesh(new THREE.CircleGeometry(0.28, 20), this.habWindows, -3.93, 0.6, -21 + i * 2.6);
      w.rotation.y = -Math.PI / 2;
      w.castShadow = false;
    }

    // --- ферменная балка: z ∈ [−10, 20], сечение 2.6 м
    const L = 30;
    const z0 = -10;
    const half = 1.3;
    const longeron = new THREE.CylinderGeometry(0.12, 0.12, L, 8).rotateX(Math.PI / 2);
    for (const [x, y] of [
      [-half, -half],
      [half, -half],
      [-half, half],
      [half, half],
    ])
      this.mesh(longeron, truss, x, y, z0 + L / 2);
    const bays = 10;
    const bayL = L / bays;
    const brace = new THREE.CylinderGeometry(0.05, 0.05, 1, 6);
    const tmpA = new THREE.Vector3();
    const tmpB = new THREE.Vector3();
    const addStrut = (a, b) => {
      const m = this.mesh(brace, truss);
      tmpA.copy(a).add(b).multiplyScalar(0.5);
      m.position.copy(tmpA);
      tmpB.subVectors(b, a);
      m.scale.y = tmpB.length();
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tmpB.normalize());
      m.castShadow = true;
    };
    const corners = [
      [-half, -half],
      [half, -half],
      [half, half],
      [-half, half],
    ];
    for (let b = 0; b < bays; b++) {
      const za = z0 + b * bayL;
      const zb = za + bayL;
      for (let c = 0; c < 4; c++) {
        const [x1, y1] = corners[c];
        const [x2, y2] = corners[(c + 1) % 4];
        addStrut(new THREE.Vector3(x1, y1, za), new THREE.Vector3(x2, y2, za));
        const flip = (b + c) % 2;
        addStrut(new THREE.Vector3(x1, y1, flip ? za : zb), new THREE.Vector3(x2, y2, flip ? zb : za));
      }
    }
    // кабельная трасса внутри фермы
    this.mesh(new THREE.CylinderGeometry(0.35, 0.35, L, 12).rotateX(Math.PI / 2), dark, 0, 0, z0 + L / 2);

    // --- баки рабочего тела (4 сферы) на кронштейнах
    for (const [x, y, z] of [
      [3.4, 0, -4],
      [-3.4, 0, -4],
      [0, 3.4, 2.5],
      [0, -3.4, 2.5],
    ]) {
      const tank = this.mesh(new THREE.SphereGeometry(2.1, 32, 20), white2, x, y, z);
      tank.rotation.set(0.3, x * 0.2, 0);
      this.mesh(new THREE.TorusGeometry(2.12, 0.07, 8, 40), dark, x, y, z).rotation.x = Math.PI / 2;
      const strut = this.mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.6, 8), truss, x * 0.6, y * 0.6, z);
      strut.rotation.z = x ? Math.PI / 2 : 0;
    }

    // --- радиаторы: два крыла по 20×9 м, по краю — горячие коллекторы
    this.radiators = [];
    for (const s of [-1, 1]) {
      const wing = new THREE.Group();
      wing.position.set(s * 1.4, 0, 12);
      G.add(wing);
      const panel = this.mesh(new THREE.BoxGeometry(20, 0.12, 9), radMat, s * 11.2, 0, 0, wing);
      void panel;
      this.mesh(new THREE.CylinderGeometry(0.22, 0.22, 9.2, 10).rotateX(Math.PI / 2), copper, s * 1.2, 0, 0, wing);
      this.mesh(new THREE.CylinderGeometry(0.16, 0.16, 20, 10).rotateZ(Math.PI / 2), steel, s * 11.2, 0, -4.6, wing);
      this.mesh(new THREE.CylinderGeometry(0.16, 0.16, 20, 10).rotateZ(Math.PI / 2), steel, s * 11.2, 0, 4.6, wing);
      this.radiators.push(wing);
    }

    // --- теневая защита, реактор
    this.mesh(new THREE.CylinderGeometry(1.8, 3.2, 3.2, 40).rotateX(Math.PI / 2), dark, 0, 0, 21.6);
    this.mesh(new THREE.CylinderGeometry(3.25, 3.25, 0.25, 40).rotateX(Math.PI / 2), steel, 0, 0, 20.0);
    this.mesh(new THREE.CylinderGeometry(1.5, 1.5, 3.6, 32).rotateX(Math.PI / 2), silverMat, 0, 0, 25.0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.mesh(new THREE.BoxGeometry(0.3, 0.3, 3.4), copper, Math.cos(a) * 1.6, Math.sin(a) * 1.6, 25.0);
    }

    // --- плазменный двигатель: магнитное сопло (кольцевые катушки) и камера
    this.mesh(new THREE.CylinderGeometry(0.8, 1.3, 3.0, 32, 1, true).rotateX(Math.PI / 2), dark, 0, 0, 28.4);
    const coilR = [1.5, 2.0, 2.6, 3.2];
    coilR.forEach((r, i) => {
      const coil = this.mesh(new THREE.TorusGeometry(r, 0.22 - i * 0.03, 12, 48), copper, 0, 0, 30 + i * 1.8);
      void coil;
      // спицы-кронштейны катушек
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const sp = this.mesh(new THREE.BoxGeometry(0.12, r - 0.8, 0.12), truss, Math.cos(a) * (r + 0.8) * 0.5, Math.sin(a) * (r + 0.8) * 0.5, 30 + i * 1.8);
        sp.rotation.z = a - Math.PI / 2;
      }
    });
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      this.mesh(new THREE.CylinderGeometry(0.1, 0.1, 6.0, 6).rotateX(Math.PI / 2), truss, Math.cos(a) * 3.2, Math.sin(a) * 3.2, 32.2);
    }

    // --- антенна дальней связи на штанге
    this.antenna = new THREE.Group();
    this.antenna.position.set(0, 3.9, -14);
    G.add(this.antenna);
    this.mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 8), truss, 0, 3, 0, this.antenna);
    const dish = this.mesh(new THREE.SphereGeometry(2.4, 32, 10, 0, Math.PI * 2, 0, 0.62), new THREE.MeshStandardMaterial({ color: 0xe8e6df, metalness: 0.2, roughness: 0.5, side: THREE.DoubleSide }), 0, 6.6, 0, this.antenna);
    dish.rotation.x = Math.PI * 0.85;
    this.mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6), steel, 0, 6.2, 0.4, this.antenna).rotation.x = 0.4;
    // мачта датчиков
    this.mesh(new THREE.CylinderGeometry(0.06, 0.06, 4, 6), steel, 0, -4.9, -30).rotation.x = 0.0;
    this.mesh(new THREE.BoxGeometry(0.5, 0.4, 0.7), dark, 0, -7.0, -30);

    // --- двигатели ориентации (РСУ): блоки по четыре сопла
    this.rcsPlumes = [];
    const rcsMat = new THREE.MeshBasicMaterial({ color: 0xbfd8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const z of [-30, 17]) {
      for (const a of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
        const rr = z < 0 ? 3.45 : 1.55;
        const bx = Math.cos(a) * rr;
        const by = Math.sin(a) * rr;
        const block = this.mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), white2, bx, by, z);
        block.rotation.z = a;
        for (const d of [-1, 1]) {
          const nz = this.mesh(new THREE.ConeGeometry(0.1, 0.25, 8, 1, true), dark, bx, by, z + d * 0.35);
          nz.rotation.x = d > 0 ? Math.PI / 2 : -Math.PI / 2;
          const pl = new THREE.Mesh(new THREE.ConeGeometry(0.25, 1.6, 10, 1, true), rcsMat);
          pl.position.set(bx, by, z + d * 1.2);
          pl.rotation.x = d > 0 ? -Math.PI / 2 : Math.PI / 2;
          G.add(pl);
          this.rcsPlumes.push(pl);
        }
      }
    }
    this.rcsMat = rcsMat;

    // --- факел двигателя: слабое свечение плазмы в магнитном сопле
    this.plumeUniforms = { uThrust: { value: 0 }, uTime: { value: 0 } };
    const plumeMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uThrust; uniform float uTime; varying vec2 vUv;
        void main(){
          float a = pow(1.0 - vUv.y, 1.6);
          float core = smoothstep(0.5, 0.0, abs(vUv.x - 0.5));
          float flick = 0.9 + 0.1 * sin(uTime * 47.0 + vUv.y * 30.0);
          vec3 c = mix(vec3(0.55, 0.45, 1.0), vec3(0.85, 0.9, 1.0), core);
          gl_FragColor = vec4(c * a * uThrust * flick * 1.4, 1.0);
        }`,
      uniforms: this.plumeUniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.plume = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 1.1, 34, 32, 1, true), plumeMat);
    this.plume.rotation.x = Math.PI / 2;
    this.plume.position.z = 53;
    G.add(this.plume);

    // --- навигационные огни и прожекторы подсветки корпуса
    this.navLights = [];
    const lamp = (color, x, y, z) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color }));
      m.position.set(x, y, z);
      G.add(m);
      this.navLights.push(m);
    };
    lamp(0xff2a1a, -22.6, 0, 12); // левый борт — красный
    lamp(0x2aff5a, 22.6, 0, 12); // правый борт — зелёный
    lamp(0xffffff, 0, 3.6, -31); // проблесковый
    lamp(0xffffff, 0, -1.7, 19);

    this.floods = [];
    const flood = (x, y, z, tx, ty, tz, intensity) => {
      const s = new THREE.SpotLight(0xfff2e0, intensity, 60, 0.55, 0.6, 1.2);
      s.position.set(x, y, z);
      s.target.position.set(tx, ty, tz);
      G.add(s);
      G.add(s.target);
      this.floods.push(s);
    };
    flood(0, 9.5, 6, 0, 0, -18, 260);
    flood(0, -8, -6, 0, 0, -30, 160);
    flood(9, 5, 0, 10, 0, 12, 200);
    flood(-9, 5, 0, -10, 0, 12, 200);
  }

  update(dt, t, { thrust = 0, deform = 0, failures = {}, breakup = 0, rcs = 0 }) {
    const pu = this.plumeUniforms.uThrust;
    pu.value += (Math.min(1.5, thrust) - pu.value) * Math.min(1, dt * 6);
    this.plumeUniforms.uTime.value = t;
    this.plume.visible = pu.value > 0.01;
    this.rcsMat.opacity += (Math.min(0.7, rcs) - this.rcsMat.opacity) * Math.min(1, dt * 15);
    this.navLights[0].visible = this.navLights[1].visible = true;
    this.navLights[2].visible = t % 1.5 < 0.08;
    this.navLights[3].visible = (t + 0.75) % 1.5 < 0.08;
    // отказы: антенна отломана, радиаторы погнуты
    this.antenna.rotation.z = failures.antenna ? 1.1 : 0;
    this.antenna.position.x = failures.antenna ? 2.5 : 0;
    this.radiators.forEach((r, i) => (r.rotation.z = failures.radiators ? (i ? 1 : -1) * 0.45 : 0));
    // пластическая деформация: растяжение (визуально ×40)
    const s = 1 + deform * 40;
    this.group.scale.set(1 / Math.sqrt(s), 1 / Math.sqrt(s), s);
    if (breakup > 0) {
      this.group.children.forEach((c, i) => {
        if (c.isLight) return;
        if (!c.userData.base) c.userData.base = c.position.clone();
        const dir = c.userData.base.z >= 0 ? 1 : -1;
        c.position.z = c.userData.base.z + dir * breakup * (8 + (i % 7) * 5);
        c.position.x = c.userData.base.x * (1 + 0.15 * breakup);
      });
      this.floods.forEach((f) => (f.intensity *= 0.95));
    }
  }
}
