// Escenarios de simulación para probar la app sin estar en cabina.
// Las posiciones son ficticias (en mar abierto) para no evocar ningún lugar real.
import { move, stoppingDistance } from './engine.js?v=7';

export const ORIGIN = { lat: 44.25, lon: -4.6 };
const HEADING = 70;
const kmh = (v) => v / 3.6;

export const SCENARIOS = [
  {
    id: 'frontal', intro: ['Vas a 160 km/h de Brenna a Castelmar. Los sistemas de seguridad del tren no funcionan.', 'Otro tren viene de frente a 120 km/h. Ni tú ni él sabéis que podéis ir por la misma vía.'], todo: 'Cuando oigas «Frena», pulsa el botón rojo FRENAR.', title: 'Tren de frente en tu vía',
    desc: 'Vas a 160 km/h. Otro tren viene de frente por la misma vía a 9 km.',
    own: { speed: kmh(160) },
    others: [{ id: 'B', along: 9000, cross: 0, speed: kmh(120), opposite: true, trackId: 'v1' }],
  },
  {
    id: 'degradado', intro: ['Vas a 200 km/h. Delante, otro tren se ha parado y su maquinista ha marcado en la app que tiene los sistemas de seguridad caídos.', 'No se sabe por qué vía está, así que la app avisa a los trenes de las dos vías.'], todo: 'Cuando oigas el aviso, pulsa FRENAR.', title: 'Tren parado con sistemas degradados',
    desc: 'Un tren se ha detenido a 6 km y avisa de sistemas degradados. Alarma en ambas vías.',
    own: { speed: kmh(200) },
    others: [{ id: 'B', along: 6000, cross: 4.5, speed: 0, stopped: true, degraded: true, trackId: 'v2' }],
  },
  {
    id: 'cruce', intro: ['Vas a 140 km/h. Viene de frente otro tren por la vía contigua, un cruce normal.', 'Su maquinista ha indicado en la app por qué vía va, así que la app solo te informa y no da la alarma.'], todo: 'No tienes que hacer nada. Mira cómo os cruzáis.', title: 'Cruce normal en vía contigua',
    desc: 'Cruzas con un tren por la otra vía. No debe avisar más que lo justo.',
    own: { speed: kmh(140) },
    others: [{ id: 'B', along: 7000, cross: 4.5, speed: kmh(140), opposite: true, trackId: 'v2' }],
  },
  {
    id: 'alcance', intro: ['Vas a 180 km/h. Delante, por tu misma vía, va un mercancías a 60 km/h.', 'Le vas alcanzando. La app calcula si te da tiempo a frenar.'], todo: 'Cuando oigas «Frena», pulsa FRENAR.', title: 'Tren lento delante',
    desc: 'Un tren de mercancías va delante a 60 km/h en tu misma vía.',
    own: { speed: kmh(180) },
    others: [{ id: 'B', along: 8000, cross: 0, speed: kmh(60), opposite: false, trackId: 'v1' }],
  },
  {
    id: 'tunel', intro: ['Vas a 120 km/h y entras en un túnel largo: el móvil pierde la señal GPS.', 'La app calcula dónde estás por tu velocidad y sigue vigilando. Más adelante hay un tren parado.'], todo: 'Cuando oigas «Frena», pulsa FRENAR.', title: 'Túnel sin cobertura',
    desc: 'Pierdes GPS durante 40 s. La app estima tu posición y sigue avisando.',
    own: { speed: kmh(120) },
    others: [{ id: 'B', along: 6500, cross: 0, speed: 0, stopped: true, trackId: 'v1' }],
    gpsLoss: [10, 50],
  },
  {
    id: 'via', intro: ['Vas a 100 km/h. A los pocos segundos tu posición ya no coincide con ninguna vía del mapa.', 'Puede ser un error del GPS o algo serio. La app te lo dice para que lo compruebes.'], todo: 'Solo escucha el aviso.', title: 'Vía no confirmada',
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
    this.travelled = 0;
    this.ownTrack = 'v1';
    this.everBraked = false;
    this.others = scn.others.map((o) => {
      const p0 = move(ORIGIN, HEADING, o.along);
      const p = move(p0, HEADING + 90, o.cross);
      return { ...o, s: o.along, lat: p.lat, lon: p.lon, heading: o.opposite ? (HEADING + 180) % 360 : HEADING };
    });
  }
  step(dt) {
    this.t += dt;
    if (this.braking) this.everBraked = true;
    this.travelled += this.speed * dt;
    if (this.braking) this.speed = Math.max(0, this.speed - 0.9 * dt);
    else if (this.speed < this.cruise) this.speed = Math.min(this.cruise, this.speed + 0.3 * dt);
    const p = move(this.pos, HEADING, this.speed * dt);
    this.pos = p;
    for (const o of this.others) {
      if (o.speed > 0) {
        // El otro maquinista también lleva la app: cuando le llega el «Frena», frena.
        const gap = o.s - this.travelled;
        if (o.opposite && o.trackId === this.ownTrack && gap > 0 &&
            gap < stoppingDistance(o.speed) + stoppingDistance(this.speed) + 400) o.braking = true;
        if (o.braking) o.speed = Math.max(0, o.speed - 0.7 * dt);
        o.s += (o.opposite ? -1 : 1) * o.speed * dt;
        const q = move(o, o.heading, o.speed * dt);
        o.lat = q.lat; o.lon = q.lon;
      }
    }
  }
  // ¿Ha terminado la escena? Devuelve un resumen o null.
  result() {
    const ahead = this.others.map((o) => o.s - this.travelled);
    const minGap = ahead.length ? Math.min(...ahead.map((g) => Math.abs(g))) : null;
    if (this.speed < 0.3 && this.everBraked && this.others.every((o) => o.speed < 0.3 || !o.opposite || o.trackId !== this.ownTrack)) {
      const g = ahead.filter((x) => x > 0).sort((a, b) => a - b)[0];
      return { ok: g == null || g > 50, text: g != null ? `Te has detenido a ${Math.round(g)} metros del otro tren.` : 'Te has detenido.' };
    }
    if (this.others.some((o) => o.trackId === this.ownTrack && !o.opposite && o.s - this.travelled < 5) ||
        this.others.some((o) => o.trackId === this.ownTrack && o.opposite && o.s - this.travelled < 5)) {
      return { ok: false, text: 'No has frenado a tiempo. En la realidad habría habido un choque. Prueba otra vez y frena al oír «Frena».' };
    }
    if (this.others.some((o) => o.degraded && o.s - this.travelled < -50))
      return { ok: false, text: 'Has pasado junto al tren averiado sin parar. Si hubiera estado en tu vía, o invadiéndola, habría habido un choque.' };
    if (ahead.length && ahead.every((g) => g < -300)) return { ok: true, text: 'Cruce completado sin alarmas. Así debe ser un cruce normal.' };
    if (!this.others.length && this.t > 45) return { ok: true, text: 'Fin. La app avisó de que tu posición no coincide con una vía.' };
    if (this.t > 600) return { ok: true, text: 'Fin de la simulación.' };
    return null;
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
