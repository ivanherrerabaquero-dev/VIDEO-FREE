// VIDEO-FREE · Cantante propio, en dos motores:
//
// 1. "sintetica": síntesis por formantes muestra por muestra, al estilo Klatt. Una fuente glotal con
//    pequeñas irregularidades humanas (jitter, shimmer, aire), un tracto vocal de cinco formantes que se
//    mueven de una vocal a otra (coarticulación), nasales con antirresonancia, consonantes con ruido
//    filtrado, portamento, vibrato que llega tarde y un doblaje de voz. Suena mucho mejor que una
//    síntesis simple, pero sigue siendo una voz sintética.
// 2. "mivoz": canta con TU timbre. Grabas las cinco vocales (a, e, i, o, u) y el estudio las reafina
//    nota por nota con PSOLA (suma solapada de granos sincronizados con cada periodo de la voz), que
//    cambia la altura sin cambiar el color de la voz. Las consonantes salen del motor sintético.
//
// La melodía sale de tu pista de voz analizada (proyecto.voz) o se compone sobre los acordes de la pista.

import { SR, Biquad, Resonador, Antirresonador, generadorRuido, midiAHz, reverb, comprimir, limitar, respirar } from "./dsp.js";
import { palabrasDe } from "./motor.js";
import { tonoDeVentana } from "./voz.js";

// ───────────────────────── Texto → fonemas ─────────────────────────
const VOCALES = "aeiou", FUERTES = "aeo";
export function fonemas(palabra) {
  const s = palabra.toLowerCase().normalize("NFD").replace(/ñ/g, "ñ").replace(/ü/g, "ü").replace(/[̀-ͯ]/g, "").replace(/[^a-zñü]/g, "");
  const f = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i], n = s[i + 1] || "";
    if (VOCALES.includes(c)) f.push(c);
    else if (c === "ü") f.push("u");
    else if (c === "h") continue;
    else if (c === "c" && n === "h") { f.push("ch"); i++; }
    else if (c === "l" && n === "l") { f.push("y"); i++; }
    else if (c === "r" && n === "r") { f.push("rr"); i++; }
    else if (c === "q") { f.push("k"); if (n === "u") i++; }
    else if (c === "g" && n === "u" && "ei".includes(s[i + 2] || "")) { f.push("g"); i++; }
    else if (c === "g" && "ei".includes(n)) f.push("j");
    else if (c === "c") f.push("ei".includes(n) ? "s" : "k");
    else if (c === "z") f.push("s");
    else if (c === "v" || c === "w") f.push("b");
    else if (c === "x") f.push("k", "s");
    else if (c === "y") f.push(n && VOCALES.includes(n) ? "y" : "i");
    else if (c === "r") f.push(i === 0 || "lns".includes(s[i - 1] || "") ? "rr" : "r");
    else f.push(c);
  }
  return f;
}

const DUR = { s: 0.09, f: 0.08, j: 0.085, ch: 0.095, p: 0.075, t: 0.07, k: 0.08, b: 0.055, d: 0.05, g: 0.055, m: 0.07, n: 0.065, ñ: 0.08, l: 0.06, y: 0.06, r: 0.03, rr: 0.1 };

/** Una palabra en trozos con tiempo: consonantes de duración natural y vocales que se llevan el resto. */
function trozos(palabra, t0, t1) {
  const f = fonemas(palabra); if (!f.length) return [];
  const esV = (x) => VOCALES.includes(x), nucleos = [];
  for (let i = 0; i < f.length; i++) if (esV(f[i])) {
    const ant = nucleos.at(-1);
    if (ant && ant.fin === i - 1 && !(FUERTES.includes(f[i]) && FUERTES.includes(f[i - 1]))) ant.fin = i; else nucleos.push({ ini: i, fin: i });
  }
  if (!nucleos.length) return [];
  let cons = f.reduce((a, x) => a + (esV(x) ? 0 : DUR[x] || 0.06), 0);
  const D = Math.max(0.1, t1 - t0), k = cons > D * 0.45 ? (D * 0.45) / cons : 1; cons *= k;
  const pesos = nucleos.map((_, i) => (i === nucleos.length - 1 ? 1.4 : 1)), suma = pesos.reduce((a, b) => a + b, 0), porVocal = (D - cons) / suma;
  const out = []; let t = t0;
  for (let i = 0; i < f.length; i++) {
    const x = f[i];
    if (!esV(x)) { const d = (DUR[x] || 0.06) * k; out.push({ f: x, t0: t, t1: t + d }); t += d; continue; }
    const ni = nucleos.findIndex((n) => i >= n.ini && i <= n.fin), n = nucleos[ni], largo = n.fin - n.ini + 1;
    let fuerte = -1; for (let j = 0; j < largo; j++) if (FUERTES.includes(f[n.ini + j])) { fuerte = j; break; }
    if (fuerte < 0) fuerte = largo - 1;
    const parte = largo === 1 ? 1 : i - n.ini === fuerte ? 1 - 0.28 * (largo - 1) : 0.28;
    const d = porVocal * pesos[ni] * parte;
    out.push({ f: x, t0: t, t1: t + d, silaba: ni, inicioSilaba: i === n.ini, ultimaSilaba: ni === nucleos.length - 1 }); t += d;
  }
  return out;
}

// ───────────────────────── Melodía ─────────────────────────
const NOMBRES = ["Do", "Do#", "Re", "Re#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"];
const ESCALAS = { mayor: [0, 2, 4, 5, 7, 9, 11], menor: [0, 2, 3, 5, 7, 8, 10] };
function contexto(p, opciones) {
  const txt = opciones.tonalidad && opciones.tonalidad !== "auto" ? opciones.tonalidad : (p.voz && p.voz.resumen && p.voz.resumen.tonalidades[0]) || "La menor";
  const m = txt.match(/^(Do#|Do|Re#|Re|Mi|Fa#|Fa|Sol#|Sol|La#|La|Si) (mayor|menor)/) || [0, "La", "menor"];
  const notas = ((p.voz && !p.voz.deCanto && p.voz.tono) || []).filter((n) => n > 0).sort((a, b) => a - b);
  const centro = notas.length ? notas[notas.length >> 1] : opciones.timbre === "femenina" ? 67 : 55;
  return { raiz: NOMBRES.indexOf(m[1]), modo: m[2], centro };
}

/**
 * La partitura: trozos {f, t0, t1, midi, linea, pausa}. opciones.melodia: "voz" sigue las notas de tu pista
 * (afinadas al semitono más cercano, como un afinador automático); "compuesta" crea una melodía por frases
 * sobre los acordes de la pista (opciones.armonia, si la hay).
 */
export function partitura(p, opciones = {}) {
  const { raiz, modo, centro } = contexto(p, opciones), v = p.voz && !p.voz.deCanto ? p.voz : null, oct = (opciones.octava || 0) * 12;
  const escalera = []; for (let m = Math.round(centro) - 9; m <= Math.round(centro) + 10; m++) if (ESCALAS[modo].includes((((m - raiz) % 12) + 12) % 12)) escalera.push(m);
  const medio = escalera.reduce((b, m, i) => (Math.abs(m - centro) < Math.abs(escalera[b] - centro) ? i : b), 0);
  const rnd = generadorRuido(4242), acordeEn = opciones.armonia ? opciones.armonia.acordeEn : null;
  const alAcorde = (i, t) => { // acerca un grado a la nota del acorde más cercana
    if (!acordeEn) return i; const ac = acordeEn(t); let mejor = i;
    for (let d = 0; d <= 2; d++) for (const s of [i - d, i + d]) if (s >= 0 && s < escalera.length && ac.includes(((escalera[s] % 12) + 12) % 12)) return s;
    return mejor;
  };
  const todo = [], motivos = [];
  for (const [li, l] of (p.letra || []).entries()) {
    const ps = palabrasDe(l), ts = [];
    ps.forEach((w, wi) => ts.push(...trozos(w.p, w.inicio, Math.max(w.inicio + 0.1, Math.min(w.fin, (ps[wi + 1] || {}).inicio ?? w.fin))).map((x) => ({ ...x, palabra: wi, ultimaPalabra: wi === ps.length - 1 }))));
    const silabas = ts.filter((x) => x.inicioSilaba), ns = silabas.length;
    // motivo de la frase: las líneas pares repiten el contorno de la anterior (estructura A A')
    const clave = li % 2 === 1 ? motivos[li - 1] : null;
    const contorno = clave || silabas.map((_, k) => { const x = k / Math.max(1, ns - 1); return Math.round(Math.sin(x * Math.PI * 0.9) * 3 + (rnd() > 0.6 ? Math.sign(rnd()) : 0)); });
    motivos[li] = contorno;
    let k = -1, midi = escalera[medio];
    for (const x of ts) {
      if (x.inicioSilaba) {
        k++;
        let g = medio + (contorno[k] ?? 0) + (li % 4 === 3 ? 1 : 0);
        const final = x.ultimaPalabra && x.ultimaSilaba;
        if (final || x.t1 - x.t0 > 0.35) g = alAcorde(g, x.t0); // notas largas y finales caen en el acorde
        if (final && li % 2 === 1) g = escalera.reduce((b, m, i) => ((((m - raiz) % 12) + 12) % 12 === 0 && Math.abs(i - medio) < Math.abs(b - medio) ? i : b), g); // cierra en la tónica
        midi = escalera[Math.max(0, Math.min(escalera.length - 1, g))];
        if (opciones.melodia !== "compuesta" && v && v.tono) {
          const fin = ts.filter((y) => y.palabra === x.palabra && y.silaba === x.silaba).at(-1).t1;
          const oidas = v.tono.slice(Math.floor(x.t0 / v.paso), Math.ceil(fin / v.paso) + 1).filter((n) => n > 0).sort((a, b) => a - b);
          if (oidas.length) midi = opciones.afinar === false ? oidas[oidas.length >> 1] : Math.round(oidas[oidas.length >> 1]);
        }
      }
      todo.push({ ...x, midi: midi + oct, linea: li });
    }
  }
  todo.forEach((x, i) => { const s = todo[i + 1]; x.pausa = !s || s.t0 - x.t1 > 0.08; });
  return todo;
}

// ───────────────────────── Tracto vocal ─────────────────────────
// Formantes del español (voz masculina): [F1, F2, F3] y anchos de banda [B1, B2, B3]
const FORM = {
  a: [[720, 1240, 2550], [90, 110, 160]], e: [[460, 1850, 2560], [70, 100, 150]], i: [[290, 2250, 2950], [55, 100, 160]],
  o: [[490, 900, 2500], [80, 100, 150]], u: [[320, 760, 2400], [60, 90, 140]],
  m: [[260, 1150, 2400], [70, 220, 260]], n: [[260, 1600, 2600], [70, 220, 260]], ñ: [[260, 2000, 2800], [70, 220, 260]],
  l: [[360, 1300, 2700], [80, 150, 200]], y: [[300, 2100, 2800], [70, 140, 200]], r: [[440, 1450, 2450], [100, 130, 180]], rr: [[440, 1450, 2450], [100, 130, 180]],
  b: [[300, 850, 2300], [100, 140, 200]], p: [[300, 850, 2300], [100, 140, 200]], d: [[340, 1700, 2600], [100, 140, 200]], t: [[340, 1700, 2600], [100, 140, 200]],
  g: [[320, 2000, 2500], [100, 140, 200]], k: [[320, 2000, 2500], [100, 140, 200]], s: [[380, 1700, 2600], [120, 160, 220]], f: [[380, 1100, 2400], [120, 160, 220]],
  j: [[380, 1900, 2500], [120, 160, 220]], ch: [[340, 2000, 2700], [110, 160, 220]],
};
// Fuerza de la voz por fonema y canal de ruido para las consonantes sordas
const VOZ = { m: 0.32, n: 0.32, ñ: 0.32, l: 0.42, y: 0.5, r: 0.55, rr: 0.5, b: 0.1, d: 0.1, g: 0.1 };
const RUIDO = { s: ["s", 0.32], f: ["f", 0.16], j: ["j", 0.3], ch: ["sh", 0.34] };
const EXPLOSION = { p: ["f", 1.2, 0.012], t: ["s", 0.9, 0.012], k: ["j", 1.1, 0.018], ch: ["sh", 0.7, 0.02] };
const GANANCIA_VOCAL = { a: 1, e: 1.15, i: 1.55, o: 1.1, u: 1.45 }; // las vocales cerradas suenan más bajo

/** Pasa las marcas a pistas de control (una muestra cada BLOQUE), con transiciones suaves. */
const BLOQUE = 32;
function controles(notas, n, opciones, semilla) {
  const K = Math.ceil(n / BLOQUE) + 2, dt = BLOQUE / SR, r = generadorRuido(semilla), escalaF = opciones.timbre === "femenina" ? 1.16 : 1;
  const C = { midi: new Float32Array(K), voz: new Float32Array(K), aire: new Float32Array(K), nasal: new Float32Array(K), F: [0, 1, 2].map(() => new Float32Array(K)), B: [0, 1, 2].map(() => new Float32Array(K)),
    ruido: { s: new Float32Array(K), sh: new Float32Array(K), j: new Float32Array(K), f: new Float32Array(K) }, vocal: { a: new Float32Array(K), e: new Float32Array(K), i: new Float32Array(K), o: new Float32Array(K), u: new Float32Array(K) }, vib: new Float32Array(K) };
  const def = FORM.e; for (let k = 0; k < K; k++) { for (let j = 0; j < 3; j++) { C.F[j][k] = def[0][j] * escalaF; C.B[j][k] = def[1][j]; } C.midi[k] = notas.length ? notas[0].midi : 55; }
  const rango = (a, b) => [Math.max(0, Math.floor(a / dt)), Math.min(K, Math.ceil(b / dt))];
  let inicioNota = 0, ultimaVocal = "e";
  notas.forEach((x, i) => {
    const [k0, k1] = rango(x.t0, x.t1), fm = FORM[x.f] || def, esV = VOCALES.includes(x.f);
    if (esV) ultimaVocal = x.f;
    const vocalCercana = esV ? x.f : (notas.slice(i).find((y) => VOCALES.includes(y.f)) || { f: ultimaVocal }).f;
    if (x.inicioSilaba || i === 0 || (i > 0 && notas[i - 1].pausa)) inicioNota = x.t0;
    const fuerza = (esV ? GANANCIA_VOCAL[x.f] : VOZ[x.f] ?? 0) * (0.88 + 0.12 * r());
    for (let k = k0; k < k1; k++) {
      for (let j = 0; j < 3; j++) { C.F[j][k] = fm[0][j] * escalaF; C.B[j][k] = fm[1][j]; }
      C.midi[k] = x.midi; C.voz[k] = fuerza; C.nasal[k] = "mnñ".includes(x.f) ? 1 : 0;
      C.vocal[vocalCercana][k] = 1;
      const enNota = k * dt - inicioNota; C.vib[k] = esV ? Math.min(1, Math.max(0, (enNota - 0.22) / 0.35)) : 0; // el vibrato llega tarde
      C.aire[k] = (opciones.aire ?? 0.08) * (esV ? 1 : 0.4);
    }
    if (x.f === "r" || x.f === "rr") { const golpes = x.f === "rr" ? 3 : 1; for (let g = 0; g < golpes; g++) { const [a, b] = rango(x.t0 + ((x.t1 - x.t0) * g) / golpes, x.t0 + ((x.t1 - x.t0) * (g + 0.45)) / golpes); for (let k = a; k < b; k++) C.voz[k] = 0.12; } }
    if (RUIDO[x.f]) { const [canal, g] = RUIDO[x.f]; const [a, b] = rango(x.t0, x.t1); for (let k = a; k < b; k++) C.ruido[canal][k] = g; }
    if (EXPLOSION[x.f]) { const [canal, g, d] = EXPLOSION[x.f]; const [a, b] = rango(x.t1 - d, x.t1); for (let k = a; k < b; k++) C.ruido[canal][k] = Math.max(C.ruido[canal][k], g); }
    if (i === 0 || notas[i - 1].pausa) { const [a, b] = rango(x.t0 - 0.09, x.t0); for (let k = a; k < b; k++) C.aire[k] = 0.18; } // toma de aire antes de la frase
    if (x.pausa && esV) { // final de frase: la nota baja un poco y se suelta con aire
      const [a, b] = rango(x.t1 - Math.min(0.18, (x.t1 - x.t0) * 0.4), x.t1);
      for (let k = a; k < b; k++) { const q = (k - a) / Math.max(1, b - a); C.midi[k] -= 0.7 * q * q; C.voz[k] *= 1 - 0.35 * q; C.aire[k] += 0.08 * q; }
    }
    if (esV && x.inicioSilaba && (i === 0 || notas[i - 1].pausa)) { const [a, b] = rango(x.t0, x.t0 + 0.09); for (let k = a; k < b; k++) C.midi[k] -= 0.6 * (1 - (k - a) / Math.max(1, b - a)); } // entrada desde abajo
  });
  // Suavizado: ida y vuelta para que los movimientos anticipen la siguiente vocal (coarticulación)
  const suavizar = (a, tau) => { const c = Math.exp(-dt / tau); for (let k = 1; k < a.length; k++) a[k] = a[k] * (1 - c) + a[k - 1] * c; for (let k = a.length - 2; k >= 0; k--) a[k] = a[k] * (1 - c) + a[k + 1] * c; };
  C.F.forEach((a) => suavizar(a, 0.018)); C.B.forEach((a) => suavizar(a, 0.018)); suavizar(C.midi, 0.022); suavizar(C.voz, 0.008); suavizar(C.aire, 0.015); suavizar(C.nasal, 0.012); suavizar(C.vib, 0.05);
  Object.values(C.ruido).forEach((a) => suavizar(a, 0.004)); Object.values(C.vocal).forEach((a) => suavizar(a, 0.02));
  // Pequeña deriva de afinación, como la de un cantante real (unos pocos centésimos)
  let d1 = 0, d2 = 0; for (let k = 0; k < K; k++) { d1 = d1 * 0.995 + r() * 0.012; d2 = d2 * 0.9995 + r() * 0.003; C.midi[k] += (d1 + d2) * 0.6; }
  return C;
}

// ───────────────────────── Motor 1: síntesis por formantes ─────────────────────────
export async function sintetizar(notas, n, opciones, semilla = 1) {
  const C = controles(notas, n, opciones, semilla), sal = new Float32Array(n), r = generadorRuido(semilla * 7 + 3);
  const R = [0, 1, 2, 3, 4].map(() => new Resonador()), escalaF = opciones.timbre === "femenina" ? 1.16 : 1;
  R[3].ajustar(3300 * escalaF, 250); R[4].ajustar(3850 * escalaF, 300);
  const polo = new Resonador(), cero = new Antirresonador(); polo.ajustar(270, 100);
  const canal = { s: [new Biquad("highpass", 4300, 0.8), new Biquad("peaking", 6800, 1.2, 6)], sh: [new Biquad("bandpass", 3000, 1.1), new Biquad("peaking", 2400, 1, 4)], j: [new Biquad("bandpass", 1700, 0.8), new Biquad("lowpass", 4000)], f: [new Biquad("highpass", 1200), new Biquad("lowpass", 9000)] };
  const tilt = { y: 0 };
  let fase = 0, periodo = 1, amp = 1, gPrev = 0, vibFase = 0;
  for (let i = 0; i < n; i++) {
    const k = (i / BLOQUE) | 0;
    if (i % BLOQUE === 0) {
      for (let j = 0; j < 3; j++) R[j].ajustar(C.F[j][k], C.B[j][k]);
      cero.ajustar(270 + 230 * C.nasal[k], 100 + 60 * C.nasal[k]);
    }
    // altura con vibrato (tasa que respira un poco)
    vibFase += (2 * Math.PI * (5.4 + 0.3 * Math.sin(i / SR * 0.7))) / SR;
    const f0 = midiAHz(C.midi[k] + C.vib[k] * 0.32 * Math.sin(vibFase));
    // fuente glotal (aproximación de Rosenberg) con jitter y shimmer en cada periodo
    fase += f0 / SR / periodo;
    if (fase >= 1) { fase -= 1; periodo = 1 + r() * 0.004; amp = 1 + r() * 0.035; }
    const v = C.voz[k], cierre = 0.58 + 0.12 * (1 - v), pico = cierre * 0.66;
    const g = fase < pico ? 0.5 * (1 - Math.cos((Math.PI * fase) / pico)) : fase < cierre ? Math.cos(((fase - pico) / (cierre - pico)) * Math.PI * 0.5) : 0;
    const dg = (g - gPrev) * amp * (SR / f0) * 0.15; gPrev = g; // derivada del flujo, independiente de la altura
    tilt.y += (dg - tilt.y) * (0.35 + 0.45 * v); // más fuerza = más brillo
    const aire = r() * C.aire[k] * (0.35 + 0.65 * g);
    let x = tilt.y * v * 1.4 + aire;
    x = R[0].paso(x); x = R[1].paso(x); x = R[2].paso(x); x = R[3].paso(x); x = R[4].paso(x);
    x = cero.paso(polo.paso(x)) ;
    // consonantes sordas: ruido por canales filtrados en paralelo
    const z = r(); let fr = 0;
    for (const nombre in canal) { const a = C.ruido[nombre][k]; if (a > 0.001) { const [f1, f2] = canal[nombre]; fr += f2.paso(f1.paso(z)) * a; } else { canal[nombre][0].paso(0); canal[nombre][1].paso(0); } }
    sal[i] = x * 0.14 + fr * 0.22;
    if (i % 200000 === 0) await respirar();
  }
  return { sal, C };
}

// ───────────────────────── Motor 2: tus vocales con PSOLA ─────────────────────────
/** Prepara una vocal grabada: mono, recorte del tramo estable y marcas de cada periodo de la voz. */
export function prepararVocal(buffer) {
  const sr = buffer.sampleRate, canales = [...Array(buffer.numberOfChannels)].map((_, c) => buffer.getChannelData(c));
  let x = new Float32Array(Math.floor((buffer.length * SR) / sr));
  for (let i = 0; i < x.length; i++) { const p = (i * sr) / SR, a = Math.floor(p), f = p - a; let s = 0; for (const c of canales) s += (c[a] || 0) * (1 - f) + (c[a + 1] || 0) * f; x[i] = s / canales.length; }
  // tramo estable: donde la energía supera la mitad del máximo
  const ven = Math.round(SR * 0.02), en = []; for (let i = 0; i + ven < x.length; i += ven) { let s = 0; for (let j = 0; j < ven; j++) s += x[i + j] ** 2; en.push(Math.sqrt(s / ven)); }
  const max = Math.max(...en, 1e-9); let a = en.findIndex((e) => e > max * 0.5), b = en.length - 1 - [...en].reverse().findIndex((e) => e > max * 0.5);
  if (a < 0 || b - a < 10) throw new Error("La grabación es muy corta o muy baja: sostén la vocal 2 segundos y acércate al micrófono.");
  a += 3; b -= 3; x = x.slice(a * ven, b * ven);
  let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v)); for (let i = 0; i < x.length; i++) x[i] *= 0.6 / pk;
  // altura: YIN sobre una versión a 11 kHz
  const f = 4, d = new Float32Array(Math.floor(x.length / f)); for (let i = 0; i < d.length; i++) d[i] = (x[i * f] + x[i * f + 1] + x[i * f + 2] + x[i * f + 3]) / 4;
  const alturas = []; for (let i = 0; i + 1024 < d.length; i += 512) { const hz = tonoDeVentana(d, i, 1024, SR / f, 70, 600); if (hz) alturas.push(hz); }
  if (alturas.length < 3) throw new Error("No encontré una nota clara en la grabación. Canta la vocal sostenida, sin hablar.");
  alturas.sort((p, q) => p - q); const hz = alturas[alturas.length >> 1], T = SR / hz;
  // marcas de periodo: picos de la señal suavizada, uno por periodo
  const lp = new Biquad("lowpass", Math.min(1200, hz * 2.5)), s = Float32Array.from(x, (v) => lp.paso(v)), marcas = [];
  let m = 0; for (let i = 0; i < T; i++) if (s[i] > s[m]) m = i; marcas.push(m);
  while (true) { const ini = Math.round(m + T * 0.8), fin = Math.round(m + T * 1.2); if (fin >= x.length) break; let best = ini; for (let i = ini; i <= fin; i++) if (s[i] > s[best]) best = i; marcas.push(best); m = best; }
  return { datos: x, marcas: Int32Array.from(marcas), hz, segundos: x.length / SR };
}

const REEMPLAZO = { a: ["o", "e"], e: ["i", "a"], i: ["e", "u"], o: ["a", "u"], u: ["o", "i"] };
const deBanco = (banco, v) => banco[v] || banco[REEMPLAZO[v][0]] || banco[REEMPLAZO[v][1]] || Object.values(banco)[0];

async function cantarConVocales(notas, n, opciones, banco) {
  const C = controles(notas, n, opciones, 5), sal = new Float32Array(n), nasal = new Float32Array(n);
  const lista = "aeiou".split(""), punteros = Object.fromEntries(lista.map((v) => [v, { i: 1, dir: 1 }]));
  let t = 0;
  while (t < n) {
    const k = Math.min(C.midi.length - 1, (t / BLOQUE) | 0), vozK = C.voz[k];
    const f0 = midiAHz(C.midi[k] + C.vib[k] * 0.3 * Math.sin((t / SR) * 2 * Math.PI * 5.4)), T = SR / f0;
    if (vozK > 0.02) {
      for (const v of lista) {
        const peso = C.vocal[v][k]; if (peso < 0.02) continue;
        const b = deBanco(banco, v), pt = punteros[v], M = b.marcas;
        // avanza por la grabación ida y vuelta para que el sonido no se congele
        pt.i += pt.dir; if (pt.i >= M.length - 2) { pt.dir = -1; pt.i = M.length - 3; } if (pt.i <= 1) { pt.dir = 1; pt.i = 2; }
        const c = M[pt.i], Ts = Math.max(8, Math.round((M[pt.i + 1] - M[pt.i - 1]) / 2)), largo = 2 * Ts;
        const g = vozK * peso * Math.min(1.2, T / Ts); // compensa el solape cuando la nota sube
        for (let j = -Ts; j < Ts; j++) {
          const o = Math.round(t) + j, s = c + j; if (o < 0 || o >= n || s < 0 || s >= b.datos.length) continue;
          const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * (j + Ts)) / largo), val = b.datos[s] * w * g;
          sal[o] += val; nasal[o] += val * C.nasal[k];
        }
      }
    }
    t += T;
    if (((t / 100000) | 0) !== (((t - T) / 100000) | 0)) await respirar();
  }
  // m, n, ñ: la misma voz pero apagada (sonido por la nariz)
  const lp = new Biquad("lowpass", 700, 0.8), z = new Antirresonador(); z.ajustar(1200, 300);
  for (let i = 0; i < n; i++) { const k = (i / BLOQUE) | 0, nas = C.nasal[k] || 0; sal[i] = sal[i] * (1 - nas) + z.paso(lp.paso(nasal[i])) * 1.6 * nas; }
  // consonantes sordas del motor sintético
  const solo = await sintetizar(notas.map((x) => ({ ...x })), n, { ...opciones, aire: 0.02 }, 3);
  for (let i = 0; i < n; i++) { const k = (i / BLOQUE) | 0, v = C.voz[k]; sal[i] += solo.sal[i] * (1 - Math.min(1, v * 1.4)) * 0.9; }
  return sal;
}

// ───────────────────────── Producción de la voz ─────────────────────────
function cadena(x) { // ecualización de voz: limpia graves, quita barro, da presencia y aire
  const filtros = [new Biquad("highpass", 85, 0.7), new Biquad("peaking", 280, 1, -2.5), new Biquad("peaking", 3000, 0.9, 3), new Biquad("highshelf", 9000, 0.7, 2)];
  for (const f of filtros) f.procesar(x); return x;
}

/**
 * Canta la letra del proyecto. opciones: { motor: "sintetica"|"mivoz", melodia, octava, timbre, aire, afinar, armonia }
 * banco: vocales preparadas con prepararVocal (solo para "mivoz"). Devuelve { L, R }.
 */
export async function cantar(p, opciones = {}, banco = null) {
  const notas = partitura(p, opciones); if (!notas.length) throw new Error("No hay letra con tiempos para cantar.");
  const n = Math.ceil(p.duracion * SR), usarBanco = opciones.motor === "mivoz";
  if (usarBanco && (!banco || !Object.keys(banco).length)) throw new Error("Para cantar con tu voz, primero graba tus vocales en «Mi banco de vocales».");
  const principal = usarBanco ? await cantarConVocales(notas, n, opciones, banco) : (await sintetizar(notas, n, opciones, 1)).sal;
  cadena(principal);
  if (opciones.seco) return { L: principal, R: Float32Array.from(principal), notas }; // voz sola, sin doblaje ni efectos
  // doblaje: una segunda toma con otras pequeñas imperfecciones, un poco atrasada y a los lados
  const doble = usarBanco ? null : cadena((await sintetizar(notas.map((x) => ({ ...x, t0: x.t0 + 0.012, t1: x.t1 + 0.012 })), n, opciones, 2)).sal);
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { const d = doble ? doble[i] * 0.32 : 0; L[i] = principal[i] + d * 0.8; R[i] = principal[i] + d * 1.2 - (doble ? doble[i] * 0.1 : 0); }
  comprimir(L, R, { umbral: -20, ratio: 3.5, ataque: 0.004, suelta: 0.09, ganancia: 4 });
  // reverb tipo plato y un eco corto en negra con punto
  const eL = Float32Array.from(L), eR = Float32Array.from(R); reverb(eL, eR, { sala: 0.78, brillo: 0.45, mezcla: 1 });
  const eco = Math.round(((60 / (p.bpm || 95)) * 0.75) * SR);
  for (let i = 0; i < n; i++) { L[i] += eL[i] * 0.16 + (i >= eco ? R[i - eco] * 0.09 : 0); R[i] += eR[i] * 0.16 + (i >= eco ? L[i - eco] * 0.09 : 0); }
  limitar(L, R, { techo: -2 });
  return { L, R, notas };
}

/** Mezcla final: la voz encima de la pista, bajando un poco la pista cuando hay voz. */
export function mezclar(ac, base, canto, volumen = 0.85, largoSeg = 0) {
  const n = Math.max(canto.L.length, Math.ceil(largoSeg * SR)), L = new Float32Array(n), R = new Float32Array(n);
  let env = 0; const at = Math.exp(-1 / (0.01 * SR)), su = Math.exp(-1 / (0.3 * SR));
  const bL = base ? base.getChannelData(0) : null, bR = base ? base.getChannelData(Math.min(1, base.numberOfChannels - 1)) : null, k = base ? base.sampleRate / SR : 1;
  for (let i = 0; i < n; i++) {
    const vl = (canto.L[i] || 0) * volumen, vr = (canto.R[i] || 0) * volumen, a = Math.max(Math.abs(vl), Math.abs(vr));
    env = a > env ? at * env + (1 - at) * a : su * env + (1 - su) * a;
    const duck = 1 - Math.min(0.3, env * 1.2); // la pista baja hasta 3 dB mientras se canta
    const j = Math.floor(i * k), pl = bL && j < bL.length ? bL[j] : 0, pr = bR && j < bR.length ? bR[j] : 0;
    L[i] = pl * duck + vl; R[i] = pr * duck + vr;
  }
  comprimir(L, R, { umbral: -12, ratio: 2, ataque: 0.02, suelta: 0.25 }); limitar(L, R, { techo: -1 });
  const out = ac.createBuffer(2, n, SR); out.copyToChannel(L, 0); out.copyToChannel(R, 1); return out;
}

/** AudioBuffer o {L,R} → archivo WAV de 16 bits. */
export function aWav(buf) {
  const ch = buf.L ? [buf.L, buf.R] : [...Array(buf.numberOfChannels)].map((_, c) => buf.getChannelData(c)), n = ch[0].length, sr = buf.sampleRate || SR;
  const v = new DataView(new ArrayBuffer(44 + n * ch.length * 2)), txt = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  txt(0, "RIFF"); v.setUint32(4, 36 + n * ch.length * 2, true); txt(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch.length, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * ch.length * 2, true); v.setUint16(32, ch.length * 2, true); v.setUint16(34, 16, true); txt(36, "data"); v.setUint32(40, n * ch.length * 2, true);
  for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch.length; c++, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, ch[c][i])) * 32767, true);
  return new Blob([v], { type: "audio/wav" });
}
