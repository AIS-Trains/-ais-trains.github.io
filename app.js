import { evaluate, distance, bearing, move, levelRank, motionState, DEFAULTS } from './engine.js?v=7';
import { SCENARIOS, Simulation, ORIGIN } from './sim.js?v=7';
import { initScheme, renderScheme, explainNow } from './scheme.js?v=7';
import { runDemo } from './demo.js?v=7';

// ---------- Ajustes ----------
const PUBLIC_FEEDS = [
  'https://gtfsrt.renfe.com/vehicle_positions_LD.json',
  'https://gtfsrt.renfe.com/vehicle_positions.json',
];
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const COOLDOWN = { info: 120, aviso: 25, urgente: 7 }; // s entre repeticiones por voz

// ---------- Estado ----------
const S = {
  mode: null,        // 'real' | 'sim'
  view: 'voice',
  showPublic: true,
  active: true,
  mutedUntil: 0,
  sim: null,
  fix: null,         // último fix GPS real
  prevFix: null,
  history: [],
  track: { status: 'unknown', id: null, checkedAt: 0, at: null, misses: 0 },
  publicTrains: new Map(),
  publicStatus: 'off',
  spoken: new Map(), // key -> {level, t}
  lastTop: null,
  lastText: '',
  timer: null, watchId: null, pubTimer: null,
  map: null, layers: {}, wakeLock: null, motionPromptAt: 0,
};

const $ = (id) => document.getElementById(id);
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
}
function toast(msg, ms = 3000) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// ---------- Acceso ----------
async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
$('btn-terms').onclick = () => { store.set('ais.terms', '1'); show('scr-home'); };

// ---------- Inicio ----------
const simList = $('sim-list');
for (const s of SCENARIOS) {
  const b = document.createElement('button');
  b.innerHTML = `<b></b><span></span>`;
  b.querySelector('b').textContent = s.title;
  b.querySelector('span').textContent = s.desc;
  b.onclick = () => showIntro(s);
  simList.appendChild(b);
}
$('btn-real').onclick = () => start('real');
$('btn-demo').onclick = () => {
  unlockAudio();
  show('scr-demo');
  runDemo({
    root: $('scr-demo'),
    say,
    cancelSpeech: () => { try { speechSynthesis.cancel(); } catch {} },
    onExit: () => show('scr-home'),
  });
};

// Pantalla de explicación antes de cada simulación
let introScn = null;
function spanFor(scn) { return Math.max(4000, ...scn.others.map((o) => o.along + 1000)); }
function showIntro(scn) {
  introScn = scn;
  $('intro-title').textContent = scn.title;
  $('intro-text').replaceChildren(...scn.intro.map((t) => { const p = document.createElement('p'); p.textContent = t; return p; }));
  $('intro-todo').textContent = scn.todo;
  const svg = $('intro-svg');
  initScheme(svg, spanFor(scn));
  const sim = new Simulation(scn);
  renderScheme(svg, sim, sim.ownFix());
  show('scr-intro');
}
$('btn-intro-go').onclick = () => start('sim', introScn);
$('btn-intro-back').onclick = () => show('scr-home');
$('btn-again').onclick = () => { const s = S.sim?.scn || introScn; stop(); start('sim', s); };
$('btn-other').onclick = () => stop();
$('seg-view').addEventListener('click', (e) => {
  const v = e.target.closest('button')?.dataset.v; if (!v) return;
  S.view = v; store.set('ais.view', v);
  $('seg-view').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
});
$('chk-public').onchange = (e) => { S.showPublic = e.target.checked; store.set('ais.public', S.showPublic ? '1' : '0'); };

// ---------- Voz ----------
let esVoice = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices();
  esVoice = vs.find((v) => v.lang === 'es-ES') || vs.find((v) => v.lang?.startsWith('es')) || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
let audioCtx = null;
function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();
    const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u);
  } catch {}
}
function beep(times = 2) {
  if (!audioCtx) return;
  for (let i = 0; i < times; i++) {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination);
    const t0 = audioCtx.currentTime + i * 0.25;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
    o.start(t0); o.stop(t0 + 0.2);
  }
}
function say(text, level = 'info', onend) {
  if (level !== 'narr') S.lastText = text;
  window.__spoken = (window.__spoken || []).concat([{ text, level, t: Date.now() }]); // para pruebas
  if (level === 'urgente') { beep(3); navigator.vibrate?.([300, 100, 300]); }
  else if (level === 'aviso' || level === 'info') beep(1); // la voz de la app va precedida de un pitido
  // Si el navegador no avisa del final de la voz, seguimos igualmente pasado un tiempo prudente.
  let done = false;
  const finish = () => { if (!done) { done = true; onend?.(); } };
  if (onend) setTimeout(finish, 1500 + text.length * 75);
  if (!('speechSynthesis' in window)) { if (onend) setTimeout(finish, 1500); return; }
  if (level === 'urgente') speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'es-ES'; if (esVoice) u.voice = esVoice;
  u.rate = level === 'urgente' ? 1.1 : 1.0; u.volume = 1;
  if (level === 'callA') u.pitch = 0.8;   // las dos voces de la llamada suenan distintas
  if (level === 'callB') { u.pitch = 1.3; u.rate = 1.05; }
  u.onend = finish;
  speechSynthesis.speak(u);
}

// ---------- Arranque / parada ----------
async function start(mode, scn) {
  unlockAudio();
  S.mode = mode; S.active = true; S.spoken.clear(); S.lastTop = null; S.history = [];
  S.track = { status: mode === 'sim' ? 'ok' : 'unknown', id: null, checkedAt: 0, at: null, misses: 0 };
  show('scr-drive');
  const useMap = S.view === 'map' && mode !== 'sim';
  $('scr-drive').classList.toggle('with-map', useMap);
  $('scr-drive').classList.toggle('sim', mode === 'sim');
  $('map').hidden = !useMap;
  $('sim-view').hidden = mode !== 'sim';
  $('sim-result').hidden = true;
  $('sim-ctrl').hidden = mode !== 'sim';
  $('mode-tag').textContent = mode === 'sim' ? 'Simulación' : 'Cabina';
  $('mode-tag').className = 'tag' + (mode === 'sim' ? ' sim' : '');
  setActive(true);
  try { S.wakeLock = await navigator.wakeLock?.request('screen'); } catch {}

  if (mode === 'sim') {
    S.sim = new Simulation(scn); S.simRate = 1; $('btn-fast').textContent = 'Ir más rápido';
    initScheme($('sim-svg'), spanFor(scn));
    S.simDone = false;
    say('Simulación en marcha. Avisos activos.', 'info');
  } else {
    S.sim = null;
    if (!navigator.geolocation) { toast('Este navegador no da ubicación.'); return; }
    S.watchId = navigator.geolocation.watchPosition(onFix, onFixErr,
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    say('Avisos activos. Esperando posición GPS.', 'info');
  }
  if (useMap) initMap();
  if (S.showPublic && mode !== 'sim') { pollPublic(); S.pubTimer = setInterval(pollPublic, 20000); }
  S.timer = setInterval(tick, 1000);
  tick();
}
function stop() {
  clearInterval(S.timer); clearInterval(S.pubTimer);
  if (S.watchId != null) navigator.geolocation.clearWatch(S.watchId);
  S.watchId = null; S.sim = null; S.fix = null; S.prevFix = null;
  try { speechSynthesis.cancel(); } catch {}
  S.wakeLock?.release?.(); S.wakeLock = null;
  if (S.map) { S.map.remove(); S.map = null; S.layers = {}; }
  show('scr-home');
}
$('btn-stop').onclick = stop;
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && S.timer && !S.wakeLock) {
    try { S.wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
  }
});

function setActive(on) {
  S.active = on;
  const b = $('btn-active');
  b.textContent = on ? 'Avisos: activos' : 'Avisos: en pausa';
  b.classList.toggle('off', !on);
}
$('btn-active').onclick = () => { setActive(!S.active); say(S.active ? 'Avisos activos.' : 'Avisos en pausa.', 'info'); };
$('btn-mute').onclick = () => { S.mutedUntil = Date.now() + 60000; toast('Avisos leves silenciados 1 minuto. Los urgentes siguen sonando.'); };
$('btn-repeat').onclick = () => { if (S.lastText) say(S.lastText, S.lastTop?.level || 'info'); };
$('btn-fast').onclick = (e) => { S.simRate = S.simRate === 4 ? 1 : 4; e.target.textContent = S.simRate === 4 ? 'Velocidad normal' : 'Ir más rápido'; };
$('btn-brake').onclick = () => { if (S.sim) S.sim.braking = true; };
$('btn-release').onclick = () => { if (S.sim) S.sim.braking = false; };

// ---------- GPS real ----------
function onFix(p) {
  const c = p.coords;
  const now = p.timestamp || Date.now();
  let speed = c.speed, heading = c.heading;
  if (S.fix) {
    const dt = (now - S.fix.t) / 1000;
    const d = distance(S.fix, { lat: c.latitude, lon: c.longitude });
    if ((speed == null || isNaN(speed)) && dt > 0) speed = d / dt;
    if ((heading == null || isNaN(heading)) && d > 5) heading = bearing(S.fix, { lat: c.latitude, lon: c.longitude });
  }
  if (heading == null || isNaN(heading)) heading = S.fix?.heading ?? null;
  S.prevFix = S.fix;
  S.fix = { lat: c.latitude, lon: c.longitude, speed: speed || 0, heading, accuracy: c.accuracy || 30, t: now };
  S.history.push({ t: now, speed: S.fix.speed });
  if (S.history.length > 900) S.history.shift();
  checkTrack();
}
function onFixErr(e) {
  if (e.code === 1) { toast('Sin permiso de ubicación. Actívalo en Ajustes > Safari > Ubicación.', 6000); say('No tengo permiso de ubicación.', 'aviso'); }
}
function ownState() {
  if (S.sim) {
    const f = S.sim.ownFix();
    const lost = S.sim.inGpsLoss();
    if (lost) {
      // En túnel: no recibimos fix; estimamos por velocidad y rumbo (dead reckoning).
      S._lostFrom = S._lostFrom ?? S.sim.t;
      return { ...f, ageS: S.sim.t - S._lostFrom, estimated: true };
    }
    S._lostFrom = null;
    return { ...f, ageS: 0 };
  }
  if (!S.fix) return null;
  const ageS = (Date.now() - S.fix.t) / 1000;
  let pos = { lat: S.fix.lat, lon: S.fix.lon };
  if (ageS > 3 && S.fix.heading != null && S.fix.speed > 1) pos = move(pos, S.fix.heading, S.fix.speed * Math.min(ageS, 120));
  return { ...pos, speed: S.fix.speed, heading: S.fix.heading, accuracy: S.fix.accuracy, ageS,
    estimated: ageS > 3 && S.fix.speed > 1, trackId: S.track.id, trackStatus: S.track.status };
}

// Comprueba con OpenStreetMap si hay una vía a menos de 30 m.
async function checkTrack() {
  const f = S.fix; if (!f) return;
  const now = Date.now();
  const moved = S.track.at ? distance(S.track.at, f) : Infinity;
  if (now - S.track.checkedAt < 15000 || (moved < 150 && S.track.status !== 'unknown')) return;
  S.track.checkedAt = now; S.track.at = { lat: f.lat, lon: f.lon };
  const r = Math.max(30, Math.min(60, f.accuracy * 1.5));
  const q = `[out:json][timeout:10];way(around:${r},${f.lat},${f.lon})[railway~"^(rail|light_rail|narrow_gauge|subway)$"];out ids tags;`;
  try {
    const res = await fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(q),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const j = await res.json();
    if (j.elements?.length) {
      S.track.status = 'ok'; S.track.misses = 0;
      // Solo usamos un identificador de vía si OSM trae el número de vía (railway:track_ref).
      // El id del tramo OSM no sirve: una misma vía está partida en muchos tramos.
      const w = j.elements[0];
      S.track.id = w.tags?.['railway:track_ref'] ? (w.tags.ref || '') + '#' + w.tags['railway:track_ref'] : null;
    } else {
      S.track.misses++;
      if (S.track.misses >= 2) { S.track.status = 'none'; S.track.id = null; }
    }
  } catch { S.track.status = 'unknown'; }
}

// ---------- Trenes de datos públicos ----------
async function pollPublic() {
  let okAny = false;
  for (const url of PUBLIC_FEEDS) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const j = await res.json();
      ingestPublic(j); okAny = true;
    } catch { /* CORS o red */ }
  }
  S.publicStatus = okAny ? 'ok' : 'blocked';
}
function ingestPublic(j) {
  const nowS = Date.now() / 1000;
  for (const e of j.entity || []) {
    const v = e.vehicle; const p = v?.position; if (!p) continue;
    const id = 'R' + (v.vehicle?.label || v.vehicle?.id || e.id);
    const ts = Number(v.timestamp || j.header?.timestamp || nowS);
    const cur = { lat: p.latitude, lon: p.longitude, ts };
    const old = S.publicTrains.get(id);
    let speed = p.speed ?? null, heading = p.bearing ?? null;
    if (old && ts > old.ts) {
      const d = distance(old, cur), dt = ts - old.ts;
      if (speed == null) speed = d / dt;
      if (heading == null && d > 20) heading = bearing(old, cur);
    } else if (old) { speed = speed ?? old.speed; heading = heading ?? old.heading; }
    S.publicTrains.set(id, { ...cur, speed, heading, label: v.vehicle?.label || e.id });
  }
}
function publicOthers(own) {
  if (!S.showPublic || !own) return [];
  const nowS = Date.now() / 1000, out = [];
  for (const [id, t] of S.publicTrains) {
    const age = nowS - t.ts;
    if (age > 300) continue;
    if (distance(own, t) > 30000) continue;
    out.push({ id, lat: t.lat, lon: t.lon, speed: t.speed, heading: t.heading, accuracy: 50, ageS: age,
      source: 'renfe', stopped: false, degraded: false });
  }
  return out;
}

// ---------- Bucle principal ----------
function tick() {
  if (S.sim) for (let i = 0; i < (S.simRate || 1); i++) S.sim.step(1);
  const own = ownState();
  renderTags(own);
  if (!own) { setStatus('none', 'Esperando posición GPS…'); return; }
  $('speed').firstChild.nodeValue = String(Math.round(own.speed * 3.6));

  const others = [...(S.sim ? S.sim.otherTrains() : []), ...publicOthers(own)];
  const { alerts, targets } = evaluate(own, others, DEFAULTS);
  window.__last = { own, alerts, targets }; // para pruebas

  if (S.mode === 'real') motionPrompt(own);

  const top = alerts[0] || null;
  setStatus(top?.level || 'none', top ? top.text : (others.length ? 'Sin riesgo detectado' : 'Sin trenes cerca'));
  $('alert-list').replaceChildren(...alerts.slice(1, 4).map((a) => {
    const d = document.createElement('div'); d.textContent = a.text; return d;
  }));
  speakPolicy(alerts);
  if (S.map) renderMap(own, others, targets);
  if (S.sim && !S.simDone) {
    renderScheme($('sim-svg'), S.sim, own);
    $('sim-explain').textContent = explainNow(S.sim, own, top);
    const r = S.sim.result();
    if (r) {
      S.simDone = true;
      clearInterval(S.timer); S.timer = null;
      $('sim-result-t').textContent = r.text;
      $('sim-result').hidden = false; $('sim-ctrl').hidden = true;
      say(r.text, 'info');
    }
  }
}

function speakPolicy(alerts) {
  if (!S.active) return;
  const now = Date.now() / 1000;
  const live = new Set(alerts.map((a) => a.key));
  // Riesgo despejado
  for (const [k, v] of S.spoken) {
    if (!live.has(k)) {
      if (levelRank(v.level) >= 2) say('Riesgo despejado.', 'info');
      S.spoken.delete(k);
    }
  }
  const top = alerts[0];
  S.lastTop = top || null;
  if (!top) return;
  if (top.level !== 'urgente' && Date.now() < S.mutedUntil) return;
  const prev = S.spoken.get(top.key);
  const due = !prev || levelRank(top.level) > levelRank(prev.level) || now - prev.t > COOLDOWN[top.level];
  if (due) {
    say(top.text, top.level);
    S.spoken.set(top.key, { level: top.level, t: now });
  } else if (prev && levelRank(top.level) < levelRank(prev.level)) {
    prev.level = top.level; // bajó de nivel: se recuerda sin repetir
  }
}

function motionPrompt(own) {
  const m = motionState(S.history, Date.now());
  const now = Date.now();
  if (now - S.motionPromptAt < 300000) return;
  if (!S.active && m === 'moving') {
    S.motionPromptAt = now; say('Parece que estás en marcha. Toca el botón para activar los avisos.', 'info');
    toast('Parece que estás en marcha. ¿Activar avisos?', 6000);
  } else if (S.active && m === 'stopped-long') {
    S.motionPromptAt = now; toast('Llevas 10 minutos parado. Puedes poner los avisos en pausa.', 6000);
  }
}

function setStatus(level, text) {
  const el = $('status'); el.className = 'status lvl-' + level; el.textContent = text;
}
function renderTags(own) {
  const g = $('gps-tag'), t = $('track-tag');
  if (!own) { g.textContent = 'GPS —'; g.className = 'tag'; }
  else if (own.estimated) { g.textContent = `GPS estimado (${Math.round(own.ageS)} s)`; g.className = 'tag bad'; }
  else { g.textContent = `GPS ±${Math.round(own.accuracy)} m`; g.className = 'tag ok'; }
  const ts = own?.trackStatus ?? S.track.status;
  t.textContent = ts === 'ok' ? 'Vía confirmada' : ts === 'none' ? 'Vía no confirmada' : 'Vía —';
  t.className = 'tag' + (ts === 'ok' ? ' ok' : ts === 'none' ? ' bad' : '');
  if (S.showPublic && S.publicStatus === 'blocked') t.title = 'Datos públicos no disponibles en este navegador';
}

// ---------- Mapa ----------
function initMap() {
  if (!window.L) { toast('No se pudo cargar el mapa. Sigue en modo voz.'); return; }
  const c = S.sim ? ORIGIN : (S.fix || { lat: 40.4, lon: -3.7 });
  S.map = L.map('map', { zoomControl: false, attributionControl: true }).setView([c.lat, c.lon], 13);
  if (S.sim) {
    L.tileLayer('data:image/gif;base64,R0lGODlhAQABAAAAACw=', { attribution: 'Simulación · posiciones ficticias' }).addTo(S.map);
    // Dibujar dos vías paralelas ficticias
    const a = move(ORIGIN, 250, 2000), b = move(ORIGIN, 70, 20000);
    const a2 = move(a, 160, 4.5), b2 = move(b, 160, 4.5);
    L.polyline([[a.lat, a.lon], [b.lat, b.lon]], { color: '#5b6b7a', weight: 3 }).addTo(S.map);
    L.polyline([[a2.lat, a2.lon], [b2.lat, b2.lon]], { color: '#5b6b7a', weight: 3, dashArray: '6 6' }).addTo(S.map);
  } else {
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(S.map);
    L.tileLayer('https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenRailwayMap' }).addTo(S.map);
  }
  S.layers.others = L.layerGroup().addTo(S.map);
}
const LVL_COLOR = { none: '#94a3b8', info: '#38bdf8', aviso: '#f59e0b', urgente: '#ef4444' };
function renderMap(own, others, targets) {
  const lv = new Map(targets.map((t) => [t.id, t.level]));
  if (!S.layers.own) S.layers.own = L.circleMarker([own.lat, own.lon], { radius: 9, color: '#fff', weight: 3, fillColor: '#3b82f6', fillOpacity: 1 }).addTo(S.map);
  S.layers.own.setLatLng([own.lat, own.lon]);
  S.layers.others.clearLayers();
  for (const o of others) {
    const col = o.source === 'renfe' ? '#64748b' : LVL_COLOR[lv.get(o.id) || 'none'];
    L.circleMarker([o.lat, o.lon], { radius: 7, color: '#fff', weight: 2, fillColor: col, fillOpacity: 1 })
      .bindTooltip(o.source === 'renfe' ? `Dato público · ${Math.round(o.ageS)} s` : `Tren ${o.id}`)
      .addTo(S.layers.others);
  }
  S.map.panTo([own.lat, own.lon], { animate: false });
}

// ---------- Restaurar preferencias ----------
S.view = 'voice';
$('seg-view').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.view));
S.showPublic = false;
$('chk-public').checked = S.showPublic;
if (store.get('ais.terms')) show('scr-home');

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
