// Модель конструкции корабля и экипажа: напряжения от приливных сил и тяги,
// пластическая деформация, отказ систем, разрушение.
//
// Приливная нагрузка: корпус — однородная балка длины L и средней
// плотности ρ, растягиваемая приливным полем d²ξ/dτ² = λ ξ. Максимальное
// растягивающее напряжение в середине балки σ = ρ λ L² / 8.
// Тяга: инерционная нагрузка опоры двигателей σ = ρ a L / 2.
// Пороговые значения — порядок величин для титановых сплавов (Ti-6Al-4V:
// предел текучести ≈ 880 МПа, предел прочности ≈ 950–1100 МПа).
// Экипаж: перепад ускорений между головой и ногами Δa = λ·h (h = 1.8 м);
// травмы ~5 g, смерть ~20 g; длительная перегрузка от тяги: 6 g / 15 g.
//
// Момент разрушения определяется ТОЛЬКО вычисленной нагрузкой: для
// Sgr A* (4·10⁶ M☉) приливы на горизонте ≈ 10⁻⁴ g на длину корабля, и
// разрушение происходит лишь глубоко под горизонтом (r ~ 0.05–0.1 M).

import { G0 } from '../physics/units.js';

export const SHIP_SPEC = {
  name: 'ИК «Горизонт»',
  length: 74, // м, вдоль продольной оси (Z)
  span: 22, // м, поперечный размер
  density: 2000, // кг/м³, эффективная плотность нагруженных узлов (баки, реактор на фермах)
  yield: 880e6, // Па
  ultimate: 1050e6, // Па
  crewHeight: 1.8, // м
};

// Системы: порог в долях предела прочности корпуса (длинные тонкие
// конструкции — антенна, радиаторы — отказывают раньше).
export const SYSTEMS = [
  { id: 'antenna', name: 'Антенна дальней связи', threshold: 0.32, lengthFactor: 0.55 },
  { id: 'radiators', name: 'Радиаторы', threshold: 0.45, lengthFactor: 0.4 },
  { id: 'sensors', name: 'Внешние датчики', threshold: 0.6, lengthFactor: 0.3 },
  { id: 'nav', name: 'Навигационный комплекс', threshold: 0.8, lengthFactor: 0.2 },
  { id: 'engines', name: 'Двигательная установка', threshold: 0.9, lengthFactor: 0.25 },
  { id: 'life', name: 'Система жизнеобеспечения', threshold: 0.95, lengthFactor: 0.2 },
];

export class ShipStructure {
  constructor(spec = SHIP_SPEC) {
    this.spec = spec;
    this.reset();
  }

  reset() {
    this.stress = 0; // Па
    this.stressFrac = 0; // σ / σ_ult
    this.maxStressFrac = 0;
    this.plasticStrain = 0; // условная пластическая деформация (доли)
    this.integrity = 1;
    this.destroyed = false;
    this.crew = 'норма';
    this.crewLevel = 0; // 0 норма, 1 дискомфорт, 2 травмы, 3 гибель
    this.systems = SYSTEMS.map((s) => ({ ...s, ok: true, failedAt: null }));
    this.tidalAcrossShipG = 0;
    this.tidalAcrossBodyG = 0;
    this.vibration = 0;
    this.events = [];
  }

  /**
   * @param {number} lambdaMax  наибольшее растягивающее собственное значение (1/с²) — модуль
   * @param {number} lambdaComp наибольшее сжимающее (1/с²) — модуль
   * @param {number} thrustSI   собственное ускорение от тяги, м/с²
   * @param {boolean} inertialComp — гипотетическая компенсация инерции (нефизично)
   * @param {number} dt реальное время кадра, с (для сглаживания вибраций)
   */
  update(lambdaMax, lambdaComp, thrustSI, inertialComp, dt, context = {}) {
    if (this.destroyed) return;
    const s = this.spec;
    const lam = Math.max(lambdaMax, lambdaComp);
    const sigTidal = (s.density * lam * s.length * s.length) / 8;
    const sigThrust = inertialComp ? 0 : (s.density * thrustSI * s.length) / 2;
    const sigma = sigTidal + sigThrust;
    this.stress = sigma;
    this.stressFrac = sigma / s.ultimate;
    this.maxStressFrac = Math.max(this.maxStressFrac, this.stressFrac);
    this.tidalAcrossShipG = (lam * s.length) / G0;
    this.tidalAcrossBodyG = (lam * s.crewHeight) / G0;

    if (sigma > s.yield) {
      const p = (sigma - s.yield) / (s.ultimate - s.yield);
      if (p * 0.04 > this.plasticStrain) {
        if (this.plasticStrain === 0) this.events.push({ type: 'yield', text: 'Предел текучести корпуса превышен: необратимая деформация', ...context });
        this.plasticStrain = p * 0.04;
      }
    }
    this.integrity = Math.max(0, 1 - Math.max(0, (this.maxStressFrac * s.ultimate - s.yield) / (s.ultimate - s.yield)));

    for (const sys of this.systems) {
      if (!sys.ok) continue;
      // длинные элементы испытывают нагрузку ∝ L², короткие — меньше
      if (this.stressFrac >= sys.threshold) {
        sys.ok = false;
        sys.failedAt = context;
        this.events.push({ type: 'system', text: `Отказ: ${sys.name}`, ...context });
      }
    }

    // экипаж: приливы через тело + перегрузка от тяги
    const bodyG = this.tidalAcrossBodyG;
    const thrustG = inertialComp ? 0 : thrustSI / G0;
    const load = Math.max(bodyG / 20, thrustG / 15);
    let lvl = 0;
    if (load > 1) lvl = 3;
    else if (load > 0.3) lvl = 2;
    else if (load > 0.08 || thrustG > 2.5) lvl = 1;
    if (lvl > this.crewLevel) {
      this.crewLevel = lvl;
      const txt = ['норма', 'перегрузка: дискомфорт', 'опасные нагрузки: травмы', 'нагрузки несовместимы с жизнью'][lvl];
      this.events.push({ type: 'crew', text: `Экипаж: ${txt}`, ...context });
    }
    this.crew = ['норма', 'дискомфорт', 'травмы', 'гибель'][this.crewLevel];

    const vibTarget = Math.min(1, Math.max(this.stressFrac * 1.4, thrustSI > 0 && !inertialComp ? Math.min(0.25, thrustG * 0.03) : 0));
    this.vibration += (vibTarget - this.vibration) * Math.min(1, dt * 4);

    if (sigma >= s.ultimate) {
      this.destroyed = true;
      this.integrity = 0;
      this.events.push({ type: 'destroyed', text: 'Разрушение корпуса: напряжение превысило предел прочности', ...context });
    }
  }

  takeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  systemOk(id) {
    const s = this.systems.find((x) => x.id === id);
    return s ? s.ok : true;
  }
}
