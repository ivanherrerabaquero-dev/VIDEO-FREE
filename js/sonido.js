// VIDEO-FREE · Sonido: cargar la canción y medir su volumen.
// Todo con la Web Audio API del navegador, sin librerías.

let ctx = null;
export const contexto = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());

export async function decodificar(arrayBuffer) { return await contexto().decodeAudioData(arrayBuffer); }
export async function cargarAudio(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(`No pude abrir ${url}`);
  return decodificar(await r.arrayBuffer());
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
