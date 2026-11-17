// VIDEO-FREE · Sonido: cargar la canción, pista de prueba sintetizada y medición de volumen.
// Todo con la Web Audio API del navegador, sin librerías.

let ctx = null;
export const contexto = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());

export async function decodificar(arrayBuffer) { return await contexto().decodeAudioData(arrayBuffer); }
export async function cargarAudio(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(`No pude abrir ${url}`);
  return decodificar(await r.arrayBuffer());
}

/** Pista de prueba: dembow a 95 BPM en Sol# menor, hecha con matemáticas (sin muestras de nadie). */
export function pistaDemo(segundos = 32, bpm = 95) {
  const sr = 44100, total = Math.floor(segundos * sr), buf = contexto().createBuffer(2, total, sr);
  const L = buf.getChannelData(0), R = buf.getChannelData(1), paso = Math.floor((60 / bpm / 4) * sr);
  const nota = (n) => 440 * 2 ** (n / 12);
  const acordes = [[-13, -9, -6], [-17, -13, -10], [-10, -6, -3], [-15, -11, -8]], bajos = [-25, -29, -22, -27];
  let semilla = 7; const ruido = () => ((semilla = (semilla * 16807) % 2147483647) / 1073741823.5) - 1;
  const sumar = (i0, n, f, g, pan = 0) => { for (let k = 0; k < n && i0 + k < total; k++) { const v = f(k / sr, k) * g; L[i0 + k] += v * (1 - pan); R[i0 + k] += v * (1 + pan); } };
  for (let s = 0; s * paso < total; s++) {
    const i = s * paso, q = s % 16, compas = Math.floor(s / 16) % 4;
    if (q % 4 === 0) { let fase = 0; sumar(i, sr * 0.35, (t) => { fase += (2 * Math.PI * (50 + 110 * Math.exp(-t * 30))) / sr; return Math.sin(fase) * Math.exp(-t * 9); }, 0.9); }
    if ([3, 6, 11, 14].includes(q)) sumar(i, sr * 0.18, (t) => (0.7 * ruido() + 0.4 * Math.sin(2 * Math.PI * 190 * t)) * Math.exp(-t * 22), 0.35);
    if (q % 2 === 0) { let ant = 0; sumar(i, sr * 0.05, (t) => { const r = ruido(), d = r - ant; ant = r; return d * Math.exp(-t * 60) * 0.5; }, 0.18, 0.3); }
    if ([0, 3, 6, 8, 11, 14].includes(q)) { const f = nota(bajos[compas]); sumar(i, paso * 2.5, (t) => Math.tanh(2.5 * Math.sin(2 * Math.PI * f * t)) * Math.min(1, t / 0.003) * Math.exp(-t / 0.25), 0.32); }
    if (q === 0) { const n = paso * 16, d = n / sr; sumar(i, n, (t) => acordes[compas].reduce((a, k) => a + Math.sin(2 * Math.PI * nota(k) * t) + 0.5 * Math.sin(2 * Math.PI * nota(k) * 1.003 * t), 0) * Math.min(1, t / 0.4) * Math.min(1, (d - t) / 0.3), 0.05, -0.2); }
    if (q === 2 || q === 10) { const f = nota(acordes[compas][Math.floor(s / 8) % 3] + 12); sumar(i, paso * 1.5, (t) => Math.sign(Math.sin(2 * Math.PI * f * t)) * Math.min(1, t / 0.002) * Math.exp(-t / 0.08), 0.05, 0.4); }
  }
  let pico = 0; for (let k = 0; k < total; k++) pico = Math.max(pico, Math.abs(L[k]), Math.abs(R[k]));
  const fi = sr * 0.5, fo = sr * 2.5;
  for (let k = 0; k < total; k++) { const g = (0.89 / pico) * Math.min(1, k / fi, (total - k) / fo); L[k] *= g; R[k] *= g; }
  return buf;
}

/**
 * Mide la sonoridad de la canción en LUFS (método de la norma ITU-R BS.1770: filtro K,
 * bloques de 400 ms y doble compuerta). Devuelve también la ganancia para llegar al objetivo.
 */
export async function medirVolumen(buffer, objetivo = -14, picoMax = -1) {
  const off = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const src = off.createBufferSource(); src.buffer = buffer;
  const alto = off.createBiquadFilter(); alto.type = "highshelf"; alto.frequency.value = 1500; alto.gain.value = 4;
  const paso = off.createBiquadFilter(); paso.type = "highpass"; paso.frequency.value = 38; paso.Q.value = 0.5;
  src.connect(alto).connect(paso).connect(off.destination); src.start();
  const k = await off.startRendering(), sr = buffer.sampleRate, bloque = Math.floor(sr * 0.4), salto = Math.floor(sr * 0.1);
  const canales = [...Array(k.numberOfChannels)].map((_, i) => k.getChannelData(i)), energias = [];
  for (let i = 0; i + bloque <= k.length; i += salto) {
    let s = 0; for (const ch of canales) { let a = 0; for (let j = i; j < i + bloque; j++) a += ch[j] * ch[j]; s += a / bloque; }
    energias.push(s);
  }
  const lufs = (e) => -0.691 + 10 * Math.log10(e), media = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  const abs = energias.filter((e) => e > 0 && lufs(e) > -70);
  const rel = abs.filter((e) => lufs(e) > lufs(media(abs)) - 10);
  const integrado = rel.length ? lufs(media(rel)) : -70;
  let pico = 0; for (let c = 0; c < buffer.numberOfChannels; c++) { const d = buffer.getChannelData(c); for (let j = 0; j < d.length; j++) { const v = Math.abs(d[j]); if (v > pico) pico = v; } }
  const picoDb = 20 * Math.log10(pico || 1e-9);
  const ganancia = Math.min(objetivo - integrado, picoMax - picoDb); // nunca sube tanto que sature
  return { lufs: integrado, picoDb, gananciaDb: ganancia, final: integrado + ganancia };
}
