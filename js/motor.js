// VIDEO-FREE · Motor de dibujo propio (Canvas 2D, sin librerías).
// Regla de oro: todo lo que se dibuja depende solo del tiempo `t` (segundos) y del proyecto.
// Así la vista previa y el video exportado salen idénticos.

export const limitar = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const mezcla = (a, b, k) => a + (b - a) * k;
/** Lleva t del rango [a,b] al rango [c,d], sin salirse. */
export const tramo = (t, a, b, c = 0, d = 1) => (b === a ? d : mezcla(c, d, limitar((t - a) / (b - a))));
export const suave = (k) => k * k * (3 - 2 * k);
/** Entrada con resorte sin rebote: 0 → 1. */
export const resorte = (t, rapidez = 9) => (t <= 0 ? 0 : 1 - Math.exp(-rapidez * t) * (1 + rapidez * t));
/** Número pseudoaleatorio fijo (0..1) para una semilla: siempre da lo mismo. */
export const azar = (n) => {
  let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
};
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
export const mezclarColor = (a, b, k) => {
  const [x, y] = [hex(a), hex(b)];
  return `rgb(${x.map((v, i) => Math.round(mezcla(v, y[i], limitar(k)))).join(",")})`;
};
export const conAlfa = (c, alfa) => { const [r, g, b] = hex(c); return `rgba(${r},${g},${b},${alfa})`; };
/** Color según la hora (0 tarde → 1 noche) entre varias paradas [[hora, "#color"], …]. */
export const colorHora = (h, paradas) => {
  for (let i = 0; i < paradas.length - 1; i++) {
    if (h <= paradas[i + 1][0]) return mezclarColor(paradas[i][1], paradas[i + 1][1], (h - paradas[i][0]) / (paradas[i + 1][0] - paradas[i][0]));
  }
  return paradas[paradas.length - 1][1];
};
/** Golpe al ritmo: vale 1 justo en el pulso y cae rápido. */
export const pulso = (t, bpm, cada = 1) => Math.exp(-(((t * bpm) / 60 / cada) % 1) * 6);

export const FORMATOS = {
  horizontal: { ancho: 1920, alto: 1080, nombre: "Horizontal 16:9 (YouTube)" },
  vertical: { ancho: 1080, alto: 1920, nombre: "Vertical 9:16 (Reels, TikTok, Shorts)" },
  cuadrado: { ancho: 1080, alto: 1080, nombre: "Cuadrado 1:1" },
  portada: { ancho: 3000, alto: 3000, nombre: "Portada 3000 × 3000" },
};
const TITULAR = 'Impact, "Haettenschweiler", "Arial Narrow Bold", "Arial Black", sans-serif';
const TEXTO = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

// ───────────────────────── Voz ─────────────────────────
/** Energía de la voz (0..1) en el instante t, según el análisis guardado en el proyecto. */
export const energiaVoz = (p, t) => {
  const v = p.voz; if (!v || !v.energia || !v.energia.length) return 0;
  const i = t / v.paso, a = Math.floor(i);
  const e0 = v.energia[limitar(a, 0, v.energia.length - 1)] || 0, e1 = v.energia[limitar(a + 1, 0, v.energia.length - 1)] || 0;
  return mezcla(e0, e1, i - a);
};

// ───────────────────────── Piezas ─────────────────────────
function cielo(c, W, H, hora, t, hor) {
  const g = c.createLinearGradient(0, 0, 0, H * hor);
  g.addColorStop(0, colorHora(hora, [[0, "#4a8fd4"], [0.35, "#6a7fc9"], [0.5, "#5b3f8f"], [0.75, "#1b1e4a"], [1, "#05070f"]]));
  g.addColorStop(0.7, colorHora(hora, [[0, "#9cc6ea"], [0.35, "#f2a65e"], [0.5, "#e8604a"], [0.75, "#3a2f6b"], [1, "#0b1024"]]));
  g.addColorStop(1, colorHora(hora, [[0, "#ffe2a8"], [0.35, "#ffc36b"], [0.5, "#ff8a3d"], [0.75, "#8a4a6e"], [1, "#16203f"]]));
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  const estrellas = limitar((hora - 0.6) / 0.4);
  if (estrellas > 0) {
    c.fillStyle = "#fff";
    for (let i = 0; i < 150; i++) {
      c.globalAlpha = estrellas * (0.55 + 0.45 * Math.sin(t * (2 + azar(i + 900) * 3) + i));
      c.beginPath(); c.arc(azar(i) * W, azar(i + 300) * H * hor * 0.95, 0.7 + azar(i + 600) * 1.8 * (W / 1920 + 0.4), 0, 7); c.fill();
    }
    c.globalAlpha = 1;
  }
  const r = Math.min(W, H) * 0.07;
  if (hora < 0.62) {
    const col = colorHora(hora, [[0, "#fff3c4"], [0.4, "#ffd27a"], [0.6, "#ff6a3d"]]);
    c.save(); c.shadowColor = col; c.shadowBlur = r * 1.6; c.fillStyle = col;
    c.beginPath(); c.arc(W * 0.68, (0.18 + hora * 0.62) * H * (hor / 0.62), r, 0, 7); c.fill(); c.restore();
  }
  if (hora > 0.82) {
    c.save(); c.globalAlpha = limitar((hora - 0.82) / 0.12); c.shadowColor = "rgba(200,220,255,.7)"; c.shadowBlur = r;
    c.fillStyle = "#e9eef8"; c.beginPath(); c.arc(W * 0.2, H * 0.13, r * 0.55, 0, 7); c.fill(); c.restore();
  }
}

/** Sierra continua: se puede desplazar (para el paisaje que pasa junto al auto). */
function sierra(c, W, base, altura, corrimiento, semilla, color) {
  c.fillStyle = color; c.beginPath(); c.moveTo(0, base);
  for (let x = 0; x <= W; x += W / 96) {
    const u = (x + corrimiento) / W;
    const y = 0.5 + 0.28 * Math.sin(u * 5.1 + semilla) + 0.16 * Math.sin(u * 11.7 + semilla * 2.3) + 0.06 * Math.sin(u * 27.3 + semilla * 5);
    c.lineTo(x, base - altura * limitar(y, 0.05, 1));
  }
  c.lineTo(W, base); c.closePath(); c.fill();
}

function paisaje(c, W, H, hora, hor, avance = 0) {
  const hy = H * hor;
  sierra(c, W, hy, H * 0.17, avance * 0.15, 1.3, colorHora(hora, [[0, "#8a7bb0"], [0.5, "#7a3f6a"], [1, "#0e1430"]]));
  sierra(c, W, hy + 2, H * 0.09, avance * 0.35, 4.1, colorHora(hora, [[0, "#5c4a6e"], [0.5, "#3f1f3f"], [1, "#070a18"]]));
  c.fillStyle = colorHora(hora, [[0, "#c98d5a"], [0.5, "#8c4a32"], [1, "#0b0d18"]]);
  c.fillRect(0, hy, W, H - hy);
}

/** Carretera vista desde el auto, con rayas que avanzan hacia la cámara. */
function carreteraFrente(c, W, H, hora, t, hor, velocidad = 1) {
  const hy = H * hor, asfalto = colorHora(hora, [[0, "#3b3434"], [0.5, "#2a2026"], [1, "#07080d"]]);
  const linea = colorHora(hora, [[0, "#f6e7c4"], [0.6, "#ffd28a"], [1, "#d9e6ff"]]);
  c.fillStyle = asfalto; c.beginPath();
  c.moveTo(W * 0.49, hy); c.lineTo(W * 0.51, hy); c.lineTo(W * 0.98, H); c.lineTo(W * 0.02, H); c.closePath(); c.fill();
  c.strokeStyle = linea; c.globalAlpha = 0.5; c.lineWidth = Math.max(2, W / 640);
  c.beginPath(); c.moveTo(W * 0.493, hy); c.lineTo(W * 0.06, H); c.moveTo(W * 0.507, hy); c.lineTo(W * 0.94, H); c.stroke();
  c.globalAlpha = 0.85; c.fillStyle = linea;
  const N = 12, av = (t * 1.05 * velocidad) % 1, p = (z) => Math.pow(z, 2.2);
  for (let i = 0; i < N; i++) {
    const z0 = (i + av) / N, z1 = Math.min(1, (i + av + 0.45) / N);
    const y0 = hy + (H - hy) * p(z0), y1 = hy + (H - hy) * p(z1), w0 = (2 + 26 * p(z0)) * (W / 1920), w1 = (2 + 26 * p(z1)) * (W / 1920);
    c.beginPath(); c.moveTo(W / 2 - w0 / 2, y0); c.lineTo(W / 2 + w0 / 2, y0); c.lineTo(W / 2 + w1 / 2, y1); c.lineTo(W / 2 - w1 / 2, y1); c.fill();
  }
  c.globalAlpha = 1;
  const faros = limitar((hora - 0.6) / 0.25);
  if (faros > 0) {
    const g = c.createRadialGradient(W / 2, H, 0, W / 2, H, (H - hy) * 0.95);
    g.addColorStop(0, `rgba(255,244,214,${0.5 * faros})`); g.addColorStop(1, "rgba(255,244,214,0)");
    c.fillStyle = g; c.beginPath();
    c.moveTo(W * 0.3, H); c.lineTo(W * 0.47, hy + (H - hy) * 0.15); c.lineTo(W * 0.53, hy + (H - hy) * 0.15); c.lineTo(W * 0.7, H); c.fill();
  }
}

/** Convertible clásico negro de perfil, dibujado a mano con trazos (mira a la derecha). L = largo en píxeles. */
function auto(c, x, ySuelo, L, hora, giro, opciones = {}) {
  const u = (a, b) => [x + a * L, ySuelo - b * L];
  const noche = limitar((hora - 0.55) / 0.3);
  c.save();
  c.fillStyle = "rgba(0,0,0,.45)"; c.beginPath(); c.ellipse(x + L * 0.5, ySuelo + L * 0.005, L * 0.5, L * 0.022, 0, 0, 7); c.fill();
  if (noche > 0 && opciones.luces !== false) { // luz trasera roja y faro delantero
    let g = c.createRadialGradient(...u(0.0, 0.115), 0, ...u(0.0, 0.115), L * 0.16);
    g.addColorStop(0, `rgba(255,40,30,${0.75 * noche})`); g.addColorStop(1, "rgba(255,40,30,0)");
    c.fillStyle = g; c.fillRect(x - L * 0.2, ySuelo - L * 0.3, L * 0.4, L * 0.4);
    g = c.createLinearGradient(x + L, 0, x + L * 1.5, 0);
    g.addColorStop(0, `rgba(255,240,200,${0.5 * noche})`); g.addColorStop(1, "rgba(255,240,200,0)");
    c.fillStyle = g; c.beginPath(); c.moveTo(...u(0.985, 0.125)); c.lineTo(...u(1.5, 0.2)); c.lineTo(...u(1.5, 0.0)); c.fill();
  }
  // silueta del conductor
  if (opciones.conductor !== false) {
    c.fillStyle = "#0d0b10"; c.beginPath(); c.arc(...u(0.4, 0.2), L * 0.028, 0, 7); c.fill();
    c.beginPath(); c.ellipse(...u(0.395, 0.15), L * 0.038, L * 0.03, 0, 0, 7); c.fill();
  }
  c.fillStyle = "#050506"; for (const cx of [0.2, 0.8]) { c.beginPath(); c.arc(...u(cx, 0.045), L * 0.086, 0, 7); c.fill(); } // guardabarros
  // carrocería
  const brillo = colorHora(hora, [[0, "#3a3540"], [0.5, "#4a2c30"], [1, "#1a2238"]]);
  const g = c.createLinearGradient(0, ySuelo - L * 0.2, 0, ySuelo - L * 0.03);
  g.addColorStop(0, brillo); g.addColorStop(0.45, "#0b0a0d"); g.addColorStop(1, "#050506");
  c.fillStyle = g; c.beginPath();
  c.moveTo(...u(0.02, 0.04)); c.lineTo(...u(0.0, 0.1)); c.quadraticCurveTo(...u(0.0, 0.15), ...u(0.05, 0.155));
  c.lineTo(...u(0.27, 0.165)); c.quadraticCurveTo(...u(0.31, 0.135), ...u(0.46, 0.14)); // hueco de la cabina
  c.lineTo(...u(0.55, 0.165)); c.quadraticCurveTo(...u(0.8, 0.16), ...u(0.96, 0.135));
  c.quadraticCurveTo(...u(1.0, 0.125), ...u(0.995, 0.085)); c.lineTo(...u(0.98, 0.04));
  c.lineTo(...u(0.885, 0.04)); c.arc(...u(0.8, 0.045), L * 0.085, 0, Math.PI, true);
  c.lineTo(...u(0.285, 0.04)); c.arc(...u(0.2, 0.045), L * 0.085, 0, Math.PI, true); c.closePath(); c.fill();
  // parabrisas
  c.strokeStyle = "#c9ccd6"; c.lineWidth = L * 0.008; c.lineCap = "round";
  c.beginPath(); c.moveTo(...u(0.555, 0.165)); c.lineTo(...u(0.5, 0.235)); c.stroke();
  c.fillStyle = "rgba(170,200,230,.16)"; c.beginPath(); c.moveTo(...u(0.555, 0.165)); c.lineTo(...u(0.5, 0.235)); c.lineTo(...u(0.47, 0.145)); c.fill();
  // franja blanca y cromados
  c.strokeStyle = "#f1eee6"; c.lineWidth = L * 0.007; c.beginPath(); c.moveTo(...u(0.03, 0.118)); c.lineTo(...u(0.97, 0.112)); c.stroke();
  c.strokeStyle = "#9aa0ad"; c.lineWidth = L * 0.01; c.beginPath(); c.moveTo(...u(-0.005, 0.07)); c.lineTo(...u(0.06, 0.07)); c.moveTo(...u(0.94, 0.07)); c.lineTo(...u(1.005, 0.07)); c.stroke();
  c.fillStyle = noche > 0 ? "#ff3b2e" : "#8a1a16"; c.fillRect(x - L * 0.002, ySuelo - L * 0.128, L * 0.012, L * 0.03);
  c.fillStyle = noche > 0 ? "#fff3c9" : "#d8d2c0"; c.beginPath(); c.arc(...u(0.985, 0.118), L * 0.012, 0, 7); c.fill();
  // ruedas
  for (const cx of [0.2, 0.8]) {
    const [rx, ry] = u(cx, 0.045), R = L * 0.068;
    c.fillStyle = "#08080a"; c.beginPath(); c.arc(rx, ry, R, 0, 7); c.fill();
    c.fillStyle = "#b9bcc6"; c.beginPath(); c.arc(rx, ry, R * 0.62, 0, 7); c.fill();
    c.strokeStyle = "#3b3d45"; c.lineWidth = R * 0.12;
    for (let i = 0; i < 5; i++) { const a = giro + (i * Math.PI * 2) / 5; c.beginPath(); c.moveTo(rx, ry); c.lineTo(rx + Math.cos(a) * R * 0.58, ry + Math.sin(a) * R * 0.58); c.stroke(); }
    c.fillStyle = "#e6e8ee"; c.beginPath(); c.arc(rx, ry, R * 0.16, 0, 7); c.fill();
  }
  c.restore();
}

/** Personaje recortado (PNG sin fondo): entra suave, respira y puede volverse fantasma. */
function personaje(c, img, W, H, o) {
  if (!img) return;
  const alto = H * o.alto, ancho = alto * (img.width / img.height);
  const ent = resorte(o.t, 7), resp = 1 + Math.sin(o.t * 1.4) * 0.006;
  let alfa = ent * (o.alfa ?? 1), blur = 0;
  if (o.fantasma) {
    alfa = (o.t < 0.8 ? tramo(o.t, 0, 0.8, 0, 0.6) : tramo(o.t, 2.2, 3.7, 0.5, 0)) * (0.85 + 0.15 * Math.sin(o.t * 27));
    blur = tramo(o.t, 2, 3.7, 1, 12) * (W / 1920);
  }
  if (alfa <= 0.003) return;
  c.save();
  c.translate(W * o.x, H * o.base + (1 - ent) * 40);
  c.rotate((Math.sin(o.t * 2) * 0.4 * Math.PI) / 180);
  c.scale((o.espejo ? -1 : 1) * resp, resp);
  c.globalAlpha = alfa;
  if (o.fantasma) { c.globalCompositeOperation = "screen"; c.filter = `blur(${blur.toFixed(1)}px) saturate(.6) brightness(1.15)`; }
  c.shadowColor = o.brillo || "rgba(255,170,90,.5)";
  c.shadowBlur = (40 + 70 * (o.voz || 0)) * (W / 1920 + 0.3); // el halo crece cuando suena la voz
  c.drawImage(img, -ancho / 2, -alto, ancho, alto);
  c.restore();
}

function texto(c, txt, x, y, o) {
  c.save();
  c.font = `${o.peso || 400} ${o.tam}px ${o.fuente || TEXTO}`;
  c.textAlign = o.alinear || "center"; c.textBaseline = o.base || "alphabetic";
  if (o.espaciado && "letterSpacing" in c) c.letterSpacing = `${o.espaciado * o.tam}px`;
  if (o.maxAncho) { // si el texto no cabe (por ejemplo, un título largo), se encoge hasta caber
    const ancho = c.measureText(txt).width;
    if (ancho > o.maxAncho) { const k = o.maxAncho / ancho; c.font = `${o.peso || 400} ${o.tam * k}px ${o.fuente || TEXTO}`; if (o.espaciado && "letterSpacing" in c) c.letterSpacing = `${o.espaciado * o.tam * k}px`; }
  }
  c.globalAlpha = o.alfa ?? 1;
  if (o.sombra) { c.shadowColor = o.sombra; c.shadowBlur = o.tam * (o.sombraTam || 0.35); c.shadowOffsetY = o.tam * 0.04; }
  c.fillStyle = o.color || "#fff"; c.fillText(txt, x, y);
  c.restore();
}

// ───────────────────────── Escenas ─────────────────────────
const brilloHora = (hora) => (hora < 0.6 ? "rgba(255,150,70,.6)" : "rgba(80,180,255,.5)");

const ESCENAS = {
  /** Paisaje que pasa con el convertible de perfil. Con `conTitulo` muestra artista y canción. */
  auto(c, W, H, e, tl, dur, p, R, t) {
    const v = H > W, hor = v ? 0.6 : 0.66, hora = tramo(tl, 0, dur, ...(e.hora || [0.3, 0.45]));
    cielo(c, W, H, hora, t, hor); paisaje(c, W, H, hora, hor, t * W * 0.25);
    const ys = H * (hor + (v ? 0.14 : 0.2));
    c.fillStyle = colorHora(hora, [[0, "#3b3434"], [0.5, "#2a2026"], [1, "#07080d"]]); c.fillRect(0, ys - H * 0.02, W, H * 0.09);
    c.fillStyle = colorHora(hora, [[0, "#f6e7c4"], [1, "#d9e6ff"]]); c.globalAlpha = 0.7;
    const paso = W * 0.16, corr = (t * W * 0.9) % paso;
    for (let x = -corr; x < W; x += paso) c.fillRect(x, ys + H * 0.022, paso * 0.45, H * 0.006);
    c.globalAlpha = 1;
    const L = W * (v ? 0.8 : 0.42), x = W * (v ? 0.1 : mezcla(0.24, 0.34, tl / dur)) + Math.sin(t * 1.3) * W * 0.004;
    auto(c, x, ys + Math.sin(t * 9) * H * 0.0012, L, hora, t * 14);
    if (e.conTitulo) {
      const g = c.createLinearGradient(0, 0, 0, H * 0.5); g.addColorStop(0, "rgba(8,6,14,.7)"); g.addColorStop(1, "rgba(8,6,14,0)");
      c.fillStyle = g; c.fillRect(0, 0, W, H * 0.5);
      const m = Math.min(W, H), a1 = resorte(tl - 0.3), a2 = resorte(tl - 0.8), y0 = H * (v ? 0.2 : 0.22);
      texto(c, (p.artista || "").toUpperCase(), W / 2, y0 - (1 - a1) * 20, { tam: m * 0.03, peso: 600, espaciado: 0.45, alfa: a1, color: p.colores.texto });
      texto(c, (p.titulo || "").toUpperCase(), W / 2, y0 + m * (v ? 0.17 : 0.2) + (1 - a2) * 30, { tam: m * (v ? 0.15 : 0.19), fuente: TITULAR, maxAncho: W * 0.9, alfa: a2, color: p.colores.texto, sombra: conAlfa(p.colores.acento, 0.55) });
    }
  },
  titulo(c, W, H, e, tl, dur, p, R, t) { ESCENAS.auto(c, W, H, { hora: [0.3, 0.42], ...e, conTitulo: true }, tl, dur, p, R, t); },

  /**
   * Tomas tipo dron siguiendo al auto. `angulos` es la lista de tomas que se van alternando
   * ("cenital" desde arriba, "persecucion" desde atrás, "lateral" de perfil) y `cada` los segundos por toma.
   */
  dron(c, W, H, e, tl, dur, p, R, t) {
    const lista = e.angulos || [e.angulo || "cenital"], cada = e.cada || (60 / p.bpm) * 8;
    const n = Math.floor(tl / cada), ang = lista[n % lista.length], tt = tl - n * cada; // tt = tiempo dentro de la toma
    const hora = tramo(tl, 0, dur, ...(e.hora || [0.3, 0.6])), noche = limitar((hora - 0.55) / 0.3);
    if (ang === "lateral") return ESCENAS.auto(c, W, H, { hora: [hora, hora] }, tl, dur, p, R, t);
    if (ang === "persecucion") {
      const hor = 0.52, vaiven = Math.sin(t * 0.7) * W * 0.012;
      cielo(c, W, H, hora, t, hor); paisaje(c, W, H, hora, hor); carreteraFrente(c, W, H, hora, t, hor, 1.4);
      const A = W * (H > W ? 0.62 : 0.3) * tramo(tt, 0, cada, 0.9, 1.08), x = W / 2 + vaiven, y = H * 0.9 + Math.sin(t * 11) * H * 0.0015;
      c.save(); c.translate(x, y);
      c.fillStyle = "rgba(0,0,0,.5)"; c.beginPath(); c.ellipse(0, A * 0.02, A * 0.56, A * 0.05, 0, 0, 7); c.fill();
      c.fillStyle = "#060607"; c.fillRect(-A * 0.47, -A * 0.12, A * 0.13, A * 0.14); c.fillRect(A * 0.34, -A * 0.12, A * 0.13, A * 0.14); // ruedas
      const g = c.createLinearGradient(0, -A * 0.36, 0, 0); g.addColorStop(0, colorHora(hora, [[0, "#3a3540"], [0.5, "#4a2c30"], [1, "#1a2238"]])); g.addColorStop(0.5, "#0b0a0d"); g.addColorStop(1, "#040405");
      c.fillStyle = g; c.beginPath(); c.moveTo(-A * 0.5, -A * 0.06); c.quadraticCurveTo(-A * 0.52, -A * 0.3, -A * 0.44, -A * 0.34);
      c.lineTo(A * 0.44, -A * 0.34); c.quadraticCurveTo(A * 0.52, -A * 0.3, A * 0.5, -A * 0.06); c.closePath(); c.fill();
      c.strokeStyle = "#c9ccd6"; c.lineWidth = A * 0.012; c.strokeRect(-A * 0.36, -A * 0.56, A * 0.72, A * 0.2); // marco del parabrisas
      c.fillStyle = "rgba(170,200,230,.1)"; c.fillRect(-A * 0.36, -A * 0.56, A * 0.72, A * 0.2);
      c.fillStyle = "#17131a"; for (const sx of [-0.2, 0.2]) { c.beginPath(); c.roundRect(sx * A - A * 0.1, -A * 0.46, A * 0.2, A * 0.14, A * 0.03); c.fill(); } // espaldares
      c.fillStyle = "#0d0b10"; c.beginPath(); c.arc(-A * 0.2, -A * 0.5, A * 0.055, 0, 7); c.fill(); // conductor
      c.fillStyle = "#f1eee6"; c.fillRect(-A * 0.07, -A * 0.34, A * 0.045, A * 0.2); c.fillRect(A * 0.025, -A * 0.34, A * 0.045, A * 0.2); // franjas
      c.shadowColor = "#ff2a1e"; c.shadowBlur = A * (0.03 + 0.12 * noche); c.fillStyle = noche > 0 ? "#ff3b2e" : "#a3201a";
      c.fillRect(-A * 0.46, -A * 0.25, A * 0.2, A * 0.045); c.fillRect(A * 0.26, -A * 0.25, A * 0.2, A * 0.045); c.shadowBlur = 0;
      c.fillStyle = "#9aa0ad"; c.fillRect(-A * 0.5, -A * 0.11, A, A * 0.035); // parachoques
      c.restore(); return;
    }
    // Cenital: el dron mira hacia abajo y gira despacio mientras el auto avanza
    const m = Math.max(W, H), zoom = tramo(tt, 0, cada, 1.25, 0.95), giro = Math.sin(t * 0.25) * 0.18 + (n % 2 ? 0.5 : -0.35);
    c.save(); c.translate(W / 2, H / 2); c.rotate(giro); c.scale(zoom, zoom);
    c.fillStyle = colorHora(hora, [[0, "#c79a68"], [0.5, "#96543a"], [1, "#0c0e1a"]]); c.fillRect(-m * 1.5, -m * 1.5, m * 3, m * 3);
    const corr = t * m * 0.55, cel = m * 0.09;
    for (let i = 0; i < 260; i++) { // matorrales y piedras que pasan
      const lado = azar(i) < 0.5 ? -1 : 1, x = lado * (m * 0.13 + azar(i + 500) * m * 1.2), y = ((azar(i + 1000) * m * 3 + corr) % (m * 3)) - m * 1.5, r = cel * (0.08 + azar(i + 1500) * 0.3);
      c.fillStyle = azar(i + 2000) < 0.6 ? colorHora(hora, [[0, "#6f7a45"], [0.5, "#4d4a2e"], [1, "#0a1210"]]) : colorHora(hora, [[0, "#a47a50"], [0.5, "#74402c"], [1, "#090a12"]]);
      c.beginPath(); c.ellipse(x, y, r * (1 + azar(i + 2500)), r, azar(i + 3000) * 3, 0, 7); c.fill();
      c.fillStyle = "rgba(0,0,0,.22)"; c.beginPath(); c.ellipse(x + r * 0.6, y + r * 0.5, r, r * 0.6, 0, 0, 7); c.fill();
    }
    const aR = m * 0.11; // ancho de la carretera
    c.fillStyle = colorHora(hora, [[0, "#3b3636"], [0.5, "#2a2226"], [1, "#07080d"]]); c.fillRect(-aR, -m * 1.5, aR * 2, m * 3);
    c.fillStyle = colorHora(hora, [[0, "#f3e6c6"], [1, "#b9c6e6"]]); c.globalAlpha = 0.75;
    c.fillRect(-aR * 0.94, -m * 1.5, aR * 0.035, m * 3); c.fillRect(aR * 0.905, -m * 1.5, aR * 0.035, m * 3);
    const raya = m * 0.12; for (let y = -m * 1.5 + (corr % raya) - raya; y < m * 1.5; y += raya) c.fillRect(-aR * 0.025, y, aR * 0.05, raya * 0.45);
    c.globalAlpha = 1;
    // auto visto desde arriba (avanza hacia arriba), por el carril derecho
    const Lc = m * 0.2, Ac = Lc * 0.42; c.translate(aR * 0.45 + Math.sin(t * 0.9) * aR * 0.05, m * 0.03);
    if (noche > 0) { const g = c.createLinearGradient(0, -Lc * 0.5, 0, -Lc * 1.9); g.addColorStop(0, `rgba(255,240,200,${0.55 * noche})`); g.addColorStop(1, "rgba(255,240,200,0)"); c.fillStyle = g; c.beginPath(); c.moveTo(-Ac * 0.4, -Lc * 0.5); c.lineTo(-Ac * 1.5, -Lc * 1.9); c.lineTo(Ac * 1.5, -Lc * 1.9); c.lineTo(Ac * 0.4, -Lc * 0.5); c.fill(); }
    c.fillStyle = "rgba(0,0,0,.4)"; c.beginPath(); c.roundRect(-Ac / 2 + Lc * 0.07, -Lc / 2 + Lc * 0.06, Ac, Lc, Ac * 0.2); c.fill();
    const gc = c.createLinearGradient(-Ac / 2, 0, Ac / 2, 0); gc.addColorStop(0, "#050506"); gc.addColorStop(0.5, colorHora(hora, [[0, "#34303a"], [0.5, "#40282c"], [1, "#161d30"]])); gc.addColorStop(1, "#050506");
    c.fillStyle = gc; c.beginPath(); c.roundRect(-Ac / 2, -Lc / 2, Ac, Lc, [Ac * 0.24, Ac * 0.24, Ac * 0.16, Ac * 0.16]); c.fill();
    c.fillStyle = "#f1eee6"; c.fillRect(-Ac * 0.14, -Lc / 2, Ac * 0.09, Lc * 0.4); c.fillRect(Ac * 0.05, -Lc / 2, Ac * 0.09, Lc * 0.4); c.fillRect(-Ac * 0.14, Lc * 0.28, Ac * 0.09, Lc * 0.22); c.fillRect(Ac * 0.05, Lc * 0.28, Ac * 0.09, Lc * 0.22);
    c.fillStyle = "#1c171d"; c.beginPath(); c.roundRect(-Ac * 0.4, -Lc * 0.08, Ac * 0.8, Lc * 0.34, Ac * 0.08); c.fill(); // cabina abierta
    c.fillStyle = "#2a2229"; for (const sx of [-0.2, 0.2]) { c.beginPath(); c.roundRect(sx * Ac - Ac * 0.15, 0, Ac * 0.3, Lc * 0.12, Ac * 0.05); c.fill(); }
    c.fillStyle = "rgba(170,200,230,.35)"; c.beginPath(); c.roundRect(-Ac * 0.4, -Lc * 0.13, Ac * 0.8, Lc * 0.05, Ac * 0.03); c.fill(); // parabrisas
    c.fillStyle = "#2b1d12"; c.beginPath(); c.arc(-Ac * 0.2, Lc * 0.02, Ac * 0.1, 0, 7); c.fill(); // cabeza del conductor
    c.fillStyle = noche > 0 ? "#ff3b2e" : "#8a1a16"; c.fillRect(-Ac * 0.42, Lc * 0.47, Ac * 0.26, Lc * 0.02); c.fillRect(Ac * 0.16, Lc * 0.47, Ac * 0.26, Lc * 0.02);
    c.restore();
  },

  /** La carretera vista de frente, el personaje a un lado y, si se pide, ella como fantasma. */
  carretera(c, W, H, e, tl, dur, p, R, t) {
    const v = H > W, hor = 0.62, hora = tramo(tl, 0, dur, ...(e.hora || [0.1, 0.45])), izq = (e.lado || "izquierda") === "izquierda";
    cielo(c, W, H, hora, t, hor); paisaje(c, W, H, hora, hor); carreteraFrente(c, W, H, hora, t, hor);
    if (e.fantasma) personaje(c, R.img[e.fantasma], W, H, { alto: v ? 0.3 : 0.42, x: v ? 0.5 : izq ? 0.66 : 0.4, base: v ? 0.7 : 0.86, t: tl - dur * 0.35, fantasma: true, brillo: "rgba(190,230,255,.9)" });
    if (e.personaje) personaje(c, R.img[e.personaje], W, H, { alto: v ? 0.5 : 0.8, x: v ? 0.5 : (izq ? 0.23 : 0.77) + tramo(tl, 0, dur, 0, izq ? 0.02 : -0.02), base: 1, t: tl, brillo: brilloHora(hora), voz: p.vozReactiva === false ? 0 : energiaVoz(p, t) });
  },

  /** Recuerdo cálido: luz dorada, polvo flotando y parpadeo de película vieja. */
  recuerdo(c, W, H, e, tl, dur, p, R, t) {
    const v = H > W, g = c.createRadialGradient(W * 0.6, H * 0.4, 0, W * 0.6, H * 0.4, Math.max(W, H) * 0.8);
    g.addColorStop(0, "#ffd9a0"); g.addColorStop(0.45, "#c8743a"); g.addColorStop(1, "#3a1c14");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    const z = tramo(tl, 0, dur, 1, 1.06);
    c.save(); c.translate(W / 2, H); c.scale(z, z); c.translate(-W / 2, -H);
    personaje(c, R.img[e.personaje], W, H, { alto: v ? 0.55 : 0.9, x: 0.5, base: v ? 0.82 : 1, t: tl, alfa: tramo(tl, dur * 0.72, dur, 1, 0), brillo: "rgba(255,210,140,.9)" });
    c.restore();
    c.fillStyle = "#fff3d6";
    for (let i = 0; i < 60; i++) {
      c.globalAlpha = 0.25 + azar(i + 40) * 0.4;
      const x = (azar(i) * W + t * 30 * (0.4 + azar(i + 80))) % W, y = (((azar(i + 120) * H - t * 18 * azar(i + 160)) % H) + H) % H;
      c.beginPath(); c.arc(x, y, (1 + azar(i + 200) * 3) * (W / 1920 + 0.3), 0, 7); c.fill();
    }
    c.globalAlpha = 0.08 * azar(Math.floor(t * 30)); c.fillStyle = "#000"; c.fillRect(0, 0, W, H); c.globalAlpha = 1;
    if (e.objeto) texto(c, e.objeto.toUpperCase(), W / 2, H * 0.14, { tam: Math.min(W, H) * 0.022, peso: 600, espaciado: 0.3, color: "#fff1dc", alfa: tramo(tl, dur * 0.55, dur * 0.7) * tramo(tl, dur * 0.85, dur * 0.97, 0.8, 0) });
  },

  /** Cierre: noche, el auto detenido en la berma, él de pie mirando el horizonte y los créditos. */
  cierre(c, W, H, e, tl, dur, p, R, t) {
    const v = H > W, hor = 0.64, z = tramo(tl, 0, dur, 1.1, 1);
    c.save(); c.translate(W / 2, H * 0.6); c.scale(z, z); c.translate(-W / 2, -H * 0.6);
    cielo(c, W, H, 1, t, hor); paisaje(c, W, H, 1, hor);
    const ys = H * (v ? 0.8 : 0.74);
    c.fillStyle = "#07080d"; c.fillRect(0, ys - H * 0.015, W, H);
    auto(c, W * (v ? 0.06 : 0.2), ys, W * (v ? 0.62 : 0.34), 1, 0, { conductor: false });
    if (e.personaje) personaje(c, R.img[e.personaje], W, H, { alto: v ? 0.2 : 0.3, x: v ? 0.8 : 0.62, base: (ys + H * 0.01) / H, t: tl, espejo: true, brillo: "rgba(90,170,255,.5)" });
    c.restore();
    const m = Math.min(W, H), a = resorte(tl - dur * 0.3, 5);
    texto(c, (p.artista || "").toUpperCase(), W / 2, H * (v ? 0.32 : 0.24) + (1 - a) * 20, { tam: m * 0.13, fuente: TITULAR, maxAncho: W * 0.9, alfa: a, color: p.colores.texto });
    texto(c, (p.titulo || "").toUpperCase(), W / 2, H * (v ? 0.32 : 0.24) + m * 0.06, { tam: m * 0.026, peso: 600, espaciado: 0.4, alfa: a, color: p.colores.acentoNoche });
  },

  /** Una foto a pantalla completa con zoom lento. */
  foto(c, W, H, e, tl, dur, p, R) { cubrir(c, R.img[e.imagen], W, H, tramo(tl, 0, dur, ...(e.zoom || [1.05, 1.18]))); },

  /** Un clip de video (por ejemplo una toma generada con IA) a pantalla completa. */
  video(c, W, H, e, tl, dur, p, R) {
    const vid = R.video[e.archivo]; if (!vid) return;
    const objetivo = (e.inicioClip || 0) + tl;
    if (Math.abs(vid.currentTime - objetivo) > (R.reproduciendo ? 0.35 : 0.04)) vid.currentTime = objetivo;
    if (R.reproduciendo && vid.paused) vid.play().catch(() => {}); else if (!R.reproduciendo && !vid.paused) vid.pause();
    cubrir(c, vid, W, H, 1, vid.videoWidth, vid.videoHeight);
  },
};
export const TIPOS_ESCENA = Object.keys(ESCENAS);

function cubrir(c, img, W, H, zoom = 1, iw = img?.width, ih = img?.height) {
  c.fillStyle = "#000"; c.fillRect(0, 0, W, H);
  if (!img || !iw) return;
  const k = Math.max(W / iw, H / ih) * zoom;
  c.drawImage(img, (W - iw * k) / 2, (H - ih * k) / 2, iw * k, ih * k);
}

// ───────────────────────── Letra (karaoke) ─────────────────────────
/** Palabras de una línea con sus tiempos; si no los tiene, los reparte según el largo de cada palabra. */
export const palabrasDe = (l) => {
  if (l.palabras && l.palabras.length) return l.palabras;
  const ps = l.texto.split(/\s+/).filter(Boolean), pesos = ps.map((x) => x.length + 2), total = pesos.reduce((a, b) => a + b, 0);
  let t = l.inicio;
  return ps.map((x, i) => { const d = (pesos[i] / total) * (l.fin - l.inicio); const r = { p: x, inicio: t, fin: t + d }; t += d; return r; });
};

function letra(c, W, H, p, t, o = {}) {
  const l = (p.letra || []).find((x) => t >= x.inicio - 0.25 && t <= x.fin + 0.35);
  if (!l) return;
  const v = H > W, alfa = tramo(t, l.inicio - 0.25, l.inicio) * tramo(t, l.fin, l.fin + 0.35, 1, 0);
  const tam = (v ? W * 0.072 : H * 0.058) * (o.tam || 1), ps = palabrasDe(l);
  c.save(); c.font = `800 ${tam}px ${TEXTO}`; c.textBaseline = "middle"; c.textAlign = "left";
  const esp = tam * 0.3, maxAncho = W * 0.86, renglones = [[]]; let ancho = 0;
  for (const w of ps) {
    const a = c.measureText(w.p).width;
    if (ancho + a > maxAncho && renglones.at(-1).length) { renglones.push([]); ancho = 0; }
    renglones.at(-1).push({ ...w, a }); ancho += a + esp;
  }
  const altoR = tam * 1.2, total = renglones.length * altoR;
  let y = o.centro ? H / 2 - total / 2 + altoR / 2 : v ? H * 0.12 + altoR / 2 : H * 0.89 - total + altoR / 2 - (W > H ? H * 0.075 : 0);
  y += (1 - alfa) * 18;
  c.shadowColor = "rgba(0,0,0,.8)"; c.shadowBlur = tam * 0.3; c.shadowOffsetY = tam * 0.05;
  for (const r of renglones) {
    let x = W / 2 - (r.reduce((s, w) => s + w.a, 0) + esp * (r.length - 1)) / 2;
    for (const w of r) {
      const k = tramo(t, w.inicio, w.inicio + 0.12);
      c.globalAlpha = alfa * (0.55 + 0.45 * k);
      c.fillStyle = k > 0.5 ? p.colores.acento : p.colores.texto;
      c.fillText(w.p, x, y); x += w.a + esp;
    }
    y += altoR;
  }
  c.restore();
}

/** Línea melódica: dibuja las notas que canta la voz alrededor del instante actual. */
function lineaMelodica(c, W, H, p, t, y0, alto) {
  const v = p.voz; if (!v || !v.tono) return;
  const vals = v.tono.filter((n) => n > 0); if (!vals.length) return;
  const min = Math.min(...vals) - 1, max = Math.max(...vals) + 1, ventana = 4;
  c.save(); c.lineWidth = Math.max(3, W / 400); c.lineCap = "round"; c.strokeStyle = p.colores.acento;
  c.shadowColor = p.colores.acento; c.shadowBlur = 18;
  let abierto = false; c.beginPath();
  for (let i = Math.max(0, Math.floor((t - ventana) / v.paso)); i < Math.min(v.tono.length, (t + ventana) / v.paso); i++) {
    const n = v.tono[i]; if (!(n > 0)) { abierto = false; continue; }
    const x = W / 2 + ((i * v.paso - t) / ventana) * W * 0.42, y = y0 + alto - ((n - min) / (max - min)) * alto;
    abierto ? c.lineTo(x, y) : c.moveTo(x, y); abierto = true;
  }
  c.globalAlpha = 0.9; c.stroke();
  c.fillStyle = "#fff"; c.globalAlpha = 0.5 + 0.5 * energiaVoz(p, t); c.beginPath(); c.arc(W / 2, y0 + alto + 14, 5 + 10 * energiaVoz(p, t), 0, 7); c.fill();
  c.restore();
}

// ───────────────────────── Acabado de cine ─────────────────────────
let granos = null, capa = null;
function acabado(c, W, H, t, o = {}) {
  const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.55);
  g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${o.vineta ?? 0.55})`);
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  if (!granos && typeof document !== "undefined") {
    granos = [0, 1, 2, 3].map((k) => {
      const lienzo = document.createElement("canvas"); lienzo.width = lienzo.height = 256;
      const x = lienzo.getContext("2d"), d = x.createImageData(256, 256);
      for (let i = 0; i < 65536; i++) { const n = azar(i + k * 70001) * 255; d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = n; d.data[i * 4 + 3] = 255; }
      x.putImageData(d, 0, 0); return lienzo;
    });
  }
  if (granos && (o.grano ?? 0.07) > 0) {
    c.save(); c.globalAlpha = o.grano ?? 0.07; c.globalCompositeOperation = "overlay";
    c.fillStyle = c.createPattern(granos[Math.floor(t * 24) % 4], "repeat"); c.fillRect(0, 0, W, H); c.restore();
  }
  if (o.franjas && W > H) { c.fillStyle = "#000"; c.fillRect(0, 0, W, H * 0.075); c.fillRect(0, H * 0.925, W, H * 0.075); }
}

// ───────────────────────── Dibujo principal ─────────────────────────
/**
 * Dibuja el fotograma del instante t.
 * R = recursos cargados: { img: {ruta: Image}, video: {ruta: HTMLVideoElement}, reproduciendo }
 * modo: "video" (escenas) | "lyric" (letra grande + línea melódica) | "portada"
 */
export function dibujar(c, W, H, p, t, R, modo = "video") {
  c.save(); c.fillStyle = "#000"; c.fillRect(0, 0, W, H);
  if (modo === "portada") {
    cielo(c, W, H, 0.48, 0, 0.66); paisaje(c, W, H, 0.48, 0.66);
    auto(c, W * 0.5, H * 0.8, W * 0.62, 0.48, 0.4);
    const e = p.escenas.find((x) => x.personaje);
    if (e) personaje(c, R.img[e.personaje], W, H, { alto: 0.74, x: 0.3, base: 1, t: 9, brillo: "rgba(255,140,60,.6)" });
    texto(c, (p.artista || "").toUpperCase(), W / 2, H * 0.09, { tam: W * 0.028, peso: 600, espaciado: 0.45, color: p.colores.texto });
    texto(c, (p.titulo || "").toUpperCase(), W / 2, H * 0.23, { tam: W * 0.14, fuente: TITULAR, maxAncho: W * 0.9, color: p.colores.texto, sombra: "rgba(0,0,0,.5)" });
    acabado(c, W, H, 0, { vineta: 0.45 }); c.restore(); return;
  }
  if (modo === "lyric") {
    const g = c.createLinearGradient(0, 0, W, H), k = 0.5 + 0.5 * Math.sin(t * 0.15);
    g.addColorStop(0, mezclarColor("#1b1030", "#0b1024", k)); g.addColorStop(1, mezclarColor("#3a1c14", "#07060c", k));
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    const m = Math.min(W, H), gol = pulso(t, p.bpm);
    c.fillStyle = conAlfa(p.colores.acento, 0.05 + 0.05 * gol + 0.1 * energiaVoz(p, t));
    c.beginPath(); c.arc(W / 2, H / 2, m * (0.34 + 0.02 * gol + 0.05 * energiaVoz(p, t)), 0, 7); c.fill();
    texto(c, (p.titulo || "").toUpperCase(), W / 2, H * 0.15, { tam: m * 0.08, fuente: TITULAR, maxAncho: W * 0.9, color: p.colores.texto });
    texto(c, (p.artista || "").toUpperCase(), W / 2, H * 0.15 + m * 0.045, { tam: m * 0.022, peso: 600, espaciado: 0.4, color: p.colores.texto, alfa: 0.8 });
    lineaMelodica(c, W, H, p, t, H * 0.68, H * 0.16);
    letra(c, W, H, p, t, { centro: true, tam: 1.3 });
    acabado(c, W, H, t, { grano: 0.05 }); c.restore(); return;
  }
  const fund = 0.33; // segundos de fundido entre escenas
  for (const e of p.escenas) {
    if (t < e.desde || t >= e.hasta + fund) continue;
    const dur = e.hasta - e.desde, tl = t - e.desde;
    const alfa = Math.min(e.desde > 0 ? tramo(tl, 0, fund) : 1, e.hasta < p.duracion - 0.01 ? tramo(tl, dur, dur + fund, 1, 0) : 1);
    const pintar = ESCENAS[e.tipo] || ESCENAS.foto;
    // filtro: "byn" deja la escena en blanco y negro (para recuerdos), "calido" y "frio" cambian el tono
    const filtro = { byn: "grayscale(1) contrast(1.12)", calido: "sepia(.35) saturate(1.2)", frio: "saturate(.8) hue-rotate(-12deg) brightness(.95)" }[e.filtro] || "none";
    if (alfa >= 1 && filtro === "none") { c.save(); pintar(c, W, H, e, tl, dur + fund, p, R, t); c.restore(); continue; }
    // Durante el fundido la escena se pinta en una capa aparte y se mezcla con la anterior
    if (!capa || capa.width !== W || capa.height !== H) { capa = document.createElement("canvas"); capa.width = W; capa.height = H; }
    const cc = capa.getContext("2d");
    cc.save(); cc.clearRect(0, 0, W, H); pintar(cc, W, H, e, tl, dur + fund, p, R, t); cc.restore();
    c.save(); c.globalAlpha = alfa; c.filter = filtro; c.drawImage(capa, 0, 0); c.restore();
  }
  if (p.mostrarLetra !== false) letra(c, W, H, p, t);
  acabado(c, W, H, t, { franjas: true });
  c.restore();
}

/** Lista de imágenes y videos que el proyecto necesita cargar. */
export function mediosDe(p) {
  const img = new Set(), video = new Set();
  for (const e of p.escenas) {
    for (const k of ["personaje", "fantasma", "imagen"]) if (e[k]) img.add(e[k]);
    if (e.archivo) video.add(e.archivo);
  }
  return { img: [...img], video: [...video] };
}
