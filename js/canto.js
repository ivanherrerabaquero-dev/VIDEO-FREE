// VIDEO-FREE · Cantante sintético propio.
// Convierte la letra (con sus tiempos) en una voz que la canta, usando síntesis por formantes:
// una fuente tipo cuerdas vocales pasa por filtros que imitan la boca en cada vocal, y las
// consonantes se hacen con ruido y cortes. La melodía sale del análisis de tu pista de voz
// (proyecto.voz); si no hay, se compone una dentro de la tonalidad.
// No es un clon de tu voz: es un instrumento que canta tu letra con tu melodía y tu rango.

import { palabrasDe, azar } from "./motor.js";
import { midiAHz } from "./voz.js";

// Formantes (Hz) de las vocales del español para voz masculina
const VOCAL = { a: [730, 1250, 2500], e: [480, 1900, 2550], i: [290, 2250, 2900], o: [500, 900, 2500], u: [320, 800, 2300] };
const NASAL = [260, 1150, 2400], LATERAL = [360, 1300, 2600];
const FUERTES = "aeo";

/** Texto en español → fonemas simplificados. */
export function fonemas(palabra) {
  const s = palabra.toLowerCase().normalize("NFD").replace(/ñ/g, "ñ").replace(/ü/g, "ü").replace(/[̀-ͯ]/g, "").replace(/[^a-zñü]/g, "");
  const f = [], V = "aeiou";
  for (let i = 0; i < s.length; i++) {
    const c = s[i], n = s[i + 1] || "";
    if (V.includes(c)) f.push(c);
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
    else if (c === "y") f.push(n && V.includes(n) ? "y" : "i");
    else if (c === "r") f.push(i === 0 ? "rr" : "r");
    else f.push(c);
  }
  return f;
}

const DUR = { s: 0.085, f: 0.07, j: 0.075, ch: 0.09, p: 0.06, t: 0.055, k: 0.065, b: 0.045, d: 0.04, g: 0.045, m: 0.06, n: 0.055, ñ: 0.07, l: 0.055, y: 0.05, r: 0.035, rr: 0.09 };

/** Parte una palabra en trozos con tiempo: consonantes cortas y vocales que ocupan el resto. */
function trozos(palabra, t0, t1) {
  const f = fonemas(palabra); if (!f.length) return [];
  const esV = (x) => x in VOCAL, nucleos = []; // cada núcleo = una sílaba (los diptongos van juntos)
  for (let i = 0; i < f.length; i++) if (esV(f[i])) { const ant = nucleos.at(-1); (ant && ant.fin === i - 1 && !(FUERTES.includes(f[i]) && FUERTES.includes(f[i - 1])) ? ant : nucleos[nucleos.push({ ini: i, fin: i }) - 1]).fin = i; }
  let cons = f.reduce((a, x) => a + (esV(x) ? 0 : DUR[x] || 0.05), 0);
  const D = Math.max(0.08, t1 - t0), k = cons > D * 0.5 ? (D * 0.5) / cons : 1; cons *= k;
  const pesos = nucleos.map((_, i) => (i === nucleos.length - 1 ? 1.35 : 1)), suma = pesos.reduce((a, b) => a + b, 0) || 1, porVocal = (D - cons) / suma;
  const out = []; let t = t0;
  for (let i = 0; i < f.length; i++) {
    const x = f[i];
    if (!esV(x)) { const d = (DUR[x] || 0.05) * k; out.push({ f: x, t0: t, t1: t + d }); t += d; continue; }
    const ni = nucleos.findIndex((n) => i >= n.ini && i <= n.fin), n = nucleos[ni], total = porVocal * pesos[ni], largo = n.fin - n.ini + 1;
    const fuerte = [...Array(largo)].map((_, j) => f[n.ini + j]).findIndex((v) => FUERTES.includes(v));
    const parte = largo === 1 ? 1 : (i - n.ini === (fuerte < 0 ? largo - 1 : fuerte) ? 1 - 0.3 * (largo - 1) : 0.3);
    out.push({ f: x, t0: t, t1: t + total * parte, silaba: ni, inicioSilaba: i === n.ini }); t += total * parte;
  }
  return out;
}

const ESCALA = { mayor: [0, 2, 4, 5, 7, 9, 11], menor: [0, 2, 3, 5, 7, 8, 10] };
const NOMBRES = ["Do", "Do#", "Re", "Re#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"];
function tonalidadDe(p) {
  const txt = (p.voz && p.voz.resumen && p.voz.resumen.tonalidades[0]) || "La menor";
  const m = txt.match(/^(Do#|Do|Re#|Re|Mi|Fa#|Fa|Sol#|Sol|La#|La|Si) (mayor|menor)/) || [0, "La", "menor"];
  const notas = ((p.voz && p.voz.tono) || []).filter((n) => n > 0).sort((a, b) => a - b);
  return { raiz: NOMBRES.indexOf(m[1]), modo: m[2], centro: notas.length ? notas[notas.length >> 1] : 57 };
}

/**
 * Construye la partitura: lista de trozos {f, t0, t1, midi}. `opciones.melodia`:
 * "voz" sigue las notas de la pista analizada; "compuesta" inventa una melodía en la tonalidad.
 */
export function partitura(p, opciones = {}) {
  const { raiz, modo, centro } = tonalidadDe(p), v = p.voz, octava = (opciones.octava || 0) * 12;
  const escalera = []; for (let m = Math.round(centro) - 6; m <= Math.round(centro) + 8; m++) if (ESCALA[modo].includes((((m - raiz) % 12) + 12) % 12)) escalera.push(m);
  let grado = escalera.reduce((mejor, m, i) => (Math.abs(m - centro) < Math.abs(escalera[mejor] - centro) ? i : mejor), 0), cuenta = 0;
  const medio = grado; // la melodía compuesta no se aleja más de tres notas del centro de la voz
  const todo = [];
  for (const [li, l] of (p.letra || []).entries()) {
    const ps = palabrasDe(l);
    ps.forEach((w, wi) => {
      const ts = trozos(w.p, w.inicio, Math.max(w.inicio + 0.08, Math.min(w.fin, (ps[wi + 1] || {}).inicio ?? w.fin)));
      let midi = escalera[grado];
      for (const x of ts) {
        if (x.inicioSilaba) {
          cuenta++;
          const ultima = wi === ps.length - 1 && x.silaba === Math.max(...ts.filter((y) => y.silaba !== undefined).map((y) => y.silaba));
          if (ultima) grado = escalera.reduce((mejor, m, i) => ([0, 7].includes((((m - raiz) % 12) + 12) % 12) && Math.abs(i - medio) <= 3 && Math.abs(i - grado) < Math.abs(mejor - grado) ? i : mejor), 99);
          else grado = Math.min(escalera.length - 1, Math.max(0, grado + [-1, 0, 0, 1, 1, -1, 2, -2][Math.floor(azar(cuenta * 31 + li) * 8)]));
          if (Math.abs(grado - medio) > 3) grado -= Math.sign(grado - medio);
          if (grado === 99) grado = medio;
          midi = escalera[grado];
          if (opciones.melodia !== "compuesta" && v && v.tono) { // nota real cantada en ese momento de la pista
            const finS = ts.filter((y) => y.silaba === x.silaba).at(-1).t1, oidas = v.tono.slice(Math.floor(x.t0 / v.paso), Math.ceil(finS / v.paso) + 1).filter((n) => n > 0).sort((a, b) => a - b);
            if (oidas.length) midi = oidas[oidas.length >> 1];
          }
        }
        todo.push({ ...x, midi: midi + octava, linea: li });
      }
    });
  }
  return todo;
}

/** Sintetiza la voz cantada. Devuelve un AudioBuffer estéreo del largo del proyecto. */
export async function cantar(p, opciones = {}) {
  const notas = partitura(p, opciones); if (!notas.length) throw new Error("No hay letra con tiempos para cantar.");
  const sr = 44100, ac = new OfflineAudioContext(2, Math.ceil(p.duracion * sr), sr), salida = ac.createGain();
  // Fuente: cuerdas vocales (diente de sierra) con vibrato
  const osc = ac.createOscillator(); osc.type = "sawtooth"; osc.frequency.value = midiAHz(notas[0].midi);
  const lfo = ac.createOscillator(), prof = ac.createGain(); lfo.frequency.value = 5.4; prof.gain.value = 22; lfo.connect(prof).connect(osc.detune);
  const voz = ac.createGain(); voz.gain.value = 0; osc.connect(voz);
  const formantes = [0, 1, 2].map((i) => { const b = ac.createBiquadFilter(); b.type = "bandpass"; b.Q.value = [7, 10, 12][i]; b.frequency.value = VOCAL.a[i]; const g = ac.createGain(); g.gain.value = [1, 0.55, 0.3][i]; voz.connect(b).connect(g).connect(salida); return b; });
  const f4 = ac.createBiquadFilter(); f4.type = "bandpass"; f4.frequency.value = 3400; f4.Q.value = 10; const g4 = ac.createGain(); g4.gain.value = 0.1; voz.connect(f4).connect(g4).connect(salida);
  // Ruido para las consonantes sordas
  const rb = ac.createBuffer(1, sr * 2, sr), rd = rb.getChannelData(0); for (let i = 0; i < rd.length; i++) rd[i] = azar(i) * 2 - 1;
  const ruido = ac.createBufferSource(); ruido.buffer = rb; ruido.loop = true;
  const via = (tipo, hz, q) => { const b = ac.createBiquadFilter(); b.type = tipo; b.frequency.value = hz; b.Q.value = q; const g = ac.createGain(); g.gain.value = 0; ruido.connect(b).connect(g).connect(salida); return g.gain; };
  const R = { s: via("highpass", 5200, 0.7), f: via("highpass", 2600, 0.7), j: via("bandpass", 1700, 1.2), t: via("bandpass", 3600, 1.5), p: via("lowpass", 700, 0.7), aire: via("bandpass", 2200, 0.6) };
  const soplo = (param, t0, t1, g) => { param.setTargetAtTime(g, t0, 0.006); param.setTargetAtTime(0, t1, 0.01); };

  notas.forEach((n, i) => {
    const sig = notas[i + 1], pausa = !sig || sig.t0 - n.t1 > 0.07, vocal = VOCAL[n.f];
    const boca = vocal || (["m", "n", "ñ"].includes(n.f) ? NASAL : ["l", "y", "r", "rr"].includes(n.f) ? LATERAL : null);
    if (boca) formantes.forEach((b, k) => b.frequency.setTargetAtTime(boca[k], n.t0, 0.018));
    if (n.inicioSilaba || i === 0) osc.frequency.setTargetAtTime(midiAHz(n.midi), Math.max(0, n.t0 - 0.02), 0.028);
    let g = 0;
    if (vocal) g = 1; else if (["m", "n", "ñ"].includes(n.f)) g = 0.4; else if (["l", "y"].includes(n.f)) g = 0.5; else if (["b", "d", "g"].includes(n.f)) g = 0.14; else if (n.f === "r") g = 0.18;
    if (n.f === "rr") { for (let k = 0; k < 3; k++) { const a = n.t0 + ((n.t1 - n.t0) * k) / 3; voz.gain.setTargetAtTime(0.12, a, 0.006); voz.gain.setTargetAtTime(0.6, a + (n.t1 - n.t0) / 6, 0.006); } }
    else voz.gain.setTargetAtTime(g, n.t0, vocal ? 0.02 : 0.01);
    if (vocal) soplo(R.aire, n.t0, n.t1, 0.012);
    if (n.f === "s") soplo(R.s, n.t0, n.t1, 0.16); else if (n.f === "f") soplo(R.f, n.t0, n.t1, 0.07); else if (n.f === "j") soplo(R.j, n.t0, n.t1, 0.16);
    else if (n.f === "ch") soplo(R.t, n.t0 + (n.t1 - n.t0) * 0.35, n.t1, 0.2);
    else if (n.f === "t") soplo(R.t, n.t1 - 0.018, n.t1, 0.16); else if (n.f === "k") soplo(R.j, n.t1 - 0.022, n.t1, 0.2); else if (n.f === "p") soplo(R.p, n.t1 - 0.018, n.t1, 0.28);
    if (pausa) voz.gain.setTargetAtTime(0, n.t1, vocal ? 0.05 : 0.015); // suelta la nota al final de la frase
  });

  // Mezcla: un poco de cuerpo y un eco corto para que no suene seca
  const tono = ac.createBiquadFilter(); tono.type = "lowpass"; tono.frequency.value = 6500;
  const eco = ac.createDelay(1), reg = ac.createGain(), mojado = ac.createGain(); eco.delayTime.value = (60 / (p.bpm || 95)) * 0.75; reg.gain.value = 0.28; mojado.gain.value = 0.16;
  salida.connect(tono).connect(ac.destination); tono.connect(eco); eco.connect(reg).connect(eco); eco.connect(mojado).connect(ac.destination);
  osc.start(); lfo.start(); ruido.start();
  const buf = await ac.startRendering();
  let pico = 0; for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) pico = Math.max(pico, Math.abs(d[i])); }
  if (pico > 0) for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= 0.7 / pico; }
  return buf;
}

/** Suma la voz cantada a la canción. Devuelve un AudioBuffer nuevo. */
export function mezclar(ac, base, canto, volumen = 0.8, largoSeg = 0) {
  const sr = canto.sampleRate, n = Math.max(canto.length, Math.ceil(largoSeg * sr)), out = ac.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const o = out.getChannelData(c), v = canto.getChannelData(c);
    for (let i = 0; i < v.length; i++) o[i] = v[i] * volumen;
    if (base) { const b = base.getChannelData(Math.min(c, base.numberOfChannels - 1)), k = base.sampleRate / sr; for (let i = 0; i < n; i++) { const j = Math.floor(i * k); if (j < b.length) o[i] += b[j]; } }
  }
  let pico = 0; for (let c = 0; c < 2; c++) { const d = out.getChannelData(c); for (let i = 0; i < n; i++) pico = Math.max(pico, Math.abs(d[i])); }
  if (pico > 0.98) for (let c = 0; c < 2; c++) { const d = out.getChannelData(c); for (let i = 0; i < n; i++) d[i] *= 0.98 / pico; }
  return out;
}

/** AudioBuffer → archivo WAV de 16 bits. */
export function aWav(buf) {
  const ch = buf.numberOfChannels, n = buf.length, v = new DataView(new ArrayBuffer(44 + n * ch * 2)), txt = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  txt(0, "RIFF"); v.setUint32(4, 36 + n * ch * 2, true); txt(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, buf.sampleRate, true); v.setUint32(28, buf.sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); txt(36, "data"); v.setUint32(40, n * ch * 2, true);
  const d = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch; c++, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, d[c][i])) * 32767, true);
  return new Blob([v], { type: "audio/wav" });
}
