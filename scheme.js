// Dibujo de las vías vistas desde arriba, con los trenes, la distancia que los separa
// y la distancia que necesitas para frenar. Se usa en la demostración y en las simulaciones.
import { stoppingDistance, sayDistance, DEFAULTS } from './engine.js';

const NS = 'http://www.w3.org/2000/svg';
const TRACK = 'M-30 150 C 70 150 120 92 200 86 S 320 70 400 70';
const OFF = 18; // separación visual entre las dos vías
const km = (m) => sayDistance(m).replace(' kilómetros', ' km').replace(' kilómetro', ' km').replace(' metros', ' m');

function trees() {
  const pts = [[30, 40], [60, 25], [95, 48], [150, 20], [300, 30], [335, 18], [40, 205], [120, 200], [250, 160], [290, 190], [330, 150], [210, 205]];
  return pts.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${7 + (i % 3) * 2}" fill="#2f4a2a"/><circle cx="${x - 2}" cy="${y - 2}" r="${4 + (i % 3)}" fill="#3d5e34"/>`).join('');
}

export function initScheme(svg, span) {
  svg.setAttribute('viewBox', '0 0 360 220');
  svg.classList.add('scene');
  svg.innerHTML = `
    <defs>
      <pattern id="sleepers" width="6" height="10" patternUnits="userSpaceOnUse"><rect width="3" height="10" fill="#5a4636"/></pattern>
      <clipPath id="clip"><rect width="360" height="220" rx="12"/></clipPath>
    </defs>
    <g clip-path="url(#clip)">
      <rect width="360" height="220" fill="#4a6b3c"/>
      <path d="M0 0 H360 V55 Q200 40 0 75 Z" fill="#557a45"/>
      <path d="M0 220 V185 Q180 150 360 165 V220 Z" fill="#41603a"/>
      <path d="M240 220 C 250 160 300 120 360 110" stroke="#7d7466" stroke-width="9" fill="none"/>
      ${trees()}
      <path d="${TRACK}" transform="translate(0,${OFF / 2})" stroke="#8a8174" stroke-width="${OFF + 20}" fill="none"/>
      ${[0, OFF].map((dy) => `
        <path d="${TRACK}" transform="translate(0,${dy})" stroke="#5a4636" stroke-width="10" stroke-dasharray="2.5 3.5" fill="none"/>
        <path d="${TRACK}" transform="translate(0,${dy - 3})" stroke="#c9ced3" stroke-width="1.4" fill="none"/>
        <path d="${TRACK}" transform="translate(0,${dy + 3})" stroke="#c9ced3" stroke-width="1.4" fill="none"/>`).join('')}
      <path id="sc-brake" d="${TRACK}" stroke="rgba(250,204,21,.55)" stroke-width="12" fill="none" stroke-dasharray="0 9999"/>
      <path id="sc-path" d="${TRACK}" fill="none" stroke="none"/>
      <g id="sc-trains"></g>
      <g id="sc-gap"><path id="sc-gap-l" fill="none" stroke="#fff" stroke-width="1.2" stroke-dasharray="3 3"/><rect id="sc-gap-bg" rx="4" fill="rgba(0,0,0,.65)"/><text id="sc-gap-t" class="sc-gapt" text-anchor="middle" fill="#fff"></text></g>
      <rect x="6" y="6" width="96" height="18" rx="4" fill="rgba(0,0,0,.5)"/><text x="12" y="19" fill="#e8edf2" font-size="10">← Brenna</text>
      <rect x="258" y="196" width="96" height="18" rx="4" fill="rgba(0,0,0,.5)"/><text x="348" y="209" fill="#e8edf2" font-size="10" text-anchor="end">Castelmar →</text>
      <text id="sc-brake-t" x="10" y="214" fill="#fde68a" font-size="10"></text>
    </g>`;
  svg._span = span;
  svg._path = svg.querySelector('#sc-path');
  svg._len = svg._path.getTotalLength();
}

// Posición en píxeles de un punto a "rel" metros de tu tren (tú estás cerca del principio).
function pt(svg, rel, dy) {
  const L = svg._len, start = 0.18 * L;
  const px = start + (rel / svg._span) * (L * 0.78);
  const c = Math.max(0, Math.min(L, px));
  const p = svg._path.getPointAtLength(c);
  const q = svg._path.getPointAtLength(Math.min(L, c + 1));
  const a = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
  return { x: p.x, y: p.y + dy, a, px: c };
}

function trainSvg(svg, rel, dy, facingBack, kind, label) {
  // Tres coches, la cabeza en "rel" y el resto detrás según su sentido.
  const body = { own: ['#f1f5f9', '#2563eb'], other: ['#f1f5f9', '#dc2626'], deg: ['#9ca3af', '#7c3aed'] }[kind];
  const carM = Math.max(120, (svg._span / 360) * 22);
  let out = '';
  for (let k = 0; k < 3; k++) {
    const r = rel + (facingBack ? k : -k) * carM;
    const p = pt(svg, r, dy);
    out += `<g transform="translate(${p.x},${p.y}) rotate(${p.a})">
      <rect x="-10" y="-4.5" width="20" height="9" rx="${k === 0 ? 4 : 1.5}" fill="${body[0]}" stroke="#0f172a" stroke-width=".6"/>
      <rect x="-10" y="-1" width="20" height="2" fill="${body[1]}"/>
      ${k === 0 ? `<rect x="${facingBack ? -10 : 6}" y="-3.5" width="4" height="7" rx="1.5" fill="#0f172a"/>` : ''}</g>`;
  }
  const h = pt(svg, rel, dy);
  const ring = kind === 'deg' ? `<circle cx="${h.x}" cy="${h.y}" r="14" class="hazard"/>` : '';
  const tag = `<rect x="${h.x - 22}" y="${h.y - (dy ? -10 : 26)}" width="44" height="14" rx="3" fill="rgba(0,0,0,.65)"/><text x="${h.x}" y="${h.y - (dy ? -20 : 16)}" text-anchor="middle" fill="#fff" font-size="9" font-weight="700">${label}</text>`;
  return ring + out + tag;
}

// Ondas de "estoy aquí" sobre un tren (para explicar que los móviles se comparten la posición).
export function addPulse(svg, rel, onOtherTrack) {
  const p = pt(svg, rel, onOtherTrack ? OFF : 0);
  const g = document.createElementNS(NS, 'g');
  g.innerHTML = `<circle cx="${p.x}" cy="${p.y}" r="10" class="wave"/><circle cx="${p.x}" cy="${p.y}" r="10" class="wave w2"/>`;
  svg.querySelector('#sc-trains').appendChild(g);
}

export function renderScheme(svg, sim, own) {
  const span = svg._span;
  const need = stoppingDistance(own.speed, DEFAULTS);
  // Zona amarilla: lo que necesitas para parar, delante de tu tren.
  const a = pt(svg, 0, 0).px, b = pt(svg, Math.min(need, span), 0).px;
  const br = svg.querySelector('#sc-brake');
  br.setAttribute('stroke-dasharray', `0 ${a} ${Math.max(0, b - a)} 9999`);
  svg.querySelector('#sc-brake-t').textContent = own.speed > 0.5 ? `Amarillo: lo que necesitas para parar (${km(need)})` : '';

  let html = '';
  let nearest = null;
  for (const o of sim.others) {
    const rel = o.s - sim.travelled;
    if (rel < -span * 0.25 || rel > span * 1.05) continue;
    const dy = o.trackId === 'v1' ? 0 : OFF;
    const sp = o.speed > 0.3 ? `${Math.round(o.speed * 3.6)} km/h` : 'parado';
    html += trainSvg(svg, rel, dy, !o.opposite ? false : true, o.degraded ? 'deg' : 'other', `${o.id} · ${sp}`);
    if (rel > 0 && (!nearest || rel < nearest.rel)) nearest = { rel, dy };
  }
  html += trainSvg(svg, 0, 0, false, 'own', `Tú · ${Math.round(own.speed * 3.6)}`);
  svg.querySelector('#sc-trains').innerHTML = html;

  const gap = svg.querySelector('#sc-gap');
  if (nearest) {
    const p0 = pt(svg, 0, -16), p1 = pt(svg, nearest.rel, -16), pm = pt(svg, nearest.rel / 2, -30);
    svg.querySelector('#sc-gap-l').setAttribute('d', `M${p0.x} ${p0.y} Q ${pm.x} ${pm.y - 10} ${p1.x} ${p1.y}`);
    const t = svg.querySelector('#sc-gap-t');
    t.setAttribute('x', pm.x); t.setAttribute('y', pm.y - 6); t.textContent = km(nearest.rel);
    const bg = svg.querySelector('#sc-gap-bg');
    bg.setAttribute('x', pm.x - 26); bg.setAttribute('y', pm.y - 18); bg.setAttribute('width', 52); bg.setAttribute('height', 16);
    gap.style.display = '';
  } else gap.style.display = 'none';
}

// Frase en lenguaje llano de lo que está pasando ahora mismo.
export function explainNow(sim, own, top) {
  const need = stoppingDistance(own.speed, DEFAULTS);
  const ahead = sim.others.map((o) => ({ o, rel: o.s - sim.travelled })).filter((x) => x.rel > 0)
    .sort((a, b) => a.rel - b.rel)[0];
  if (sim.scn.gpsLoss && sim.inGpsLoss()) return 'Estás en el túnel sin GPS. La app calcula tu posición con la última velocidad y rumbo conocidos.';
  if (sim.scn.offTrackFrom != null && sim.t > sim.scn.offTrackFrom) return 'Tu posición GPS ya no cae sobre ninguna vía del mapa. La app te lo dice para que lo compruebes.';
  if (!ahead) return own.speed < 0.5 ? 'Estás parado.' : 'No hay ningún tren por delante.';
  const gap = ahead.rel;
  const other = ahead.o;
  const otherNeed = other.opposite && other.speed > 0.3 ? stoppingDistance(other.speed, DEFAULTS) : 0;
  const total = need + otherNeed;
  if (own.speed < 0.5) return `Te has parado. El otro tren está a ${km(gap)}.`;
  if (other.trackId !== 'v1' && !other.degraded) return `El tren ${other.id} va por la vía contigua. La app lo sabe porque su maquinista lo ha indicado, así que solo informa.`;
  const both = otherNeed ? ` (y él ${km(otherNeed)})` : '';
  if (other.braking && top?.level === 'urgente') return `Os separan ${km(gap)}. El otro maquinista también ha oído «Frena» y está frenando. Frena tú también.`;
  if (top?.level === 'urgente') return `Os separan ${km(gap)} y para parar necesitas ${km(need)}${both}. Ya no hay margen: frena.`;
  if (top?.level === 'aviso') return `Os separan ${km(gap)}. Necesitas ${km(need)} para parar${both}. El margen se acaba.`;
  return `Os separan ${km(gap)}. Necesitas ${km(need)} para parar${both}. De momento hay margen.`;
}
