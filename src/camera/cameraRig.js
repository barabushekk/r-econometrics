// Камеры: кабина (свободный обзор головой с инерцией), внешняя (облёт
// корабля), свободная (отдельный наблюдатель-зонд).
//
// Корабль ничтожно мал по сравнению с радиусом кривизны (74 м против
// ~6·10⁹ м для Sgr A*), поэтому внешняя камера в десятках метров от корпуса
// находится практически в той же точке пространства-времени: картина неба
// для неё та же, меняется только направление взгляда.

import * as THREE from 'three';

export class CameraRig {
  constructor(fov = 75) {
    this.camera = new THREE.PerspectiveCamera(fov, 16 / 9, 0.02, 3000);
    this.camera.rotation.order = 'YXZ';
    this.mode = 'cockpit';
    this.head = { yaw: 0, pitch: 0, tyaw: 0, tpitch: 0 };
    this.ext = { yaw: 0.75, pitch: 0.22, dist: 82, tyaw: 0.75, tpitch: 0.22, tdist: 82 };
    this.free = { yaw: 0, pitch: 0, tyaw: 0, tpitch: 0 };
    this.smoothing = 0.06;
    this.eye = new THREE.Vector3(0, 0, 0);
    this.shakeT = 0;
  }

  setFov(f) {
    this.camera.fov = f;
    this.camera.updateProjectionMatrix();
  }

  setAspect(a) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  resetLook() {
    this.head.tyaw = this.head.tpitch = 0;
  }

  /** Поворот корабля компенсирует обзор (режим «по взгляду»). */
  compensateShipRotation(dPitch, dYaw) {
    if (this.mode !== 'cockpit') return;
    this.head.tyaw -= dYaw;
    this.head.yaw -= dYaw;
    this.head.tpitch -= dPitch;
    this.head.pitch -= dPitch;
  }

  update(dt, input, { sensitivity = 1, invertY = false, vibration = 0 } = {}) {
    const k = 0.0022 * sensitivity;
    const dy = (invertY ? -1 : 1) * input.lookDY;
    const S = this.mode === 'cockpit' ? this.head : this.mode === 'external' ? this.ext : this.free;
    S.tyaw -= input.lookDX * k;
    S.tpitch -= dy * k;
    if (this.mode === 'cockpit') {
      S.tyaw = Math.max(-2.7, Math.min(2.7, S.tyaw));
      S.tpitch = Math.max(-1.45, Math.min(1.45, S.tpitch));
    } else {
      S.tpitch = Math.max(-1.5, Math.min(1.5, S.tpitch));
    }
    if (this.mode === 'external' && input.wheel) {
      this.ext.tdist = Math.max(45, Math.min(900, this.ext.tdist * Math.pow(1.12, input.wheel)));
    }
    const a = 1 - Math.exp(-dt / Math.max(this.smoothing, 1e-3));
    S.yaw += (S.tyaw - S.yaw) * a;
    S.pitch += (S.tpitch - S.pitch) * a;
    if (this.mode === 'external') this.ext.dist += (this.ext.tdist - this.ext.dist) * a;

    const cam = this.camera;
    this.shakeT += dt;
    const sh = vibration * vibration * 0.012;
    const jx = sh * (Math.sin(this.shakeT * 37.1) + 0.6 * Math.sin(this.shakeT * 91.7));
    const jy = sh * (Math.sin(this.shakeT * 41.3 + 1.3) + 0.6 * Math.sin(this.shakeT * 77.9));
    if (this.mode === 'cockpit') {
      cam.position.copy(this.eye);
      cam.rotation.set(S.pitch + jy, S.yaw + jx, 0);
    } else if (this.mode === 'external') {
      const target = new THREE.Vector3(0, 0, 4);
      const d = this.ext.dist;
      const cp = Math.cos(S.pitch);
      cam.position.set(target.x + d * Math.sin(S.yaw) * cp, target.y + d * Math.sin(S.pitch), target.z + d * Math.cos(S.yaw) * cp);
      cam.lookAt(target);
      cam.rotation.x += jy * 0.3;
    } else {
      cam.position.set(0, 0, 0);
      cam.rotation.set(S.pitch, S.yaw, 0);
    }
    cam.updateMatrixWorld();
  }

  /** Матрица поворота взгляда свободной камеры (для перемещения). */
  viewQuaternion() {
    return this.camera.quaternion;
  }
}
