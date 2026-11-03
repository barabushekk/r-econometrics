// Конвейер рендеринга:
//  1. трассировка лучей (динамическое разрешение)  → hdr
//  2. временное накопление (если камера неподвижна) → hdr
//  3. измерение яркости (mip-цепочка) и адаптация экспозиции (на GPU)
//  4. оптическое рассеяние (bloom) — эффект глаза/оптики, не физика ЧД
//  5. тональная компрессия / ложные цвета                → view (LDR)
//  6. сцена кабины/корабля поверх фона                   → scene
//  7. вывод на экран (sRGB)

import * as THREE from 'three';
import { FULLSCREEN_VERT } from './shaders/common.js';
import { raytraceFrag } from './shaders/raytrace.js';
import { skyFrag, SKY_SCALE } from './shaders/sky.js';
import { ACCUM_FRAG, LUM_FRAG, EXPOSURE_FRAG, DOWN_FRAG, UP_FRAG, TONEMAP_FRAG, OUTPUT_FRAG, PROBE_FRAG, BACKGROUND_FRAG } from './shaders/post.js';
import { buildSpectrumLUT, SPECTRUM_LUT } from '../physics/spectrum.js';
import { DISK_LUT_SIZE } from '../physics/disk.js';

function fsMaterial(frag, uniforms) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: frag,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
}

function makeRT(w, h, opts = {}) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
    ...opts,
  });
}

export class RenderPipeline {
  constructor(renderer, quality) {
    this.renderer = renderer;
    this.quality = quality;
    this.width = 1;
    this.height = 1;
    this.resScale = quality.resStart;
    this.frame = 0;
    this.accumCount = 0;
    this.probe = new Uint8Array(4 * 16);
    this.probeReady = false;

    // полноэкранный треугольник
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new THREE.Mesh(geo);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // спектральная таблица
    const spec = buildSpectrumLUT();
    this.specTex = new THREE.DataTexture(spec, SPECTRUM_LUT.size, 2, THREE.RGBAFormat, THREE.FloatType);
    this.specTex.minFilter = this.specTex.magFilter = THREE.NearestFilter;
    this.specTex.needsUpdate = true;

    this.diskData = new Float32Array(DISK_LUT_SIZE);
    this.diskTex = new THREE.DataTexture(this.diskData, DISK_LUT_SIZE, 1, THREE.RedFormat, THREE.FloatType);
    this.diskTex.minFilter = this.diskTex.magFilter = THREE.NearestFilter;
    this.diskTex.needsUpdate = true;

    this.expA = makeRT(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.expB = makeRT(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.lumRT = makeRT(256, 256, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.probeRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.UnsignedByteType, depthBuffer: false });

    this.buildMaterials();
    this.buildSky(quality.skySize);
    this.resetExposure = true;
  }

  buildMaterials() {
    const q = this.quality;
    this.rtUniforms = {
      uRes: { value: new THREE.Vector2(1, 1) },
      uJitter: { value: new THREE.Vector2(0, 0) },
      uProjInv: { value: new THREE.Matrix4() },
      uCamRot: { value: new THREE.Matrix3() },
      uCamPos: { value: new THREE.Vector3() },
      uU: { value: new THREE.Vector4() },
      uE1: { value: new THREE.Vector4() },
      uE2: { value: new THREE.Vector4() },
      uE3: { value: new THREE.Vector4() },
      uSpin: { value: 0 },
      uRPlus: { value: 2 },
      uEscapeR: { value: 100 },
      uStepScale: { value: q.stepScale },
      uMaxSteps: { value: q.maxSteps },
      uBand: { value: 0 },
      uDiskOn: { value: 1 },
      uRin: { value: 6 },
      uRout: { value: 30 },
      uSqrtRin: { value: Math.sqrt(6) },
      uSqrtRout: { value: Math.sqrt(30) },
      uHr: { value: 0.03 },
      uTau0: { value: 5 },
      uTurb: { value: 0.5 },
      uDiskTime: { value: 0 },
      uDiskLUT: { value: this.diskTex },
      uSky: { value: null },
      uSkyScale: { value: 1 / SKY_SCALE },
      uSkyOn: { value: 1 },
      uSkyGrid: { value: 0 },
      uDebugFlatSky: { value: 0 },
      uExposure: { value: this.expA.texture },
      uSpec: { value: this.specTex },
    };
    if (this.rtMat) this.rtMat.dispose();
    this.rtMat = fsMaterial(raytraceFrag({ maxSteps: q.maxSteps, noiseOctaves: q.noiseOctaves }), this.rtUniforms);
    this.accumMat = fsMaterial(ACCUM_FRAG, { uCur: { value: null }, uPrev: { value: null }, uAlpha: { value: 1 } });
    this.lumMat = fsMaterial(LUM_FRAG, { uHdr: { value: null }, uBand: { value: 0 } });
    this.expMat = fsMaterial(EXPOSURE_FRAG, {
      uLum: { value: this.lumRT.texture },
      uPrevExp: { value: null },
      uLodMax: { value: 8 },
      uMode: { value: 0 },
      uEV: { value: 0 },
      uManual: { value: 30 },
      uRate: { value: 0.05 },
      uReset: { value: 1 },
    });
    this.downMat = fsMaterial(DOWN_FRAG, { uSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uCap: { value: 6e4 } });
    this.upMat = fsMaterial(UP_FRAG, { uSrc: { value: null }, uBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uMix: { value: 0.65 } });
    this.toneMat = fsMaterial(TONEMAP_FRAG, {
      uHdr: { value: null },
      uBloom: { value: null },
      uExposure: { value: null },
      uPrevExposure: { value: null },
      uBloomI: { value: 0.035 },
      uBand: { value: 0 },
      uVignette: { value: 0.25 },
      uBlackout: { value: 0 },
      uTime: { value: 0 },
    });
    this.outMat = fsMaterial(OUTPUT_FRAG, { uSrc: { value: null }, uFlash: { value: 0 }, uFlashColor: { value: new THREE.Color(1, 0, 0) } });
    this.probeMat = fsMaterial(PROBE_FRAG, { uSrc: { value: null } });
    this.bgMaterial = fsMaterial(BACKGROUND_FRAG, { uView: { value: null } });
  }

  buildSky(size) {
    if (this.skyRT) this.skyRT.dispose();
    this.skyRT = new THREE.WebGLCubeRenderTarget(size, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });
    // Галактический полюс наклонён к оси вращения ЧД (ориентация произвольна)
    const pole = new THREE.Vector3(0.35, -0.5, 0.79).normalize();
    const mat = fsMaterial(skyFrag(), {
      uFace: { value: 0 },
      uSize: { value: size },
      uGalPole: { value: pole },
      uSpec: { value: this.specTex },
    });
    const r = this.renderer;
    const prev = r.getRenderTarget();
    for (let face = 0; face < 6; face++) {
      mat.uniforms.uFace.value = face;
      this.skyRT.texture.generateMipmaps = face === 5;
      this.drawTo(mat, this.skyRT, face);
    }
    r.setRenderTarget(prev);
    mat.dispose();
    this.rtUniforms.uSky.value = this.skyRT.texture;
  }

  setQuality(q) {
    const rebuildSky = q.skySize !== this.quality.skySize;
    this.quality = q;
    this.resScale = Math.min(Math.max(this.resScale, q.resMin), q.resMax);
    this.buildMaterials();
    if (rebuildSky) this.buildSky(q.skySize);
    else this.rtUniforms.uSky.value = this.skyRT.texture;
    this.allocate();
    this.accumCount = 0;
  }

  drawTo(mat, target, face = 0) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target, face);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  resize(w, h) {
    this.width = Math.max(1, Math.floor(w));
    this.height = Math.max(1, Math.floor(h));
    this.allocate();
  }

  allocate() {
    const W = this.width;
    const H = this.height;
    const hw = Math.max(16, Math.round(W * this.resScale));
    const hh = Math.max(16, Math.round(H * this.resScale));
    if (!this.hdrA || this.hdrA.width !== hw || this.hdrA.height !== hh) {
      for (const k of ['hdrA', 'hdrB', 'hdrCur']) if (this[k]) this[k].dispose();
      this.hdrCur = makeRT(hw, hh);
      this.hdrA = makeRT(hw, hh);
      this.hdrB = makeRT(hw, hh);
      if (this.bloomLevels) this.bloomLevels.forEach((l) => l.dispose());
      if (this.bloomUp) this.bloomUp.forEach((l) => l.dispose());
      this.bloomLevels = [];
      this.bloomUp = [];
      let bw = hw;
      let bh = hh;
      for (let i = 0; i < 6; i++) {
        bw = Math.max(2, bw >> 1);
        bh = Math.max(2, bh >> 1);
        this.bloomLevels.push(makeRT(bw, bh));
        this.bloomUp.push(makeRT(bw, bh));
      }
      this.accumCount = 0;
    }
    const msaa = this.quality.msaa;
    if (!this.viewRT || this.viewRT.width !== W || this.viewRT.height !== H || this.sceneRT.samples !== msaa) {
      if (this.viewRT) this.viewRT.dispose();
      if (this.sceneRT) this.sceneRT.dispose();
      this.viewRT = makeRT(W, H);
      this.sceneRT = makeRT(W, H, { depthBuffer: true, samples: msaa });
    }
  }

  /** Адаптивное разрешение по времени кадра (мс). */
  adaptResolution(frameMs, enabled = true) {
    if (!enabled) return;
    this._ftAvg = this._ftAvg === undefined ? frameMs : this._ftAvg * 0.92 + frameMs * 0.08;
    this._resTimer = (this._resTimer || 0) + frameMs;
    if (this._resTimer < 700) return;
    this._resTimer = 0;
    const q = this.quality;
    let s = this.resScale;
    if (this._ftAvg > 19.5) s *= Math.max(0.75, Math.sqrt(16.7 / this._ftAvg));
    else if (this._ftAvg < 17.4) s *= 1.06;
    s = Math.min(q.resMax, Math.max(q.resMin, s));
    if (Math.abs(s - this.resScale) > 0.025) {
      this.resScale = s;
      this.allocate();
    }
  }

  setDisk(profile, params) {
    this.diskData.set(profile.lut);
    this.diskTex.needsUpdate = true;
    const u = this.rtUniforms;
    u.uRin.value = profile.rIn;
    u.uRout.value = profile.rOut;
    u.uSqrtRin.value = Math.sqrt(profile.rIn);
    u.uSqrtRout.value = Math.sqrt(profile.rOut);
    u.uHr.value = params.hr;
    u.uTau0.value = params.tau0;
    u.uTurb.value = params.turbulence;
    u.uDiskOn.value = params.enabled && profile.Tmax > 0 ? 1 : 0;
    u.uEscapeR.value = Math.max(80, profile.rOut * 2.2);
  }

  /**
   * Кадр. view = { camera (THREE.PerspectiveCamera в осях корабля),
   *   camPos [x,y,z], U,E1,E2,E3 (ковекторы [t,x,y,z]), spin, rPlus,
   *   diskTime, band, exposureMode, ev, bloom, moved (bool), dt (с) }.
   * renderScene(target) рисует кабину/корабль поверх фона (опционально).
   */
  render(view, renderScene) {
    const r = this.renderer;
    const u = this.rtUniforms;
    const hdrW = this.hdrCur.width;
    const hdrH = this.hdrCur.height;
    const cam = view.camera;
    cam.updateMatrixWorld();
    u.uRes.value.set(hdrW, hdrH);
    u.uProjInv.value.copy(cam.projectionMatrixInverse);
    u.uCamRot.value.setFromMatrix4(cam.matrixWorld);
    u.uCamPos.value.set(view.camPos[0], view.camPos[1], view.camPos[2]);
    u.uU.value.fromArray(view.U);
    u.uE1.value.fromArray(view.E1);
    u.uE2.value.fromArray(view.E2);
    u.uE3.value.fromArray(view.E3);
    u.uSpin.value = view.spin;
    u.uRPlus.value = view.rPlus;
    u.uDiskTime.value = view.diskTime;
    u.uBand.value = view.band;
    u.uSkyGrid.value = view.skyGrid ? 1 : 0;

    const accumulate = this.quality.accumulate && !view.moved;
    if (!accumulate || view.band !== this._lastBand) this.accumCount = 0;
    this._lastBand = view.band;
    if (accumulate && this.accumCount > 0) {
      // субпиксельный сдвиг (последовательность Халтона 2,3)
      const k = (this.accumCount % 64) + 1;
      u.uJitter.value.set(halton(k, 2) - 0.5, halton(k, 3) - 0.5);
    } else u.uJitter.value.set(0, 0);

    const expRead = this.expA;
    const expWrite = this.expB;
    u.uExposure.value = expRead.texture;
    this.drawTo(this.rtMat, this.hdrCur);

    let hdr = this.hdrCur;
    if (accumulate) {
      this.accumCount++;
      const alpha = Math.max(1 / this.accumCount, 0.04);
      this.accumMat.uniforms.uCur.value = this.hdrCur.texture;
      this.accumMat.uniforms.uPrev.value = this.hdrA.texture;
      this.accumMat.uniforms.uAlpha.value = alpha;
      this.drawTo(this.accumMat, this.hdrB);
      [this.hdrA, this.hdrB] = [this.hdrB, this.hdrA];
      hdr = this.hdrA;
    }

    // экспозиция
    this.lumMat.uniforms.uHdr.value = hdr.texture;
    this.lumMat.uniforms.uBand.value = view.band;
    this.drawTo(this.lumMat, this.lumRT);
    const em = this.expMat.uniforms;
    em.uPrevExp.value = expRead.texture;
    em.uMode.value = view.exposureMode;
    em.uEV.value = view.ev;
    em.uManual.value = view.manualLogE ?? 30;
    em.uRate.value = 1 - Math.exp(-(view.dt || 0.016) / 0.45);
    em.uReset.value = this.resetExposure ? 1 : 0;
    this.drawTo(this.expMat, expWrite);
    this.resetExposure = false;

    // bloom
    let bloomTex = hdr.texture;
    if (this.quality.bloom && view.bloom > 0) {
      let src = hdr;
      for (const lvl of this.bloomLevels) {
        // ограничение яркости, питающей ореол (упрощение модели рассеяния в глазу)
        this.downMat.uniforms.uCap.value = src === hdr ? 40 : 6e4;
        this.downMat.uniforms.uSrc.value = src.texture;
        this.downMat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
        this.drawTo(this.downMat, lvl);
        src = lvl;
      }
      let up = this.bloomLevels[this.bloomLevels.length - 1];
      for (let i = this.bloomLevels.length - 2; i >= 0; i--) {
        this.upMat.uniforms.uSrc.value = up.texture;
        this.upMat.uniforms.uBase.value = this.bloomLevels[i].texture;
        this.upMat.uniforms.uTexel.value.set(1 / up.width, 1 / up.height);
        this.drawTo(this.upMat, this.bloomUp[i]);
        up = this.bloomUp[i];
      }
      bloomTex = up.texture;
    }

    const tm = this.toneMat.uniforms;
    tm.uHdr.value = hdr.texture;
    tm.uBloom.value = bloomTex;
    tm.uBloomI.value = this.quality.bloom ? view.bloom : 0;
    tm.uExposure.value = expWrite.texture;
    tm.uPrevExposure.value = expRead.texture;
    tm.uBand.value = view.band;
    tm.uBlackout.value = view.blackout || 0;
    this.drawTo(this.toneMat, this.viewRT);

    // пробник освещённости для кабины: асинхронное чтение 4×4 через PBO
    // (без остановки конвейера GPU)
    this.pollProbe();
    if (this.frame % 8 === 0 && !this._fence) {
      this.probeMat.uniforms.uSrc.value = this.viewRT.texture;
      this.drawTo(this.probeMat, this.probeRT);
      this.requestProbe();
    }

    // сцена кабины
    let final = this.viewRT;
    if (renderScene) {
      this.bgMaterial.uniforms.uView.value = this.viewRT.texture;
      r.setRenderTarget(this.sceneRT);
      r.clear(true, true, false);
      this.quad.material = this.bgMaterial;
      r.render(this.quadScene, this.quadCam);
      renderScene(this.sceneRT);
      final = this.sceneRT;
    }

    this.outMat.uniforms.uSrc.value = final.texture;
    this.outMat.uniforms.uFlash.value = view.flash || 0;
    if (view.flashColor) this.outMat.uniforms.uFlashColor.value.copy(view.flashColor);
    this.drawTo(this.outMat, null);

    // обмен буферов экспозиции
    this.expA = expWrite;
    this.expB = expRead;
    this.frame++;
  }
}

RenderPipeline.prototype.requestProbe = function () {
  const gl = this.renderer.getContext();
  if (!this._pbo) {
    this._pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this._pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, 64, gl.STREAM_READ);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  }
  this.renderer.setRenderTarget(this.probeRT);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this._pbo);
  gl.readPixels(0, 0, 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, 0);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  this._fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
};

RenderPipeline.prototype.pollProbe = function () {
  if (!this._fence) return;
  const gl = this.renderer.getContext();
  const st = gl.clientWaitSync(this._fence, 0, 0);
  if (st === gl.TIMEOUT_EXPIRED) return;
  gl.deleteSync(this._fence);
  this._fence = null;
  if (st === gl.WAIT_FAILED) return;
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this._pbo);
  gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.probe);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  this.probeReady = true;
};

function halton(i, b) {
  let f = 1;
  let r = 0;
  while (i > 0) {
    f /= b;
    r += f * (i % b);
    i = Math.floor(i / b);
  }
  return r;
}
