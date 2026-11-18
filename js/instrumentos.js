// VIDEO-FREE · Instrumentos y arreglista propios.
// Cada instrumento se sintetiza muestra por muestra: batería, bajo 808, guitarra (cuerda pulsada
// Karplus-Strong), piano (parciales con inarmonicidad), cuerdas (osciladores desafinados) y percusión.
// El arreglista arma la canción por secciones (intro, verso, coro, final) en la tonalidad de la voz.

import { SR, Biquad, generadorRuido, midiAHz, reverb, comprimir, limitar, respirar } from "./dsp.js";

const NOMBRES = ["Do", "Do#", "Re", "Re#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"];
const ESCALAS = { mayor: [0, 2, 4, 5, 7, 9, 11], menor: [0, 2, 3, 5, 7, 8, 10] };
// Progresiones por grados de la escala (0 = primer grado)
const PROGRESIONES = {
  menor: [[0, 5, 2, 6], [0, 3, 5, 4], [0, 6, 5, 6]],
  mayor: [[0, 4, 5, 3], [0, 5, 3, 4], [3, 4, 0, 0]],
};

export const ESTILOS = {
  reggaeton: { nombre: "Reggaetón", bpm: 95 },
  balada: { nombre: "Balada pop", bpm: 78 },
  trap: { nombre: "Trap latino", bpm: 140 },
};
export const INSTRUMENTOS = { bateria: "Batería", bajo: "Bajo 808", guitarra: "Guitarra", piano: "Piano", cuerdas: "Cuerdas", percusion: "Percusión" };

/** "La menor" → { raiz: 9, modo: "menor" }. */
export function leerTonalidad(txt) {
  const m = String(txt || "").match(/^(Do#|Do|Re#|Re|Mi|Fa#|Fa|Sol#|Sol|La#|La|Si) (mayor|menor)/);
  return m ? { raiz: NOMBRES.indexOf(m[1]), modo: m[2] } : { raiz: 9, modo: "menor" };
}
export const nombreTonalidad = (t) => `${NOMBRES[t.raiz]} ${t.modo}`;

// ───────────────────────── Mezclador ─────────────────────────
class Mesa {
  constructor(n) { this.L = new Float32Array(n); this.R = new Float32Array(n); this.eL = new Float32Array(n); this.eR = new Float32Array(n); this.n = n; }
  /** Suma un sonido mono en el segundo t, con volumen, paneo (-1 izquierda … 1 derecha) y envío a la reverb. */
  poner(t, x, vol = 1, pan = 0, envio = 0) {
    const i0 = Math.round(t * SR), gl = Math.cos(((pan + 1) * Math.PI) / 4) * vol, gr = Math.sin(((pan + 1) * Math.PI) / 4) * vol;
    for (let k = 0; k < x.length; k++) {
      const i = i0 + k; if (i < 0) continue; if (i >= this.n) break;
      const v = x[k]; this.L[i] += v * gl; this.R[i] += v * gr;
      if (envio) { this.eL[i] += v * gl * envio; this.eR[i] += v * gr * envio; }
    }
  }
}

// ───────────────────────── Instrumentos ─────────────────────────
const exp = Math.exp, sin = Math.sin, PI2 = Math.PI * 2;

function bombo(vel = 1, largo = 0.55) {
  const n = Math.round(largo * SR), x = new Float32Array(n), r = generadorRuido(11); let fase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR; fase += (PI2 * (44 + 115 * exp(-t * 32))) / SR;
    const cuerpo = sin(fase) * exp(-t * 6.5), golpe = i < SR * 0.004 ? r() * (1 - i / (SR * 0.004)) * 0.5 : 0;
    x[i] = Math.tanh((cuerpo + golpe) * 1.6) * vel;
  }
  return x;
}

function caja(vel = 1, semilla = 1) {
  const n = Math.round(0.28 * SR), x = new Float32Array(n), r = generadorRuido(semilla), bp = new Biquad("bandpass", 2100, 0.8), hp = new Biquad("highpass", 900);
  for (let i = 0; i < n; i++) {
    const t = i / SR, tono = (sin(PI2 * 185 * t) * 0.7 + sin(PI2 * 330 * t) * 0.35) * exp(-t * 28);
    // palmas: tres golpecitos de ruido muy juntos y luego la cola
    const palma = [0, 0.011, 0.022].reduce((a, d) => a + (t >= d ? exp(-(t - d) * 160) : 0), 0) * 0.6 + exp(-t * 17) * 0.55;
    x[i] = (tono * 0.55 + hp.paso(bp.paso(r())) * palma) * vel;
  }
  return x;
}

const FRECS_PLATILLO = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0].map((f) => f * 1.6);
function platillo(vel = 1, abierto = false, semilla = 3) {
  const largo = abierto ? 0.9 : 0.09, n = Math.round(largo * SR), x = new Float32Array(n), hp = new Biquad("highpass", 7200, 0.7), bp = new Biquad("bandpass", 10500, 0.6), r = generadorRuido(semilla);
  for (let i = 0; i < n; i++) {
    const t = i / SR; let m = 0; for (const f of FRECS_PLATILLO) m += Math.sign(sin(PI2 * f * t));
    x[i] = bp.paso(hp.paso(m * 0.12 + r() * 0.25)) * exp(-t * (abierto ? 4.5 : 48)) * vel;
  }
  return x;
}

function crash(vel = 1) { const x = platillo(vel, true, 9), r = generadorRuido(19), hp = new Biquad("highpass", 4000); for (let i = 0; i < x.length; i++) x[i] = x[i] * 1.2 + hp.paso(r()) * exp(-(i / SR) * 3) * 0.25 * vel; return x; }

function subida(seg) { // ruido que sube antes del coro
  const n = Math.round(seg * SR), x = new Float32Array(n), r = generadorRuido(23), bp = new Biquad("bandpass", 400, 1.2);
  for (let i = 0; i < n; i++) { const k = i / n; if (i % 64 === 0) bp.ajustar("bandpass", 300 + 7000 * k * k, 1.4); x[i] = bp.paso(r()) * k * k * 0.5; }
  return x;
}

function bajo808(midi, dur, desdeMidi = null, vel = 1) {
  const n = Math.round((dur + 0.06) * SR), x = new Float32Array(n), f1 = midiAHz(midi), f0 = desdeMidi ? midiAHz(desdeMidi) : f1; let fase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, f = f1 + (f0 - f1) * exp(-t * 45); fase += (PI2 * f) / SR;
    const env = Math.min(1, t / 0.004) * exp(-t * 0.9) * (t > dur ? exp(-(t - dur) * 120) : 1);
    x[i] = Math.tanh((sin(fase) + 0.18 * sin(2 * fase)) * 1.8) * 0.75 * env * vel;
  }
  return x;
}

/** Guitarra de nailon: cuerda pulsada (Karplus-Strong) con retardo fraccional y caja de resonancia. */
function guitarra(midi, dur = 1.6, vel = 1, semilla = 1) {
  const f = midiAHz(midi), periodo = SR / f, N = Math.floor(periodo - 0.5), frac = periodo - 0.5 - N, ap = (1 - frac) / (1 + frac);
  const n = Math.round((dur + 0.25) * SR), x = new Float32Array(n), b = new Float32Array(N + 2), r = generadorRuido(semilla);
  // excitación: ruido suavizado según la fuerza del toque y la posición de la uña
  let s = 0; const brillo = 0.35 + 0.5 * vel;
  for (let i = 0; i < b.length; i++) { s = s * (1 - brillo) + r() * brillo; b[i] = s; }
  const pos = Math.max(1, Math.round(N * 0.13)); for (let i = b.length - 1; i >= pos; i--) b[i] -= b[i - pos] * 0.9;
  const perdida = 0.4985 + 0.0013 * Math.min(1, 196 / f);
  let i = 0, previo = 0, apPrev = 0, apSal = 0;
  const cuerpo1 = new Biquad("peaking", 105, 1.2, 6), cuerpo2 = new Biquad("peaking", 220, 1.5, 4), suave = new Biquad("lowpass", 4800, 0.7);
  for (let k = 0; k < n; k++) {
    const actual = b[i], prom = (actual + previo) * perdida; previo = actual;
    apSal = ap * prom + apPrev - ap * apSal; apPrev = prom; // retardo fraccional (pasa-todo) para afinar
    b[i] = k > dur * SR ? apSal * 0.985 : apSal; // al soltar, la cuerda se apaga
    x[k] = suave.paso(cuerpo2.paso(cuerpo1.paso(actual))) * vel * 0.6;
    if (++i >= N) i = 0;
  }
  return x;
}

/** Piano: parciales con inarmonicidad, dos cuerdas por nota que baten un poco, y el golpe del martillo. */
function piano(midi, dur = 1, vel = 1, semilla = 1) {
  const f = midiAHz(midi), n = Math.round((dur + 0.35) * SR), x = new Float32Array(n), B = 0.00035, r = generadorRuido(semilla), lp = new Biquad("lowpass", 1800 + 4000 * vel);
  const parciales = []; for (let k = 1; k <= 12 && f * k < 9000; k++) parciales.push({ f: f * k * Math.sqrt(1 + B * k * k), a: (1 / k ** (1.4 - 0.5 * vel)) * (k === 1 ? 1 : 0.8), d: 0.5 + 0.38 * k, d2: 0.12 + 0.05 * k });
  for (let i = 0; i < n; i++) {
    const t = i / SR; let s = 0;
    for (const p of parciales) { const env = 0.7 * exp(-t * p.d) + 0.3 * exp(-t * p.d2); s += (sin(PI2 * p.f * t) + sin(PI2 * p.f * 1.0007 * t)) * p.a * env; }
    const martillo = t < 0.012 ? lp.paso(r()) * (1 - t / 0.012) * 0.3 : 0, suelta = t > dur ? exp(-(t - dur) * 14) : 1;
    x[i] = (s * 0.22 + martillo) * suelta * Math.min(1, t / 0.002) * vel;
  }
  return x;
}

/** Cuerdas: tres osciladores de sierra sin aliasing (polyBLEP) algo desafinados, con filtro y entrada lenta. */
function cuerdas(midi, dur, vel = 1, desafino = 0) {
  const n = Math.round((dur + 0.7) * SR), x = new Float32Array(n), lp = new Biquad("lowpass", 1700, 0.6), fs = [-0.11, 0, 0.12].map((c) => midiAHz(midi + c + desafino)), fases = [0.1, 0.4, 0.7];
  const blep = (t, dt) => (t < dt ? ((t /= dt), t + t - t * t - 1) : t > 1 - dt ? ((t = (t - 1) / dt), t * t + t + t + 1) : 0);
  for (let i = 0; i < n; i++) {
    const t = i / SR; let s = 0;
    fs.forEach((f, k) => { const dt = (f * (1 + 0.003 * sin(PI2 * 5.1 * t + k))) / SR; fases[k] = (fases[k] + dt) % 1; s += 2 * fases[k] - 1 - blep(fases[k], dt); });
    if (i % 32 === 0) lp.ajustar("lowpass", 1300 + 600 * sin(PI2 * 0.18 * t), 0.6);
    const env = Math.min(1, t / 0.45) * (t > dur ? exp(-(t - dur) * 5) : 1);
    x[i] = lp.paso(s / 3) * env * vel * 0.5;
  }
  return x;
}

/** Bongó o timbal: membrana con caída de afinación y golpe de mano. */
function membrana(hz, vel = 1, semilla = 5) {
  const n = Math.round(0.35 * SR), x = new Float32Array(n), r = generadorRuido(semilla), bp = new Biquad("bandpass", hz * 3, 1); let f1 = 0, f2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, caida = 1 + 0.25 * exp(-t * 40); f1 += (PI2 * hz * caida) / SR; f2 += (PI2 * hz * 1.59 * caida) / SR;
    x[i] = ((sin(f1) + 0.45 * sin(f2)) * exp(-t * 17) + bp.paso(r()) * exp(-t * 90) * 0.6) * vel * 0.7;
  }
  return x;
}

// ───────────────────────── Arreglista ─────────────────────────
/** Secciones por compás: intro hasta que empieza la letra, luego verso y coro alternados de 8 compases, y final. */
function secciones(p, compases, seg) {
  const primera = Math.min(...(p.letra || []).map((l) => l.inicio).filter((x) => x >= 0), p.duracion);
  const intro = Math.max(1, Math.min(8, Math.round(primera / seg))), out = [], bloque = compases - intro < 20 ? 4 : 8; // canciones cortas: bloques de 4 compases
  for (let c = 0; c < compases; c++) {
    if (c < intro) out.push("intro");
    else if (c >= compases - 2 && compases > intro + 4) out.push("final");
    else out.push(Math.floor((c - intro) / bloque) % 2 === 0 ? "verso" : "coro");
  }
  return out;
}

/**
 * Genera la pista instrumental. opciones: { estilo, tonalidad ("auto" o "La menor"), instrumentos: {bateria:true,…}, intensidad 0..1 }
 * Devuelve { L, R, info: { tonalidad, acordes, secciones } }.
 */
export async function generarArreglo(p, opciones = {}, progreso = () => {}) {
  const estilo = opciones.estilo || "reggaeton", usa = { bateria: true, bajo: true, guitarra: true, piano: true, cuerdas: true, percusion: true, ...(opciones.instrumentos || {}) };
  const ton = opciones.tonalidad && opciones.tonalidad !== "auto" ? leerTonalidad(opciones.tonalidad) : leerTonalidad(p.voz && p.voz.resumen && p.voz.resumen.tonalidades[0]);
  const bpm = p.bpm || ESTILOS[estilo].bpm, negra = 60 / bpm, paso = negra / 4, seg = negra * 4, n = Math.ceil(p.duracion * SR) + SR;
  const compases = Math.ceil(p.duracion / seg), sec = secciones(p, compases, seg), mesa = new Mesa(n), intensidad = opciones.intensidad ?? 0.8;
  const escala = ESCALAS[ton.modo], prog = PROGRESIONES[ton.modo][opciones.progresion || 0];
  const grado = (g, base) => base + escala[((g % 7) + 7) % 7] + 12 * Math.floor(g / 7);
  const raizBajo = 33 + ((ton.raiz - 9 + 12) % 12) + (ton.raiz < 4 ? 12 : 0); // entre La1 y Sol#2
  const acorde = (c) => { const g = prog[c % prog.length]; return [g, g + 2, g + 4].map((x) => grado(x, raizBajo)); };
  const azar = generadorRuido(77), humano = () => azar() * 0.006, vel = (v) => v * (0.9 + azar() * 0.1);
  const nombres = []; for (let c = 0; c < Math.min(4, compases); c++) { const m = acorde(c)[0], g = prog[c % prog.length]; const tercera = (escala[(g + 2) % 7] - escala[g % 7] + 12) % 12; nombres.push(NOMBRES[((m % 12) + 12) % 12] + (tercera === 3 ? "m" : "")); }

  const pasos = (c, lista, f) => lista.forEach((s) => f(c * seg + s * paso + humano(), s));
  for (let c = 0; c < compases; c++) {
    const s = sec[c], t0 = c * seg, ac = acorde(c), siguiente = sec[c + 1], fuerte = s === "coro", suave = s === "intro" || s === "final";
    const tonos = [...ac, ac[0] + 12]; // fundamental, tercera, quinta y octava
    // Batería
    if (usa.bateria && !suave) {
      if (estilo === "reggaeton") {
        pasos(c, [0, 4, 8, 12], (t) => mesa.poner(t, bombo(vel(1)), 0.95));
        pasos(c, [3, 6, 11, 14], (t, k) => mesa.poner(t, caja(vel(0.8), c * 16 + k), 0.55, 0.05, 0.12));
        pasos(c, fuerte ? [...Array(16).keys()] : [0, 2, 4, 6, 8, 10, 12, 14], (t, k) => mesa.poner(t, platillo(vel(k % 2 ? 0.5 : 0.9), false, c * 16 + k), 0.22 * intensidad, 0.35));
      } else if (estilo === "balada") {
        pasos(c, [0, 8, 10], (t, k) => mesa.poner(t, bombo(vel(k === 10 ? 0.6 : 0.85)), 0.8));
        pasos(c, [4, 12], (t, k) => mesa.poner(t, caja(vel(0.7), c * 16 + k), 0.45, 0.05, 0.25));
        pasos(c, [0, 2, 4, 6, 8, 10, 12, 14], (t, k) => mesa.poner(t, platillo(vel(0.7), false, c * 16 + k), 0.16 * intensidad, -0.3));
      } else {
        pasos(c, [0, 7, 10], (t) => mesa.poner(t, bombo(vel(1), 0.4), 0.9));
        pasos(c, [8], (t, k) => mesa.poner(t, caja(vel(0.95), c * 16 + k), 0.6, 0, 0.15));
        const hats = [...Array(16).keys()]; pasos(c, hats, (t, k) => mesa.poner(t, platillo(vel(0.7), false, c * 16 + k), 0.18 * intensidad, 0.3));
        if (fuerte) for (let r = 0; r < 6; r++) mesa.poner(t0 + 14 * paso + (r * paso * 2) / 6, platillo(0.5 + r * 0.06, false, c * 99 + r), 0.16, 0.3); // redoble de platillo
      }
      if (fuerte && sec[c - 1] !== "coro") mesa.poner(t0, crash(0.9), 0.3, -0.2, 0.3);
    }
    if (usa.bateria && siguiente === "coro" && s !== "coro") mesa.poner(t0, subida(seg), 0.35 * intensidad, 0, 0.4);
    // Bajo
    if (usa.bajo && !suave) {
      const pat = estilo === "reggaeton" ? [0, 3, 6, 8, 11, 14] : estilo === "balada" ? [0, 8] : [0, 10];
      pat.forEach((st, k) => {
        const fin = (pat[k + 1] ?? 16) * paso, nota = ac[0] + (estilo === "reggaeton" && st === 14 ? 7 : 0);
        mesa.poner(t0 + st * paso, bajo808(nota, fin - st * paso - 0.02, estilo === "trap" && st === 10 ? nota + 5 : null, 0.95), estilo === "trap" ? 0.55 : 0.42);
      });
    }
    // Guitarra
    if (usa.guitarra) {
      const g = tonos.map((m) => m + 24), pat = estilo === "reggaeton" ? [0, 2, 3, 5, 6, 8, 10, 11, 13, 14] : estilo === "balada" ? [0, 2, 4, 6, 8, 10, 12, 14] : [0, 3, 6, 10, 12];
      pat.forEach((st, k) => mesa.poner(t0 + st * paso + humano(), guitarra(g[[0, 2, 1, 3, 2, 1][k % 6]], paso * 3.5, vel(suave ? 0.55 : 0.75), c * 31 + k), suave ? 0.5 : 0.38, k % 2 ? 0.35 : -0.25, 0.25));
    }
    // Piano
    if (usa.piano && (fuerte || estilo === "balada" || (estilo === "trap" && !suave))) {
      if (estilo === "balada") [0, 2, 4, 6, 8, 10, 12, 14].forEach((st, k) => mesa.poner(t0 + st * paso + humano(), piano(tonos[[0, 2, 1, 3, 2, 1, 3, 1][k]] + 12, paso * 2.4, vel(0.6), c * 7 + k), 0.4, -0.15, 0.3));
      else if (estilo === "trap") [0, 3, 6, 10].forEach((st, k) => mesa.poner(t0 + st * paso, piano(tonos[[3, 1, 2, 0][k]] + 24, paso * 2, vel(0.55), c * 5 + k), 0.3, 0.2, 0.35));
      else [0, 8].forEach((st) => ac.forEach((m, k) => mesa.poner(t0 + st * paso + k * 0.004, piano(m + 24, seg / 2 - 0.05, vel(0.55), c * 3 + k + st), 0.28, -0.2, 0.3)));
    }
    // Cuerdas
    if (usa.cuerdas && (fuerte || suave || estilo === "balada")) ac.forEach((m, k) => mesa.poner(t0, cuerdas(m + 12 + (k === 0 ? 12 : 0), seg, fuerte ? 0.9 : 0.7, k * 0.05), (fuerte ? 0.2 : 0.16) * intensidad, [-0.5, 0, 0.5][k], 0.45));
    // Percusión
    if (usa.percusion && estilo === "reggaeton" && !suave) pasos(c, fuerte ? [2, 7, 10, 13, 15] : [2, 7, 10, 15], (t, k) => mesa.poner(t, membrana(k % 2 ? 330 : 240, vel(0.6), c * 13 + k), 0.24 * intensidad, k % 2 ? 0.5 : -0.5, 0.1));
    if (c % 4 === 3) { progreso((c + 1) / compases); await respirar(); }
  }
  // Acorde final que queda sonando
  if (usa.cuerdas || usa.piano) { const t = compases * seg, ac = acorde(0); if (t < p.duracion) ac.forEach((m, k) => mesa.poner(Math.min(t, p.duracion - 2), piano(m + 24, 1.6, 0.5, 900 + k), 0.3, 0, 0.4)); }

  await respirar(); reverb(mesa.eL, mesa.eR, { sala: 0.84, brillo: 0.4, mezcla: 1 });
  for (let i = 0; i < n; i++) { mesa.L[i] += mesa.eL[i] * 0.55; mesa.R[i] += mesa.eR[i] * 0.55; }
  comprimir(mesa.L, mesa.R, { umbral: -14, ratio: 2.5, ataque: 0.02, suelta: 0.2 });
  // Fundido final
  const fin = Math.ceil(p.duracion * SR), fo = Math.min(fin, Math.round(SR * 2.5));
  for (let i = 0; i < n; i++) { const k = i >= fin ? 0 : i > fin - fo ? (fin - i) / fo : 1; mesa.L[i] *= k; mesa.R[i] *= k; }
  limitar(mesa.L, mesa.R, { techo: -3 });
  progreso(1);
  return { L: mesa.L.subarray(0, fin), R: mesa.R.subarray(0, fin), info: { tonalidad: nombreTonalidad(ton), acordes: nombres, secciones: sec, estilo } };
}

/** Armonía de la pista: dado un segundo, devuelve las notas (0–11) del acorde que suena. La usa el cantante. */
export function armonia(p, opciones = {}) {
  const estilo = opciones.estilo || "reggaeton";
  const ton = opciones.tonalidad && opciones.tonalidad !== "auto" ? leerTonalidad(opciones.tonalidad) : leerTonalidad(p.voz && p.voz.resumen && p.voz.resumen.tonalidades[0]);
  const escala = ESCALAS[ton.modo], prog = PROGRESIONES[ton.modo][opciones.progresion || 0], seg = (60 / (p.bpm || ESTILOS[estilo].bpm)) * 4;
  const acordeEn = (t) => { const g = prog[Math.floor(Math.max(0, t) / seg) % prog.length]; return [g, g + 2, g + 4].map((x) => (ton.raiz + escala[x % 7]) % 12); };
  return { tonalidad: ton, escala: escala.map((e) => (ton.raiz + e) % 12), acordeEn };
}
