// VIDEO-FREE · Análisis de la voz cantada, con algoritmo propio.
// Detecta la nota que se canta en cada instante (método YIN de autocorrelación),
// la energía de la voz, el rango, la tonalidad y las frases cantadas.
// Funciona mejor con la voz sola (sin pista).

const NOTAS = ["Do", "Do#", "Re", "Re#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"];
const INGLES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const hzAMidi = (hz) => 69 + 12 * Math.log2(hz / 440);
export const midiAHz = (m) => 440 * 2 ** ((m - 69) / 12);
export const nombreNota = (midi) => { const n = Math.round(midi), k = ((n % 12) + 12) % 12, o = Math.floor(n / 12) - 1; return `${NOTAS[k]}${o} (${INGLES[k]}${o})`; };

/** Mezcla a mono y baja la frecuencia de muestreo a ~11 kHz (suficiente para la voz y mucho más rápido). */
function reducir(buffer) {
  const f = Math.max(1, Math.round(buffer.sampleRate / 11025)), n = Math.floor(buffer.length / f), x = new Float32Array(n);
  const ch = [...Array(buffer.numberOfChannels)].map((_, i) => buffer.getChannelData(i));
  for (let i = 0; i < n; i++) { let s = 0; for (const c of ch) for (let j = 0; j < f; j++) s += c[i * f + j]; x[i] = s / (f * ch.length); }
  return { x, sr: buffer.sampleRate / f };
}

/** YIN: devuelve la frecuencia fundamental de una ventana, o 0 si no hay voz clara. */
export function tonoDeVentana(x, ini, N, sr, fmin = 75, fmax = 700, umbral = 0.15) {
  const tMin = Math.floor(sr / fmax), tMax = Math.min(Math.floor(sr / fmin), N - 1), d = new Float32Array(tMax + 1);
  let suma = 0, mejor = -1;
  for (let tau = 1; tau <= tMax; tau++) {
    let s = 0; for (let j = 0; j < N - tMax; j++) { const e = x[ini + j] - x[ini + j + tau]; s += e * e; }
    suma += s; d[tau] = suma ? (s * tau) / suma : 1;
  }
  for (let tau = tMin; tau <= tMax; tau++) {
    if (d[tau] < umbral) { while (tau + 1 <= tMax && d[tau + 1] < d[tau]) tau++; mejor = tau; break; }
  }
  if (mejor < 0) return 0;
  // Corrección de octava: si el doble del periodo encaja mucho mejor, el primero era un armónico
  for (let rep = 0; rep < 2 && mejor * 2 + 2 <= tMax; rep++) {
    let m2 = mejor * 2; for (let t2 = mejor * 2 - 2; t2 <= mejor * 2 + 2; t2++) if (d[t2] < d[m2]) m2 = t2;
    if (d[mejor] > 0.06 && d[m2] < d[mejor] * 0.5) mejor = m2; else break;
  }
  const a = d[mejor - 1] ?? d[mejor], b = d[mejor], c = d[mejor + 1] ?? d[mejor], den = a - 2 * b + c; // afinado fino
  return sr / (mejor + (den ? (0.5 * (a - c)) / den : 0));
}

const MAYOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MENOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
function correlacion(a, b) {
  const ma = a.reduce((x, y) => x + y) / 12, mb = b.reduce((x, y) => x + y) / 12; let n = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return n / Math.sqrt(da * db || 1);
}
/** Tonalidad más probable a partir de las notas cantadas (perfiles de Krumhansl). */
export function tonalidad(histograma) {
  const op = [];
  for (let k = 0; k < 12; k++) {
    const rot = (perfil) => perfil.map((_, i) => perfil[(i - k + 12) % 12]);
    op.push({ nombre: `${NOTAS[k]} mayor (${INGLES[k]})`, r: correlacion(histograma, rot(MAYOR)) });
    op.push({ nombre: `${NOTAS[k]} menor (${INGLES[k]}m)`, r: correlacion(histograma, rot(MENOR)) });
  }
  return op.sort((a, b) => b.r - a.r).slice(0, 3);
}

/**
 * Analiza un AudioBuffer de voz. Devuelve lo que se guarda en proyecto.voz:
 * { paso, energia[0..1], tono[midi o 0], segmentos[[inicio,fin]], resumen{...} }
 */
export async function analizarVoz(buffer, progreso = () => {}) {
  const { x, sr } = reducir(buffer), paso = 0.05, salto = Math.round(sr * paso), N = 1024;
  const cuadros = Math.max(0, Math.floor((x.length - N) / salto)), tono = new Array(cuadros).fill(0), rms = new Float32Array(cuadros);
  for (let i = 0; i < cuadros; i++) {
    const ini = i * salto; let s = 0; for (let j = 0; j < N; j++) s += x[ini + j] * x[ini + j];
    rms[i] = Math.sqrt(s / N);
  }
  const orden = Float32Array.from(rms).sort(), fuerte = orden[Math.floor(cuadros * 0.95)] || 1e-6, piso = Math.max(fuerte * 0.06, 1e-4);
  for (let i = 0; i < cuadros; i++) {
    if (rms[i] > piso) { const hz = tonoDeVentana(x, i * salto, N, sr); if (hz) tono[i] = Math.round(hzAMidi(hz) * 10) / 10; }
    if (i % 200 === 0) { progreso(i / cuadros); await new Promise((r) => setTimeout(r)); }
  }
  // Quita saltos sueltos de octava: una nota aislada muy lejos de sus vecinas
  for (let i = 1; i < cuadros - 1; i++) if (tono[i] && tono[i - 1] && tono[i + 1] && Math.abs(tono[i] - tono[i - 1]) > 7 && Math.abs(tono[i] - tono[i + 1]) > 7) tono[i] = (tono[i - 1] + tono[i + 1]) / 2;
  const energia = Array.from(rms, (v) => Math.round(Math.min(1, Math.max(0, (20 * Math.log10(v / fuerte + 1e-9) + 30) / 30)) * 100) / 100);
  // Frases: tramos con voz, uniendo silencios cortos
  const segmentos = []; let ini = -1, ultimo = -1;
  for (let i = 0; i < cuadros; i++) {
    const activa = energia[i] > 0.35 && (tono[i] > 0 || tono[i - 1] > 0 || tono[i + 1] > 0);
    if (activa) { if (ini < 0) ini = i; ultimo = i; }
    else if (ini >= 0 && i - ultimo > 0.45 / paso) { if ((ultimo - ini) * paso >= 0.4) segmentos.push([+(ini * paso).toFixed(2), +((ultimo + 1) * paso).toFixed(2)]); ini = -1; }
  }
  if (ini >= 0 && (ultimo - ini) * paso >= 0.4) segmentos.push([+(ini * paso).toFixed(2), +((ultimo + 1) * paso).toFixed(2)]);
  const cantadas = tono.filter((n) => n > 0).sort((a, b) => a - b);
  let resumen = null;
  if (cantadas.length > 10) {
    const pc = (q) => cantadas[Math.floor((cantadas.length - 1) * q)], hist = new Array(12).fill(0);
    for (const n of cantadas) hist[((Math.round(n) % 12) + 12) % 12]++;
    resumen = {
      grave: nombreNota(pc(0.05)), centro: nombreNota(pc(0.5)), aguda: nombreNota(pc(0.95)),
      rangoSemitonos: Math.round((pc(0.95) - pc(0.05)) * 10) / 10,
      tonalidades: tonalidad(hist).map((o) => o.nombre),
      vozActiva: Math.round((cantadas.length / cuadros) * 100), frases: segmentos.length,
    };
  }
  progreso(1);
  return { paso, energia, tono, segmentos, resumen };
}

/** Reparte las líneas de la letra sobre las frases detectadas en la voz. */
export function letraSegunVoz(lineas, segmentos) {
  if (!segmentos.length || !lineas.length) return null;
  if (segmentos.length === lineas.length) return lineas.map((texto, i) => ({ inicio: segmentos[i][0], fin: segmentos[i][1], texto }));
  // Si no coinciden, reparte por tiempo cantado: cada línea recibe una parte proporcional a su largo
  const dur = segmentos.map(([a, b]) => b - a), total = dur.reduce((x, y) => x + y, 0), letras = lineas.map((l) => l.length + 4), suma = letras.reduce((x, y) => x + y, 0);
  const aReloj = (cantado) => { let r = cantado; for (let i = 0; i < segmentos.length; i++) { if (r <= dur[i] + 1e-6) return segmentos[i][0] + r; r -= dur[i]; } return segmentos.at(-1)[1]; };
  let acum = 0;
  return lineas.map((texto, i) => { const a = aReloj((acum / suma) * total); acum += letras[i]; const b = aReloj((acum / suma) * total - 0.05); return { inicio: +a.toFixed(2), fin: +Math.max(a + 0.3, b).toFixed(2), texto }; });
}
