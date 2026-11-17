// VIDEO-FREE · Exportar: graba el lienzo y la canción con el grabador del navegador (MediaRecorder).
// La grabación va en tiempo real: una canción de 3 minutos tarda 3 minutos.

import { dibujar, FORMATOS } from "./motor.js";
import { contexto } from "./sonido.js";

const TIPOS = [
  ["video/mp4;codecs=avc1.640028,mp4a.40.2", "mp4"],
  ["video/mp4", "mp4"],
  ["video/webm;codecs=vp9,opus", "webm"],
  ["video/webm;codecs=vp8,opus", "webm"],
  ["video/webm", "webm"],
];
export const tipoDisponible = () => TIPOS.find(([t]) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || null;

/**
 * Graba el video completo. opciones: { formato, modo, gananciaDb, desde, hasta, progreso(k), cancelar: {ya:false} }
 * Devuelve { blob, extension }.
 */
export async function grabarVideo(proyecto, recursos, buffer, opciones = {}) {
  const tipo = tipoDisponible(); if (!tipo) throw new Error("Este navegador no puede grabar video. Usa Chrome o Edge actualizados.");
  const { ancho, alto } = FORMATOS[opciones.formato || "horizontal"], fps = proyecto.fps || 30;
  const lienzo = document.createElement("canvas"); lienzo.width = ancho; lienzo.height = alto;
  const c = lienzo.getContext("2d"), ac = contexto(); await ac.resume();
  const desde = opciones.desde || 0, hasta = Math.min(opciones.hasta || proyecto.duracion, proyecto.duracion);
  dibujar(c, ancho, alto, proyecto, desde, recursos, opciones.modo);

  const flujo = lienzo.captureStream(fps), destino = ac.createMediaStreamDestination();
  const fuente = ac.createBufferSource(), ganancia = ac.createGain();
  if (buffer) { fuente.buffer = buffer; ganancia.gain.value = 10 ** ((opciones.gananciaDb || 0) / 20); fuente.connect(ganancia).connect(destino); }
  destino.stream.getAudioTracks().forEach((p) => flujo.addTrack(p));
  const grabador = new MediaRecorder(flujo, { mimeType: tipo[0], videoBitsPerSecond: opciones.bitrate || 12_000_000, audioBitsPerSecond: 256_000 });
  const trozos = []; grabador.ondataavailable = (e) => e.data.size && trozos.push(e.data);
  const fin = new Promise((ok, mal) => { grabador.onstop = ok; grabador.onerror = (e) => mal(e.error || new Error("Falló la grabación")); });

  recursos.reproduciendo = true;
  grabador.start(1000);
  const t0 = ac.currentTime + 0.05;
  if (buffer) fuente.start(t0, desde);
  await new Promise((ok) => {
    const cuadro = () => {
      const t = desde + Math.max(0, ac.currentTime - t0);
      if (t >= hasta || (opciones.cancelar && opciones.cancelar.ya)) return ok();
      dibujar(c, ancho, alto, proyecto, t, recursos, opciones.modo);
      opciones.progreso && opciones.progreso((t - desde) / (hasta - desde));
      requestAnimationFrame(cuadro);
    };
    cuadro();
  });
  recursos.reproduciendo = false;
  try { buffer && fuente.stop(); } catch {}
  grabador.stop(); await fin;
  flujo.getTracks().forEach((p) => p.stop());
  if (opciones.cancelar && opciones.cancelar.ya) throw new Error("Grabación cancelada.");
  return { blob: new Blob(trozos, { type: tipo[0].split(";")[0] }), extension: tipo[1] };
}

/** Exporta un fotograma como PNG (portada o miniatura). */
export function exportarImagen(proyecto, recursos, formato = "portada", modo = "portada", t = 0) {
  const { ancho, alto } = FORMATOS[formato], lienzo = document.createElement("canvas"); lienzo.width = ancho; lienzo.height = alto;
  dibujar(lienzo.getContext("2d"), ancho, alto, proyecto, t, recursos, modo);
  return new Promise((ok) => lienzo.toBlob(ok, "image/png"));
}

export function descargar(blob, nombre) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}
