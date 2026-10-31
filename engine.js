// Motor de avisos AIS para maquinistas.
// Funciones puras: no tocan DOM, GPS ni voz. Se pueden probar en Node.
// Es un complemento de último recurso: nunca sustituye a los sistemas de
// protección del tren. El maquinista decide siempre.

export const DEFAULTS = {
  decel: 0.6,          // m/s² deceleración de servicio supuesta (conservadora)
  reaction: 4,         // s de reacción del maquinista + respuesta del freno
  corridor: 25,        // m de anchura lateral para considerar "en tu vía o la contigua"
  sameTrackCross: 3,   // m: con vías identificadas distintas y más separación, se descarta
  degradedRadius: 3000,// m: radio de alarma de tren parado con sistemas degradados
  maxPublicSpeed: 83,  // m/s (300 km/h) peor caso cuando no conocemos la velocidad
  infoRange: 2000,     // m extra sobre la distancia de frenado para el aviso informativo
};

const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

export function distance(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function bearing(a, b) {
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function move(p, headingDeg, meters) {
  const d = meters / R;
  const h = toRad(headingDeg);
  const lat1 = toRad(p.lat), lon1 = toRad(p.lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(h));
  const lon2 = lon1 + Math.atan2(Math.sin(h) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: toDeg(lat2), lon: toDeg(lon2) };
}

export const angleDiff = (a, b) => {
  const d = Math.abs(((a - b) % 360 + 540) % 360 - 180);
  return d;
};

export function stoppingDistance(v, cfg = DEFAULTS) {
  return v * cfg.reaction + (v * v) / (2 * cfg.decel);
}

// Texto de distancia para voz: "800 metros", "1,5 kilómetros".
export function sayDistance(m) {
  if (m < 1000) return `${Math.max(100, Math.round(m / 100) * 100)} metros`;
  const km = Math.round(m / 100) / 10;
  return km === 1 ? '1 kilómetro' : `${String(km).replace('.', ',')} kilómetros`;
}

const LEVEL = { none: 0, info: 1, aviso: 2, urgente: 3 };
export const levelRank = (l) => LEVEL[l] ?? 0;

/**
 * own:    {lat, lon, speed (m/s), heading (deg|null), accuracy (m), ageS, trackId?, trackStatus}
 * others: [{id, lat, lon, speed|null, heading|null, accuracy, ageS, trackId?, stopped, degraded, source}]
 * Devuelve {alerts: [...], targets: [...]} ordenado por gravedad.
 */
export function evaluate(own, others, cfg = DEFAULTS) {
  const alerts = [];
  const targets = [];

  // Estado propio
  if (own.ageS > 8 && own.speed > 2) { // parado sin fixes nuevos es normal
    alerts.push({ level: 'info', code: 'gps', key: 'gps',
      text: 'Sin señal GPS. Posición estimada.' });
  }
  if (own.trackStatus === 'none' && own.speed > 8) {
    alerts.push({ level: 'aviso', code: 'track', key: 'track',
      text: 'Vía no confirmada. Tu posición no coincide con ninguna vía del mapa.' });
  }

  for (const o of others) {
    const d = distance(own, o);
    const brg = bearing(own, o);
    const heading = own.heading ?? brg;
    const rel = toRad(brg - heading);
    const along = d * Math.cos(rel);
    const cross = Math.abs(d * Math.sin(rel));
    const pub = o.source === 'renfe';
    const oSpeed = o.speed ?? (pub ? null : 0);
    const knownHeading = o.heading != null;
    const opposite = knownHeading && angleDiff(o.heading, heading) > 135;
    const sameDir = knownHeading && angleDiff(o.heading, heading) < 45;

    // Incertidumbre a lo largo de la vía: lo que se ha podido mover desde el último dato.
    const worstSpeed = oSpeed ?? cfg.maxPublicSpeed;
    const uncertainty = worstSpeed * (o.ageS || 0) + own.speed * (own.ageS || 0) +
      (o.accuracy || 10) + (own.accuracy || 10);

    const t = { id: o.id, source: o.source, d, along, cross, opposite, sameDir, level: 'none' };
    targets.push(t);

    // 1) Tren detenido con sistemas degradados: alarma en ambas vías, sin mirar sentido.
    // El radio crece con tu velocidad: siempre por encima de tu distancia de frenado.
    if (o.stopped && o.degraded) {
      const needD = stoppingDistance(own.speed, cfg);
      const gapD = d - uncertainty;
      const radius = Math.max(cfg.degradedRadius, needD * 2 + cfg.infoRange);
      if (gapD < radius) {
        const level = gapD < needD * 1.2 ? 'urgente' : 'aviso';
        t.level = level;
        const pre = level === 'urgente' ? 'Frena. ' : 'Atención. ';
        alerts.push({ level, code: 'degraded', key: 'deg:' + o.id, target: o.id,
          text: `${pre}Tren detenido con sistemas degradados a ${sayDistance(d)}. Precaución en ambas vías.` });
      }
      continue;
    }

    // 2) ¿Está en nuestro corredor (misma vía o contigua)?
    const inCorridor = cross < cfg.corridor + (o.accuracy || 10);
    if (!inCorridor) continue;
    const knownDifferentTrack = own.trackId && o.trackId && own.trackId !== o.trackId && cross > cfg.sameTrackCross;

    // 3) Tren por delante
    if (along > 0) {
      let closing, need;
      if (opposite) {
        closing = own.speed + (oSpeed ?? worstSpeed);
        need = stoppingDistance(own.speed, cfg) + stoppingDistance(oSpeed ?? worstSpeed, cfg);
      } else if (sameDir) {
        closing = own.speed - (oSpeed ?? 0);
        need = closing > 0 ? stoppingDistance(closing, cfg) : 0;
      } else {
        // Rumbo desconocido (dato público) o parado: suponemos que no se mueve hacia ti,
        // pero contamos su incertidumbre.
        closing = own.speed;
        need = stoppingDistance(own.speed, cfg);
      }
      if (closing < 0.5) continue;
      const gap = along - uncertainty;
      t.gap = gap; t.need = need;
      if (knownDifferentTrack) {
        // Cruce normal: su maquinista ha indicado otra vía. Solo informativo.
        if (gap < need * 2 + cfg.infoRange) {
          t.level = 'info';
          alerts.push({ level: 'info', code: 'cross', key: 'cross:' + o.id, target: o.id,
            text: `Cruce con un tren a ${sayDistance(along)}. Su maquinista indica que va por la otra vía.` });
        }
        continue;
      }
      // El GPS no distingue vías separadas 4 o 5 metros: nunca afirmamos "en tu vía".
      const where = 'Puede ir por tu vía.';
      const srcTxt = pub ? ` Dato público con ${Math.round(o.ageS)} segundos de retraso.` : '';
      const dir = opposite ? 'de frente' : 'delante';
      let level = 'none', text = '';
      if (gap < need) {
        level = 'urgente';
        text = `Frena. Tren ${dir} a ${sayDistance(Math.max(0, along))}. ${where} Sin margen de frenado.`;
      } else if (gap < need * 1.5 + 500) {
        level = 'aviso';
        text = `Tren ${dir} a ${sayDistance(along)}. ${where} Margen de frenado justo.`;
      } else if (gap < need * 2 + cfg.infoRange) {
        level = 'info';
        text = `Tren ${dir} a ${sayDistance(along)}. ${where}`;
      }
      if (pub && level === 'urgente') level = 'aviso'; // un dato público con retraso nunca dispara "frena"
      if (level !== 'none') {
        t.level = level;
        alerts.push({ level, code: 'ahead', key: 'ahead:' + o.id, target: o.id, text: text + srcTxt });
      }
      continue;
    }

    // 4) Tren por detrás que se acerca más rápido, en el mismo sentido
    if (along < 0 && sameDir && oSpeed != null && oSpeed > own.speed + 3 && !knownDifferentTrack) {
      const closing = oSpeed - own.speed;
      const need = stoppingDistance(closing, cfg);
      const gap = -along - uncertainty;
      if (gap < need * 2 + 1000) {
        t.level = 'aviso';
        alerts.push({ level: 'aviso', code: 'behind', key: 'behind:' + o.id, target: o.id,
          text: `Tren detrás acercándose más rápido, a ${sayDistance(-along)}.` });
      }
    }
  }

  alerts.sort((a, b) => levelRank(b.level) - levelRank(a.level));
  return { alerts, targets };
}

// Detecta si el móvil va en marcha (para proponer activar/desactivar).
export function motionState(history, now) {
  // history: [{t (ms), speed (m/s)}]
  const recent = history.filter((h) => now - h.t < 30000);
  if (recent.length < 3) return 'unknown';
  const moving = recent.filter((h) => h.speed > 5.5).length / recent.length; // > 20 km/h
  if (moving > 0.8) return 'moving';
  const stillLong = history.filter((h) => now - h.t < 600000);
  if (stillLong.length > 10 && stillLong.every((h) => h.speed < 1)) return 'stopped-long';
  return 'mixed';
}
