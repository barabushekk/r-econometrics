// Процедурная кабина исследовательского корабля (оси корабля: X — вправо,
// Y — вверх, −Z — нос; глаз пилота в начале координат; единицы — метры).

import * as THREE from 'three';

function mat(color, metalness, roughness, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
}

function box(w, h, d, m, x, y, z, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  return mesh;
}

function tube(points, radius, m, segs = 48) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return new THREE.Mesh(new THREE.TubeGeometry(curve, segs, radius, 10, false), m);
}

// Процедурная текстура «шлифованного металла» с панельными швами
function panelTexture(seed = 1, size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#8a8f96';
  g.fillRect(0, 0, size, size);
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 2200; i++) {
    const y = rnd() * size;
    g.strokeStyle = `rgba(${rnd() > 0.5 ? 255 : 0},${rnd() > 0.5 ? 255 : 0},${rnd() > 0.5 ? 255 : 0},0.035)`;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(size, y + (rnd() - 0.5) * 4);
    g.stroke();
  }
  g.strokeStyle = 'rgba(20,22,26,0.85)';
  g.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const p = (i + 0.5) * (size / 4) + (rnd() - 0.5) * 20;
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, size);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(0, size * 0.5);
  g.lineTo(size, size * 0.5);
  g.stroke();
  g.fillStyle = 'rgba(30,30,34,0.9)';
  for (let i = 0; i < 40; i++) {
    g.beginPath();
    g.arc(rnd() * size, rnd() * size, 2.2, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
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
    this.interactive = {};
    this.build();
  }

  build() {
    const G = this.group;
    const tex = panelTexture(3);
    tex.repeat.set(2, 2);
    const hull = mat(0x8c939c, 0.85, 0.42, { map: tex });
    const dark = mat(0x1b1e23, 0.6, 0.55);
    const trim = mat(0xb8bec8, 1.0, 0.22);
    const rubber = mat(0x101113, 0.0, 0.9);
    const seatMat = mat(0x2a2f37, 0.1, 0.8);
    const accent = mat(0xc2481c, 0.4, 0.5);

    // пол
    G.add(box(2.6, 0.06, 3.4, mat(0x2b2f35, 0.7, 0.6, { map: tex }), 0, -1.16, 0.1));
    // приборная панель (наклонная) и корпус консоли
    G.add(box(2.4, 0.07, 0.62, dark, 0, -0.5, -0.98, -0.42));
    G.add(box(2.4, 0.5, 0.5, hull, 0, -0.86, -1.08));
    G.add(box(2.42, 0.04, 0.05, trim, 0, -0.39, -0.7));
    // козырёк над мониторами
    G.add(box(2.1, 0.03, 0.22, dark, 0, -0.27, -1.12, 0.25));

    // мониторы
    const mons = [
      { id: 'nav', x: -0.6, ry: 0.32 },
      { id: 'time', x: 0, ry: 0 },
      { id: 'struct', x: 0.6, ry: -0.32 },
    ];
    for (const m of mons) {
      const grp = new THREE.Group();
      grp.position.set(m.x, -0.44, -0.9 + Math.abs(m.x) * 0.25);
      grp.rotation.set(-0.42, m.ry, 0, 'YXZ');
      const bez = box(0.56, 0.36, 0.03, dark, 0, 0, -0.016);
      grp.add(bez);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.325), this.monitors.material(m.id));
      screen.position.z = 0.001;
      grp.add(screen);
      G.add(grp);
    }

    // боковые консоли
    for (const s of [-1, 1]) {
      G.add(box(0.42, 0.42, 1.4, hull, s * 0.82, -0.94, 0.15));
      G.add(box(0.38, 0.03, 1.3, dark, s * 0.8, -0.72, 0.15, 0, 0, s * 0.12));
      const small = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2), this.monitors.material(s < 0 ? 'aux' : 'disk'));
      small.position.set(s * 0.8, -0.7, -0.25);
      small.rotation.set(-Math.PI / 2 + 0.5, 0, 0);
      small.rotation.order = 'XYZ';
      small.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), s * 0.12);
      G.add(small);
    }

    // кнопки (InstancedMesh)
    const btnGeo = new THREE.BoxGeometry(0.022, 0.01, 0.022);
    const btnMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffffff, emissiveIntensity: 0.8, vertexColors: false, metalness: 0.2, roughness: 0.6 });
    const N = 120;
    this.buttons = new THREE.InstancedMesh(btnGeo, btnMat, N);
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    this.buttonPhase = [];
    for (let i = 0; i < N; i++) {
      let x, y, z;
      const group = i % 3;
      if (group === 0) {
        x = -0.95 + rnd() * 0.25 + (rnd() > 0.5 ? 1.65 : 0);
        y = -0.47 + rnd() * 0.06;
        z = -0.83 - rnd() * 0.25;
      } else if (group === 1) {
        const side = rnd() > 0.5 ? 1 : -1;
        x = side * (0.72 + rnd() * 0.15);
        y = -0.705;
        z = 0.0 + rnd() * 0.75;
      } else {
        x = -0.45 + rnd() * 0.9;
        y = 1.0;
        z = 0.05 + rnd() * 0.7;
      }
      m4.makeTranslation(x, y, z);
      this.buttons.setMatrixAt(i, m4);
      const hue = [0.33, 0.08, 0.55, 0.0, 0.15][Math.floor(rnd() * 5)];
      col.setHSL(hue, 0.9, 0.5);
      this.buttons.setColorAt(i, col);
      this.buttonPhase.push(rnd());
    }
    G.add(this.buttons);

    // рама фонаря: стойки и дуги
    const L = [
      [-1.08, -0.38, -1.22],
      [-1.0, 0.2, -0.95],
      [-0.82, 0.8, -0.5],
      [-0.7, 1.02, -0.2],
    ];
    const R = L.map(([x, y, z]) => [-x, y, z]);
    G.add(tube(L, 0.055, trim));
    G.add(tube(R, 0.055, trim));
    G.add(
      tube(
        [
          [-0.7, 1.02, -0.2],
          [0, 1.08, -0.26],
          [0.7, 1.02, -0.2],
        ],
        0.05,
        trim,
      ),
    );
    G.add(
      tube(
        [
          [-1.08, -0.38, -1.22],
          [0, -0.36, -1.34],
          [1.08, -0.38, -1.22],
        ],
        0.045,
        trim,
      ),
    );
    // внутренние уплотнители
    G.add(tube(L.map(([x, y, z]) => [x * 0.97, y, z + 0.03]), 0.022, rubber));
    G.add(tube(R.map(([x, y, z]) => [x * 0.97, y, z + 0.03]), 0.022, rubber));

    // стекло (параметрическая поверхность между нижним и верхним обводами)
    const lowerC = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-1.08, -0.38, -1.22),
      new THREE.Vector3(0, -0.36, -1.34),
      new THREE.Vector3(1.08, -0.38, -1.22),
    ]);
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
        // интерполяция Кунса по четырём обводам
        const lo = lowerC.getPoint(u);
        const up = upperC.getPoint(u);
        const p = new THREE.Vector3()
          .copy(lo)
          .multiplyScalar(1 - v)
          .addScaledVector(up, v)
          .addScaledVector(pl, 1 - u)
          .addScaledVector(pr, u);
        tmp.copy(lowerC.getPoint(0)).multiplyScalar((1 - u) * (1 - v));
        p.sub(tmp);
        tmp.copy(lowerC.getPoint(1)).multiplyScalar(u * (1 - v));
        p.sub(tmp);
        tmp.copy(upperC.getPoint(0)).multiplyScalar((1 - u) * v);
        p.sub(tmp);
        tmp.copy(upperC.getPoint(1)).multiplyScalar(u * v);
        p.sub(tmp);
        // лёгкая выпуклость наружу
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
      new THREE.ShaderMaterial({
        vertexShader: GLASS_VERT,
        fragmentShader: GLASS_FRAG,
        uniforms: this.glassUniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    glass.renderOrder = 10;
    G.add(glass);

    // боковые стенки с иллюминаторами (рамы вокруг проёма)
    for (const s of [-1, 1]) {
      const x = s * 1.22;
      G.add(box(0.08, 0.95, 1.9, hull, x, -0.68, 0.55));
      G.add(box(0.08, 0.5, 1.9, hull, x, 0.86, 0.55));
      G.add(box(0.08, 0.6, 0.55, hull, x, 0.0, 1.22));
      G.add(box(0.08, 0.6, 0.35, hull, x, 0.0, -0.2));
      const fr = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.035, 10, 32), trim);
      fr.position.set(x - s * 0.02, 0.02, 0.45);
      fr.rotation.y = Math.PI / 2;
      fr.scale.set(1, 0.9, 1.25);
      G.add(fr);
      // промежуток между стойкой фонаря и стенкой
      G.add(box(0.06, 1.5, 0.5, hull, s * 1.12, 0.25, -0.62, 0, s * 0.2, 0));
    }
    // потолок
    G.add(box(2.5, 0.08, 1.9, hull, 0, 1.12, 0.55));
    G.add(box(1.3, 0.1, 0.95, dark, 0, 1.03, 0.4));
    // светильники на потолке
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xcfe6ff, emissiveIntensity: 1.2 });
    for (const x of [-0.5, 0.5]) G.add(box(0.5, 0.015, 0.06, lampMat, x, 1.075, 1.05));
    // задняя стена с люком
    G.add(box(2.5, 2.3, 0.1, hull, 0, -0.05, 1.5));
    const hatch = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 12, 40), trim);
    hatch.position.set(0, -0.25, 1.44);
    G.add(hatch);
    G.add(box(0.7, 0.75, 0.04, dark, 0, -0.25, 1.45));
    G.add(box(0.5, 0.05, 0.06, accent, 0, -0.25, 1.42));

    // кресло пилота
    G.add(box(0.62, 0.12, 0.6, seatMat, 0, -0.72, 0.3));
    const back = box(0.62, 0.95, 0.12, seatMat, 0, -0.2, 0.68, -0.18);
    G.add(back);
    G.add(box(0.5, 0.3, 0.12, seatMat, 0, 0.42, 0.78, -0.18));
    for (const s of [-1, 1]) G.add(box(0.09, 0.08, 0.55, seatMat, s * 0.36, -0.55, 0.25));
    G.add(box(0.12, 0.45, 0.12, dark, 0, -0.98, 0.32));

    // ручки управления: слева РУД (тяга), справа джойстик (ориентация)
    this.throttle = new THREE.Group();
    this.throttle.position.set(-0.46, -0.5, 0.05);
    this.throttle.add(box(0.03, 0.18, 0.03, dark, 0, 0.09, 0));
    this.throttle.add(box(0.07, 0.05, 0.09, accent, 0, 0.19, 0));
    G.add(this.throttle);
    this.stick = new THREE.Group();
    this.stick.position.set(0.46, -0.5, 0.05);
    this.stick.add(box(0.03, 0.2, 0.03, dark, 0, 0.1, 0));
    this.stick.add(box(0.05, 0.08, 0.05, rubber, 0, 0.22, 0));
    G.add(this.stick);

    // световая аварийная полоса над панелью
    this.alertMat = new THREE.MeshStandardMaterial({ color: 0x110000, emissive: 0xff1a00, emissiveIntensity: 0 });
    G.add(box(2.0, 0.012, 0.02, this.alertMat, 0, -0.395, -0.69));

    // освещение кабины
    this.cabinLight = new THREE.PointLight(0xd8e8ff, 1.2, 5, 1.6);
    this.cabinLight.position.set(0, 0.95, 0.6);
    G.add(this.cabinLight);
    this.screenLight = new THREE.PointLight(0x6fb6ff, 0.35, 2.5, 2);
    this.screenLight.position.set(0, -0.3, -0.7);
    G.add(this.screenLight);
    this.alertLight = new THREE.PointLight(0xff2200, 0, 6, 1.5);
    this.alertLight.position.set(0, 0.6, 0.9);
    G.add(this.alertLight);
  }

  update(dt, t, { thrust = [0, 0, 0], rot = [0, 0, 0], alert = 0, damage = 0, extColor, extDir, failures = 0 }) {
    // РУД — по продольной тяге, джойстик — по командам ориентации
    this.throttle.rotation.x = 0.5 * thrust[2];
    this.throttle.rotation.z = -0.3 * thrust[0];
    this.stick.rotation.x = -0.35 * Math.sign(rot[0]) * Math.min(1, Math.abs(rot[0]) * 3);
    this.stick.rotation.z = 0.35 * Math.sign(rot[1]) * Math.min(1, Math.abs(rot[1]) * 3);
    this.stick.rotation.y = 0.3 * Math.sign(rot[2]) * Math.min(1, Math.abs(rot[2]) * 3);
    const blink = alert > 0 ? 0.5 + 0.5 * Math.sin(t * 9) : 0;
    this.alertMat.emissiveIntensity = alert * (0.3 + 2.5 * blink);
    this.alertLight.intensity = alert * 1.6 * blink;
    // мерцание кнопок; часть гаснет при отказах систем
    if (this.buttons && Math.floor(t * 4) !== this._lastBlink) {
      this._lastBlink = Math.floor(t * 4);
      const col = new THREE.Color();
      for (let i = 0; i < this.buttonPhase.length; i++) {
        const ph = this.buttonPhase[i];
        const dead = failures > 0 && ph < failures * 0.15;
        const on = !dead && (ph > 0.25 || Math.sin(t * (2 + ph * 6) + ph * 20) > 0);
        const hue = [0.33, 0.08, 0.55, 0.0, 0.15][Math.floor(ph * 5)];
        col.setHSL(hue, 0.9, on ? 0.5 : 0.04);
        this.buttons.setColorAt(i, col);
      }
      this.buttons.instanceColor.needsUpdate = true;
    }
    this.glassUniforms.uDamage.value = damage;
    this.glassUniforms.uTime.value = t;
    if (extColor) this.glassUniforms.uExtColor.value.copy(extColor);
    if (extDir) this.glassUniforms.uExtDir.value.copy(extDir);
  }
}
