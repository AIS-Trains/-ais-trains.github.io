# AIS Cabina (prototipo)

App web (PWA) de avisos por voz para maquinistas, pensada como **complemento de último recurso**.
No sustituye a la señalización ni a los sistemas de protección del tren. El maquinista decide siempre.

- Usa el GPS del móvil (posición, velocidad, rumbo).
- Calcula el margen de frenado frente a otros trenes y avisa por voz.
- Avisa de "vía no confirmada" comparando la posición con las vías de OpenStreetMap.
- Alarma en ambas vías si un tren está detenido con sistemas degradados.
- Modo simulación con escenarios ficticios para probarla sin estar en cabina.
- Capa informativa opcional con posiciones de datos abiertos de transporte (15 a 30 s de retraso; nunca dispara "frena").

Acceso con código, que se entrega aparte. Es un prototipo: el código no es una protección real.

Ficheros: `engine.js` (motor de avisos, sin dependencias), `sim.js` (escenarios), `app.js` (interfaz, GPS, voz).
Mapa: Leaflet, © OpenStreetMap, © OpenRailwayMap.
