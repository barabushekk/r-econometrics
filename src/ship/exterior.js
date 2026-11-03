// Внешняя модель корабля (74 м): фюзеляж, фонарь кабины, радиаторы,
// антенна, двигатели с факелом, огни. Деформация при пластическом
// течении показывается визуально усиленной (подпись в интерфейсе).

import * as THREE from 'three';

const PLUME_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const PLUME_FRAG = /* glsl */ `
uniform float uThrust;
uniform float uTime;
varying vec2 vUv;
void main() {
  float a = (1.0 - vUv.y);
  float flick = 0.85 + 0.15 * sin(uTime * 60.0 + vUv.y * 40.0);
  vec3 c = mix(vec3(0.5, 0.7, 1.0), vec3(1.0, 0.85, 0.6), vUv.y);
  gl_FragColor = vec4(c * a * a * uThrust * flick * 2.0, 1.0);
}`;

export class ShipExterior {
  constructor() {
    this.group = new THREE.Group();
    this.parts = [];
    this.build();
  }

  build() {
    const G = this.group;
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.75, roughness: 0.35, side: THREE.DoubleSide });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2e35, metalness: 0.6, roughness: 0.5 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xc8a050, metalness: 1.0, roughness: 0.3 });
    const radMat = new THREE.MeshStandardMaterial({ color: 0x3a4450, metalness: 0.3, roughness: 0.7, emissive: 0x220a00, emissiveIntensity: 0.4 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x0a1420, metalness: 0.9, roughness: 0.05, transparent: true, opacity: 0.8 });

    // фюзеляж: тело вращения вдоль Z (нос в −Z)
    const prof = [
      [0.01, -37],
      [2.2, -35.5],
      [3.6, -32],
      [4.3, -26],
      [4.6, -14],
      [4.2, -6],
      [5.4, 0],
      [5.4, 14],
      [4.4, 22],
      [4.6, 30],
      [3.0, 34],
    ].map(([r, z]) => new THREE.Vector2(r, z));
    const lathe = new THREE.LatheGeometry(prof, 48);
    lathe.rotateX(Math.PI / 2); // ось вращения Y → Z, нос в −Z
    const body = new THREE.Mesh(lathe, hullMat);
    G.add(body);
    this.body = body;

    // фонарь кабины
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(2.6, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), glassMat);
    canopy.scale.set(1.0, 0.55, 1.6);
    canopy.position.set(0, 2.9, -27.5);
    G.add(canopy);

    // кольцо жилого модуля
    const ring = new THREE.Mesh(new THREE.TorusGeometry(8, 1.1, 16, 64), hullMat);
    ring.position.z = 6;
    G.add(ring);
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 8, 8), darkMat);
      sp.rotation.z = (i * Math.PI) / 2;
      sp.position.z = 6;
      G.add(sp);
    }

    // радиаторы
    this.radiators = [];
    for (const s of [-1, 1]) {
      const rad = new THREE.Mesh(new THREE.BoxGeometry(13, 0.2, 9), radMat);
      rad.position.set(s * 11.5, 0, 20);
      G.add(rad);
      this.radiators.push(rad);
      const strut = new THREE.Mesh(new THREE.BoxGeometry(5, 0.5, 0.8), darkMat);
      strut.position.set(s * 6.8, 0, 20);
      G.add(strut);
    }

    // антенна на штанге
    this.antenna = new THREE.Group();
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 14, 8), darkMat);
    boom.position.y = 7;
    this.antenna.add(boom);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(3.2, 24, 8, 0, Math.PI * 2, 0, 0.7), goldMat);
    dish.position.y = 14;
    dish.rotation.x = Math.PI;
    this.antenna.add(dish);
    this.antenna.position.set(0, 4.5, -4);
    this.antenna.rotation.x = -0.4;
    G.add(this.antenna);

    // двигатели
    this.plumes = [];
    this.plumeUniforms = { uThrust: { value: 0 }, uTime: { value: 0 } };
    const plumeMat = new THREE.ShaderMaterial({
      vertexShader: PLUME_VERT,
      fragmentShader: PLUME_FRAG,
      uniforms: this.plumeUniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const offs = [
      [-2.6, -2.6],
      [2.6, -2.6],
      [-2.6, 2.6],
      [2.6, 2.6],
    ];
    for (const [x, y] of offs) {
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 2.0, 4.5, 24, 1, true), darkMat);
      bell.rotation.x = Math.PI / 2;
      bell.position.set(x, y, 36);
      G.add(bell);
      const pl = new THREE.Mesh(new THREE.ConeGeometry(1.9, 26, 24, 1, true), plumeMat);
      pl.rotation.x = -Math.PI / 2;
      pl.position.set(x, y, 51.5);
      G.add(pl);
      this.plumes.push(pl);
    }

    // огни
    this.navLights = [];
    const mk = (color, x, y, z) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), new THREE.MeshBasicMaterial({ color }));
      m.position.set(x, y, z);
      G.add(m);
      this.navLights.push(m);
    };
    mk(0xff2020, -18, 0, 20);
    mk(0x20ff40, 18, 0, 20);
    mk(0xffffff, 0, -4.8, 30);

    // освещение внешним светом (направление и цвет — по изображению неба)
    this.keyLight = new THREE.DirectionalLight(0xffffff, 0);
    this.keyLight.position.set(0, 0, -1);
    G.add(this.keyLight);
    G.add(this.keyLight.target);
    this.fill = new THREE.HemisphereLight(0x223344, 0x000000, 0.15);
    G.add(this.fill);

    this.basePositions = lathe.attributes.position.array.slice();
  }

  update(dt, t, { thrust = 0, deform = 0, failures = {}, tidalAxis = null, breakup = 0 }) {
    this.plumeUniforms.uThrust.value += (Math.min(1.5, thrust) - this.plumeUniforms.uThrust.value) * Math.min(1, dt * 8);
    this.plumeUniforms.uTime.value = t;
    for (const p of this.plumes) p.visible = this.plumeUniforms.uThrust.value > 0.01;
    const blink = Math.sin(t * 4) > 0.6;
    this.navLights.forEach((m, i) => (m.visible = i < 2 ? blink : Math.sin(t * 2 + 1) > 0.9));
    // отказавшие элементы: антенна и радиаторы отрываются/гнутся
    this.antenna.rotation.z = failures.antenna ? 0.9 : 0;
    this.antenna.position.x = failures.antenna ? 3 : 0;
    this.radiators.forEach((r, i) => (r.rotation.z = failures.radiators ? (i ? 1 : -1) * 0.5 : 0));
    // пластическая деформация: растяжение вдоль приливной оси (визуально ×40)
    const s = 1 + deform * 40;
    this.body.scale.set(1 / Math.sqrt(s), 1 / Math.sqrt(s), s);
    // разрушение: разлёт фрагментов (схематично, по оси растяжения)
    if (breakup > 0) {
      this.group.children.forEach((c, i) => {
        if (c.isLight) return;
        if (!c.userData.base) c.userData.base = c.position.clone();
        const dir = c.userData.base.z >= 0 ? 1 : -1;
        c.position.z = c.userData.base.z + dir * breakup * (10 + (i % 7) * 6);
        c.position.x = c.userData.base.x * (1 + 0.1 * breakup);
      });
    }
  }
}
