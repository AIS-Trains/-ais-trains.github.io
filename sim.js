// Escenarios de simulación para probar la app sin estar en cabina.
// Las posiciones son ficticias (en mar abierto) para no evocar ningún lugar real.
import { move } from './engine.js';

export const ORIGIN = { lat: 44.25, lon: -4.6 };
const HEADING = 70;
const kmh = (v) => v / 3.6;

export const SCENARIOS = [
  {
    id: 'frontal', title: 'Tren de frente en tu vía',
    desc: 'Vas a 160 km/h. Otro tren viene de frente por la misma vía a 9 km.',
    own: { speed: kmh(160) },
    others: [{ id: 'B', along: 9000, cross: 0, speed: kmh(120), opposite: true, trackId: 'v1' }],
  },
  {
    id: 'degradado', title: 'Tren parado con sistemas degradados',
    desc: 'Un tren se ha detenido a 6 km y avisa de sistemas degradados. Alarma en ambas vías.',
    own: { speed: kmh(200) },
    others: [{ id: 'B', along: 6000, cross: 4.5, speed: 0, stopped: true, degraded: true, trackId: 'v2' }],
  },
  {
    id: 'cruce', title: 'Cruce normal en vía contigua',
    desc: 'Cruzas con un tren por la otra vía. No debe avisar más que lo justo.',
    own: { speed: kmh(140) },
    others: [{ id: 'B', along: 7000, cross: 4.5, speed: kmh(140), opposite: true, trackId: 'v2' }],
  },
  {
    id: 'alcance', title: 'Tren lento delante',
    desc: 'Un tren de mercancías va delante a 60 km/h en tu misma vía.',
    own: { speed: kmh(180) },
    others: [{ id: 'B', along: 8000, cross: 0, speed: kmh(60), opposite: false, trackId: 'v1' }],
  },
  {
    id: 'tunel', title: 'Túnel sin cobertura',
    desc: 'Pierdes GPS durante 40 s. La app estima tu posición y sigue avisando.',
    own: { speed: kmh(120) },
    others: [{ id: 'B', along: 6500, cross: 0, speed: 0, stopped: true, trackId: 'v1' }],
    gpsLoss: [10, 50],
  },
  {
    id: 'via', title: 'Vía no confirmada',
    desc: 'A los 15 s tu posición deja de coincidir con una vía del mapa.',
    own: { speed: kmh(100) },
    others: [],
    offTrackFrom: 15,
  },
];

export class Simulation {
  constructor(scn) {
    this.scn = scn;
    this.t = 0;
    this.pos = { ...ORIGIN };
    this.speed = scn.own.speed;
    this.cruise = scn.own.speed;
    this.braking = false;
    this.others = scn.others.map((o) => {
      const p0 = move(ORIGIN, HEADING, o.along);
      const p = move(p0, HEADING + 90, o.cross);
      return { ...o, lat: p.lat, lon: p.lon, heading: o.opposite ? (HEADING + 180) % 360 : HEADING };
    });
  }
  step(dt) {
    this.t += dt;
    if (this.braking) this.speed = Math.max(0, this.speed - 0.9 * dt);
    else if (this.speed < this.cruise) this.speed = Math.min(this.cruise, this.speed + 0.3 * dt);
    const p = move(this.pos, HEADING, this.speed * dt);
    this.pos = p;
    for (const o of this.others) {
      if (o.speed > 0) {
        // Si el otro tren "oye" el riesgo también frena (simula al otro maquinista con la app).
        if (o.brakeAt != null && this.t > o.brakeAt) o.speed = Math.max(0, o.speed - 0.7 * dt);
        const q = move(o, o.heading, o.speed * dt);
        o.lat = q.lat; o.lon = q.lon;
      }
    }
  }
  inGpsLoss() {
    const g = this.scn.gpsLoss;
    return g && this.t >= g[0] && this.t < g[1];
  }
  ownFix() {
    return {
      lat: this.pos.lat, lon: this.pos.lon, speed: this.speed, heading: HEADING, accuracy: 6,
      trackId: 'v1',
      trackStatus: this.scn.offTrackFrom != null && this.t > this.scn.offTrackFrom ? 'none' : 'ok',
    };
  }
  otherTrains() {
    return this.others.map((o) => ({
      id: o.id, lat: o.lat, lon: o.lon, speed: o.speed, heading: o.heading, accuracy: 8,
      ageS: 2, trackId: o.trackId, stopped: !!o.stopped || o.speed < 0.3, degraded: !!o.degraded, source: 'app',
    }));
  }
}
