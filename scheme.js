// Dibujo esquemático de las vías para la simulación: tu tren, el otro tren,
// la distancia que os separa y lo que necesitas para frenar.
import { stoppingDistance, sayDistance, DEFAULTS } from './engine.js';

const W = 360, X0 = 24, X1 = 336;
const Y = { v1: 62, v2: 104 };
const km = (m) => sayDistance(m).replace(' kilómetros', ' km').replace(' kilómetro', ' km').replace(' metros', ' m');

export function initScheme(svg, span) {
  svg.setAttribute('viewBox', `0 0 ${W} 150`);
  svg.innerHTML = `
    <text x="${X0}" y="20" class="sc-end">← Brenna</text>
    <text x="${X1}" y="20" class="sc-end" text-anchor="end">Castelmar →</text>
    <line x1="${X0}" y1="${Y.v1}" x2="${X1}" y2="${Y.v1}" class="sc-rail"/>
    <line x1="${X0}" y1="${Y.v2}" x2="${X1}" y2="${Y.v2}" class="sc-rail"/>
    <text x="${X0}" y="${Y.v1 - 12}" class="sc-lbl">tu vía</text>
    <text x="${X0}" y="${Y.v2 + 22}" class="sc-lbl">vía contigua</text>
    <rect id="sc-brake" x="0" y="${Y.v1 - 7}" height="14" width="0" class="sc-brake"/>
    <text id="sc-brake-t" x="0" y="${Y.v1 + 24}" class="sc-small"></text>
    <g id="sc-gap"><line id="sc-gap-l" y1="36" y2="36" class="sc-gap"/><text id="sc-gap-t" y="32" class="sc-gapt" text-anchor="middle"></text></g>
    <g id="sc-others"></g>
    <g id="sc-own" class="sc-train"><rect x="-13" y="-8" width="26" height="16" rx="4" class="sc-own"/><path d="M13 -5 L19 0 L13 5 Z" class="sc-own"/><text y="4" text-anchor="middle" class="sc-tt">Tú</text></g>
  `;
  svg._span = span;
}

export function renderScheme(svg, sim, own) {
  const span = svg._span;
  const back = 600;
  const sx = (m) => X0 + ((m + back) / (span + back)) * (X1 - X0);
  // Coordenada a lo largo de la línea: tu tren está en "x recorrida" desde el origen.
  const ownS = sim.travelled;
  const toLocal = (s) => s - ownS; // tú siempre en 0
  const ox = sx(0);
  svg.querySelector('#sc-own').setAttribute('transform', `translate(${ox},${Y.v1})`);
  const need = stoppingDistance(own.speed, DEFAULTS);
  const bw = Math.max(0, sx(Math.min(need, span)) - ox);
  const br = svg.querySelector('#sc-brake');
  br.setAttribute('x', ox); br.setAttribute('width', bw);
  const bt = svg.querySelector('#sc-brake-t');
  bt.setAttribute('x', ox + 2);
  bt.textContent = own.speed > 0.5 ? `te hace falta ${km(need)} para parar` : 'parado';

  const g = svg.querySelector('#sc-others');
  g.innerHTML = '';
  let nearest = null;
  for (const o of sim.others) {
    const rel = toLocal(o.s);
    if (rel < -back || rel > span) continue;
    const x = sx(rel);
    const y = o.trackId === 'v1' ? Y.v1 : Y.v2;
    const left = o.opposite;
    const cls = o.degraded ? 'sc-deg' : 'sc-other';
    const arrow = o.speed > 0.3 ? (left ? '<path d="M-13 -5 L-19 0 L-13 5 Z" class="' + cls + '"/>' : '<path d="M13 -5 L19 0 L13 5 Z" class="' + cls + '"/>') : '';
    const sp = o.speed > 0.3 ? `${Math.round(o.speed * 3.6)} km/h` : (o.degraded ? 'parado · sistemas caídos' : 'parado');
    g.insertAdjacentHTML('beforeend', `<g transform="translate(${x},${y})"><rect x="-13" y="-8" width="26" height="16" rx="4" class="${cls}"/>${arrow}<text y="4" text-anchor="middle" class="sc-tt">${o.id}</text><text y="${y === Y.v1 ? -14 : 24}" text-anchor="middle" class="sc-small">${sp}</text></g>`);
    if (rel > 0 && (!nearest || rel < nearest.rel)) nearest = { rel, x };
  }
  const gl = svg.querySelector('#sc-gap-l'), gt = svg.querySelector('#sc-gap-t');
  if (nearest) {
    gl.setAttribute('x1', ox); gl.setAttribute('x2', nearest.x);
    gt.setAttribute('x', (ox + nearest.x) / 2); gt.textContent = km(nearest.rel);
    svg.querySelector('#sc-gap').style.display = '';
  } else svg.querySelector('#sc-gap').style.display = 'none';
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
