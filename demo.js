// Demostración guiada: explica qué es, cómo se entra, la situación de fallo total,
// cómo se comparten posiciones y dos ejemplos de avisos con voz en paralelo.
import { evaluate, levelRank, DEFAULTS } from './engine.js';
import { SCENARIOS, Simulation } from './sim.js';
import { initScheme, renderScheme, explainNow, addPulse } from './scheme.js';

const scn = (id) => SCENARIOS.find((s) => s.id === id);

const STEPS = [
  {
    key: 'A', title: 'Qué es AIS y qué se propone',
    visual: 'ais',
    text: [
      'En el mar, cada barco emite por radio su posición, su rumbo y su velocidad. Es el AIS. Así todos los barcos cercanos se ven entre sí y reciben alertas si van a chocar. En los aviones existe algo parecido.',
      'La propuesta es llevar esa idea al tren, usando el móvil que cada maquinista ya lleva encima.',
      'No sustituye a ningún sistema de seguridad. Es un último recurso para cuando todo lo demás falla.',
    ],
  },
  {
    key: 'B', title: 'El maquinista entra en la app',
    visual: 'login',
    text: [
      'Solo pueden usarla maquinistas verificados. Al empezar el servicio, el maquinista entra con su código, indica el número de tren y por qué vía circula.',
      'Un móvil por tren. Los avisos suenan solo en cabina, nunca a la vista de los viajeros.',
    ],
  },
  {
    key: 'C', title: 'Situación de fallo total',
    visual: 'failure',
    text: [
      'Imagina que fallan a la vez la señalización, la protección en cabina y las comunicaciones con el puesto de mando. Por una avería, un corte eléctrico o un accidente.',
      'Los trenes que ya circulan siguen ahí, y nadie sabe con seguridad dónde está cada uno.',
      'Es justo el caso para el que existe esta app.',
    ],
  },
  {
    key: 'D', title: 'Los móviles se comparten la posición',
    visual: 'share',
    text: [
      'Cada móvil envía cada segundo su posición GPS, su velocidad y su rumbo, y recibe los de los trenes cercanos.',
      'Con eso calcula, para cada tren, la distancia y si queda margen para frenar. Si no queda, avisa por voz.',
      'En un túnel sin cobertura sigue estimando su posición con la última velocidad conocida.',
    ],
  },
  {
    key: 'E', title: 'Aviso: tren de frente',
    sim: 'frontal',
    text: ['Vas a 160 kilómetros por hora. Otro tren viene de frente y puede ir por tu misma vía. Escucha los avisos de la app.'],
  },
  {
    key: 'F', title: 'Aviso: tren parado con sistemas caídos',
    sim: 'degradado',
    text: ['Otro caso. Un tren se ha detenido y su maquinista le ha dicho a la app: sistemas caídos. La app no sabe por qué vía está, así que avisa a los trenes de las dos vías.'],
  },
  {
    key: 'G', title: 'En resumen',
    visual: 'end',
    text: [
      'Un móvil por tren, con GPS y voz. Sin instalar nada en la vía ni en el tren.',
      'Avisa de trenes cercanos sin margen de frenado, de trenes parados con sistemas caídos y de posiciones que no coinciden con una vía.',
      'El maquinista decide siempre. Es una idea en fase de prototipo, que puede cuajar o no. Lo que más importa es la opinión de quienes conducen trenes.',
    ],
  },
];

const VISUALS = {
  ais: `<svg viewBox="0 0 360 170" class="scheme">
    <rect width="360" height="170" fill="#0c2233"/>
    ${[[90, 70], [250, 110], [200, 40]].map(([x, y]) => `
      <circle cx="${x}" cy="${y}" r="16" class="wave w1"/><circle cx="${x}" cy="${y}" r="16" class="wave w2"/>
      <path d="M${x - 14} ${y} L${x + 8} ${y - 7} L${x + 16} ${y} L${x + 8} ${y + 7} Z" fill="#e8edf2"/>`).join('')}
    <text x="12" y="160" class="sc-end">Barcos que emiten su posición y se ven entre sí</text></svg>`,
  failure: `<div class="fail-list">
    <div><span>✕</span> Señalización</div><div><span>✕</span> Protección en cabina</div>
    <div><span>✕</span> Comunicaciones con el puesto de mando</div>
    <div class="ok"><span>✓</span> El móvil del maquinista, con GPS</div></div>`,
  share: `<svg viewBox="0 0 360 150" class="scheme">
    <line x1="20" y1="70" x2="340" y2="70" class="sc-rail"/><line x1="20" y1="104" x2="340" y2="104" class="sc-rail"/>
    <g transform="translate(70,70)"><rect x="-13" y="-8" width="26" height="16" rx="4" class="sc-own"/><text y="4" text-anchor="middle" class="sc-tt">A</text></g>
    <g transform="translate(290,70)"><rect x="-13" y="-8" width="26" height="16" rx="4" class="sc-other"/><text y="4" text-anchor="middle" class="sc-tt">B</text></g>
    <g transform="translate(200,104)"><rect x="-13" y="-8" width="26" height="16" rx="4" class="sc-other"/><text y="4" text-anchor="middle" class="sc-tt">C</text></g>
    <path d="M70 55 Q180 0 290 55" class="share-line"/><path d="M70 55 Q135 20 200 90" class="share-line"/><path d="M290 55 Q245 40 200 90" class="share-line"/>
    <text x="180" y="138" text-anchor="middle" class="sc-small">posición · velocidad · rumbo, cada segundo</text></svg>`,
  login: `<div class="phone"><div class="phone-in login-mock">
    <b>AIS Cabina</b>
    <div class="lf" style="--d:0.3s"><small>Código de maquinista</small><span>••••••••</span></div>
    <div class="lf" style="--d:1.6s"><small>Número de tren</small><span>00123</span></div>
    <div class="lf" style="--d:2.9s"><small>Vía (mirando de Brenna a Castelmar)</small><span>Vía de la derecha</span></div>
    <div class="lf ok" style="--d:4.2s"><span>✓ Verificado. Avisos activos.</span></div>
  </div></div>`,
  end: `<div class="fail-list"><div class="ok"><span>✓</span> Complemento de último recurso</div>
    <div class="ok"><span>✓</span> Avisos por voz, solo en cabina</div><div class="ok"><span>✓</span> El maquinista decide siempre</div></div>`,
};

export function runDemo(ui) {
  // ui: {root, say(text, level, onend), cancelSpeech(), onExit()}
  let i = 0, timer = null, sim = null, alive = true, token = 0;
  const $ = (sel) => ui.root.querySelector(sel);

  function clear() { clearInterval(timer); timer = null; sim = null; token++; ui.cancelSpeech(); }

  function render() {
    clear();
    const st = STEPS[i];
    const my = token;
    $('#demo-step').textContent = `${st.key} · ${i + 1} de ${STEPS.length}`;
    $('#demo-title').textContent = st.title;
    $('#demo-dots').innerHTML = STEPS.map((_, k) => `<span class="${k === i ? 'on' : k < i ? 'done' : ''}"></span>`).join('');
    $('#demo-prev').disabled = i === 0;
    $('#demo-next').textContent = i === STEPS.length - 1 ? 'Ver otra vez' : 'Siguiente';
    const text = $('#demo-text');
    text.replaceChildren(...st.text.map((t) => { const p = document.createElement('p'); p.textContent = t; return p; }));
    const live = $('#demo-live');
    live.hidden = !st.sim; live.textContent = '';
    const vis = $('#demo-visual');
    if (st.sim) {
      vis.innerHTML = `<div class="phone"><div class="phone-in app-mock">
        <div class="am-speed"><b id="dm-speed">0</b> km/h</div>
        <div id="dm-status" class="status lvl-none">Sin trenes cerca</div></div></div>
        <p class="muted small" style="margin:10px 0 0">Lo que está pasando en la vía (el maquinista no lo ve):</p>
        <svg id="dm-svg" class="scheme"></svg>`;
      { // Foto fija inicial mientras se lee la situación.
        const s0 = new Simulation(scn(st.sim)); const svg0 = $('#dm-svg');
        initScheme(svg0, Math.max(4000, ...s0.scn.others.map((o) => o.along + 1000)));
        renderScheme(svg0, s0, s0.ownFix());
        $('#dm-speed').textContent = Math.round(s0.speed * 3.6);
        live.hidden = true;
      }
      // Primero se lee la situación; después arranca la simulación con la voz de la app.
      ui.say(st.text.join(' '), 'narr', () => { if (my === token) startSim(st, my); });
    } else {
      if (st.visual === 'share') {
        vis.innerHTML = '<svg id="dm-share" class="scheme"></svg><p class="muted small" style="margin:4px 0 0">Cada tren (su móvil) dice dónde está, a qué velocidad y hacia dónde va.</p>';
        const svg = $('#dm-share');
        initScheme(svg, 6000);
        const fake = { travelled: 0, others: [
          { id: 'B', s: 4200, speed: 33, opposite: true, trackId: 'v1' },
          { id: 'C', s: 2300, speed: 0, opposite: false, trackId: 'v2' }] };
        renderScheme(svg, fake, { speed: 40 });
        svg.querySelector('#sc-brake').setAttribute('stroke-dasharray', '0 9999');
        svg.querySelector('#sc-brake-t').textContent = '';
        svg.querySelector('#sc-gap').style.display = 'none';
        addPulse(svg, 0, false); addPulse(svg, 4200, false); addPulse(svg, 2300, true);
      } else vis.innerHTML = VISUALS[st.visual] || '';
      ui.say(st.text.join(' '), 'narr', () => {
        if (my === token && i < STEPS.length - 1) setTimeout(() => { if (my === token && alive) { i++; render(); } }, 1800);
      });
    }
  }

  function startSim(st, my) {
    const s = scn(st.sim);
    sim = new Simulation(s);
    $('#demo-live').hidden = false;
    const svg = $('#dm-svg');
    initScheme(svg, Math.max(4000, ...s.others.map((o) => o.along + 1000)));
    const spoken = new Map();
    let ended = false;
    timer = setInterval(() => {
      if (my !== token || !sim) return;
      for (let k = 0; k < 3; k++) sim.step(1);
      const own = { ...sim.ownFix(), ageS: 0 };
      const { alerts } = evaluate(own, sim.otherTrains(), DEFAULTS);
      const top = alerts[0];
      // En la demo, el maquinista frena en cuanto oye «Frena».
      if (top?.level === 'urgente') sim.braking = true;
      $('#dm-speed').textContent = Math.round(own.speed * 3.6);
      const stEl = $('#dm-status');
      stEl.className = 'status lvl-' + (top?.level || 'none');
      stEl.textContent = top ? top.text : 'Sin riesgo detectado';
      renderScheme(svg, sim, own);
      let line = explainNow(sim, own, top);
      if (sim.braking && own.speed > 0.5 && !line.includes('Frena tú')) line = 'El maquinista ha oído «Frena» y está frenando. ' + line;
      $('#demo-live').textContent = line;
      if (top) {
        const prev = spoken.get(top.key);
        if (!prev || levelRank(top.level) > levelRank(prev)) { ui.say(top.text, top.level); spoken.set(top.key, top.level); }
      }
      const r = sim.result();
      if (r && !ended) {
        ended = true; clearInterval(timer);
        $('#demo-live').textContent = r.text;
        setTimeout(() => {
          if (my !== token) return;
          ui.say(r.text, 'narr', () => setTimeout(() => { if (my === token && alive) { i++; render(); } }, 1800));
        }, 1500);
      }
    }, 1000);
  }

  $('#demo-next').onclick = () => { if (i < STEPS.length - 1) i++; else i = 0; render(); };
  $('#demo-prev').onclick = () => { if (i > 0) { i--; render(); } };
  $('#demo-exit').onclick = exit;
  function exit() { alive = false; clear(); ui.onExit(); }
  render();
  return { stop: exit };
}
