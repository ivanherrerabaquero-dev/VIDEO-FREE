// VIDEO-FREE · El portal: une el motor, el sonido, la voz, la exportación y GitHub.
import { dibujar, FORMATOS, TIPOS_ESCENA, mediosDe, limitar } from "./motor.js";
import { contexto, decodificar, cargarAudio, pistaDemo, medirVolumen } from "./sonido.js";
import { analizarVoz, letraSegunVoz } from "./voz.js";
import { grabarVideo, exportarImagen, descargar, tipoDisponible } from "./exportar.js";
import { cantar, mezclar, aWav } from "./canto.js";
import * as gh from "./github.js";

const $ = (id) => document.getElementById(id);
const E = { proyecto: null, archivo: "carretera-sin-ti.json", R: { img: {}, video: {}, reproduciendo: false }, buffer: null, canto: null, mezcla: null, bufferVoz: null, t: 0, sonando: false, fuente: null, t0: 0, audioLocal: "" };
window.estudio = E; // para depurar desde la consola

const estado = (txt, clase = "") => { $("estado").textContent = txt; $("estado").className = "estado " + clase; };
const fallo = (e) => { console.error(e); estado(e.message || String(e), "mal"); };
const seguro = (f) => async (...a) => { try { await f(...a); } catch (e) { fallo(e); } };
const sonido = () => E.mezcla || E.buffer; // la canción, con la voz cantada si se generó
const mmss = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "proyecto";

// ───────────── Carga de archivos (del sitio o, si aún no se publicó, directo de GitHub) ─────────────
async function bytesDe(camino) {
  if (gh.conectado()) { const d = await gh.leer(camino).catch(() => null); if (d) return d.bytes; }
  const r = await fetch(`${camino}?t=${Date.now()}`); if (!r.ok) throw new Error(`No encuentro ${camino}`);
  return new Uint8Array(await r.arrayBuffer());
}
const urlDe = async (camino) => URL.createObjectURL(new Blob([await bytesDe(camino)]));

function cargarImagen(camino) {
  return new Promise((ok) => {
    const im = new Image();
    im.onload = () => ok(im);
    im.onerror = async () => { try { const i2 = new Image(); i2.onload = () => ok(i2); i2.onerror = () => ok(null); i2.src = await urlDe(camino); } catch { ok(null); } };
    im.src = camino;
  });
}
async function cargarMedios() {
  const m = mediosDe(E.proyecto), faltan = [];
  await Promise.all(m.img.filter((c) => !E.R.img[c]).map(async (c) => { const im = await cargarImagen(c); im ? (E.R.img[c] = im) : faltan.push(c); }));
  for (const c of m.video) if (!E.R.video[c]) {
    const v = document.createElement("video"); v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = c;
    await new Promise((ok) => { v.onloadeddata = ok; v.onerror = () => { faltan.push(c); ok(); }; });
    E.R.video[c] = v;
  }
  if (faltan.length) estado(`No encontré: ${faltan.join(", ")}`, "mal");
}

function remezclar() { E.mezcla = E.canto ? mezclar(contexto(), E.buffer, E.canto, (E.proyecto.canto && E.proyecto.canto.volumen) ?? 0.8, E.proyecto.duracion) : null; }
async function cargarCancion() { try { await cargarCancionBase(); } finally { remezclar(); } }
async function cargarCancionBase() {
  const p = E.proyecto;
  if (E.audioLocal) { $("infoAudio").textContent = `Sonando: ${E.audioLocal} (archivo de este equipo; súbelo en Medios para que quede en el repo).`; return; }
  if (!p.audio || p.audio === "demo") { E.buffer = pistaDemo(p.duracion, p.bpm); $("infoAudio").textContent = "Sonando: pista de prueba generada por el estudio. Carga tu canción para reemplazarla."; return; }
  try {
    E.buffer = await decodificar((await bytesDe(p.audio)).buffer);
    $("infoAudio").textContent = `Sonando: ${p.audio} (${mmss(E.buffer.duration)}).`;
  } catch (e) { E.buffer = null; $("infoAudio").textContent = `No pude abrir ${p.audio}.`; throw e; }
}

// ───────────── Vista previa y reproducción ─────────────
const lienzo = $("lienzo"), c2d = lienzo.getContext("2d");
function ajustarLienzo() {
  const modo = $("selModo").value, f = FORMATOS[modo === "portada" ? "cuadrado" : $("selFormato").value], k = 960 / Math.max(f.ancho, f.alto);
  lienzo.width = Math.round(f.ancho * k); lienzo.height = Math.round(f.alto * k);
}
function pintar() {
  if (!E.proyecto) return;
  dibujar(c2d, lienzo.width, lienzo.height, E.proyecto, E.t, E.R, $("selModo").value);
  $("cursor").value = E.t; $("reloj").textContent = `${mmss(E.t)} / ${mmss(E.proyecto.duracion)}`;
  const aguja = $("pista").querySelector("i"); if (aguja) aguja.style.left = `${(E.t / E.proyecto.duracion) * 100}%`;
}
function parar() {
  E.sonando = false; E.R.reproduciendo = false;
  try { E.fuente && E.fuente.stop(); } catch {} E.fuente = null;
  $("btnPlay").textContent = "▶ Reproducir"; pintar();
}
async function reproducir(desde = E.t) {
  const ac = contexto(); await ac.resume();
  if (desde >= E.proyecto.duracion - 0.05) desde = 0;
  const b = sonido(); if (b) { E.fuente = ac.createBufferSource(); E.fuente.buffer = b; E.fuente.connect(ac.destination); E.fuente.start(0, Math.min(desde, b.duration)); }
  E.t0 = ac.currentTime - desde; E.sonando = true; E.R.reproduciendo = true; $("btnPlay").textContent = "❚❚ Pausar";
  const cuadro = () => {
    if (!E.sonando) return;
    E.t = contexto().currentTime - E.t0;
    if (E.t >= E.proyecto.duracion) { E.t = E.proyecto.duracion; parar(); finToques(); return; }
    pintar(); requestAnimationFrame(cuadro);
  };
  cuadro();
}
$("btnPlay").onclick = seguro(() => (E.sonando ? parar() : reproducir()));
$("cursor").oninput = (e) => { const s = E.sonando; if (s) parar(); E.t = +e.target.value; pintar(); if (s) reproducir(); };
$("pista").onclick = (e) => { const r = $("pista").getBoundingClientRect(), s = E.sonando; if (s) parar(); E.t = limitar((e.clientX - r.left) / r.width) * E.proyecto.duracion; pintar(); if (s) reproducir(); };
$("selFormato").onchange = $("selModo").onchange = () => { ajustarLienzo(); pintar(); };

// ───────────── Pestañas ─────────────
$("pestanas").onclick = (e) => {
  const b = e.target.closest("button"); if (!b) return;
  document.querySelectorAll("#pestanas button").forEach((x) => x.classList.toggle("activa", x === b));
  document.querySelectorAll(".hoja").forEach((h) => (h.hidden = h.id !== "p-" + b.dataset.p));
};

// ───────────── Proyecto ─────────────
const COLORES = { titulo: "#ffb36b", auto: "#ffd28a", dron: "#8fd0ff", carretera: "#ff8a3d", recuerdo: "#ffd9a0", cierre: "#7d8cff", foto: "#b9e08f", video: "#e08fd6" };
function llenarFormulario() {
  const p = E.proyecto;
  $("fTitulo").value = p.titulo || ""; $("fArtista").value = p.artista || ""; $("fBpm").value = p.bpm; $("fDur").value = p.duracion;
  $("fAcento").value = p.colores.acento; $("fNoche").value = p.colores.acentoNoche; $("fTexto").value = p.colores.texto;
  $("fAudioRuta").value = p.audio && p.audio !== "demo" ? p.audio : "";
  const ct = p.canto || {}; $("selMelodia").value = ct.melodia || "voz"; $("selOctava").value = ct.octava || 0; $("rCanto").value = ct.volumen ?? 0.8;
  $("cursor").max = p.duracion; $("chkLetra").checked = p.mostrarLetra !== false; $("chkReactiva").checked = p.vozReactiva !== false;
  $("tLetra").value = (p.letra || []).map((l) => l.texto).join("\n");
  pintarEscenas(); pintarVoz();
}
function pintarPista() {
  const p = E.proyecto;
  $("pista").innerHTML = p.escenas.map((e) => `<span style="left:${(e.desde / p.duracion) * 100}%;width:${((e.hasta - e.desde) / p.duracion) * 100}%;background:${COLORES[e.tipo] || "#999"}">${e.tipo}</span>`).join("") + "<i></i>";
}
const campo = (id, f) => ($(id).oninput = seguro(async (e) => { await f(e.target); pintarPista(); pintar(); }));
campo("fTitulo", (x) => (E.proyecto.titulo = x.value));
campo("fArtista", (x) => (E.proyecto.artista = x.value));
campo("fBpm", (x) => (E.proyecto.bpm = +x.value || 95));
campo("fAcento", (x) => (E.proyecto.colores.acento = x.value));
campo("fNoche", (x) => (E.proyecto.colores.acentoNoche = x.value));
campo("fTexto", (x) => (E.proyecto.colores.texto = x.value));
campo("chkLetra", (x) => (E.proyecto.mostrarLetra = x.checked));
campo("chkReactiva", (x) => (E.proyecto.vozReactiva = x.checked));
$("fDur").onchange = seguro(async (e) => { E.proyecto.duracion = Math.max(1, +e.target.value || 1); $("cursor").max = E.proyecto.duracion; if (!E.audioLocal && (!E.proyecto.audio || E.proyecto.audio === "demo")) await cargarCancion(); pintarPista(); pintar(); });
$("fAudio").onchange = seguro(async (e) => {
  const f = e.target.files[0]; if (!f) return; parar();
  E.buffer = await decodificar(await f.arrayBuffer()); E.audioLocal = f.name;
  E.proyecto.duracion = Math.round(E.buffer.duration * 10) / 10; llenarFormulario(); await cargarCancion(); pintarPista(); pintar();
  estado(`Canción cargada: ${f.name}. La duración del proyecto quedó en ${mmss(E.proyecto.duracion)}.`, "bien");
});
$("fAudioRuta").onchange = seguro(async (e) => { parar(); E.audioLocal = ""; E.proyecto.audio = e.target.value.trim() || "demo"; await cargarCancion(); if (E.buffer && E.proyecto.audio !== "demo") { E.proyecto.duracion = Math.round(E.buffer.duration * 10) / 10; llenarFormulario(); } pintarPista(); pintar(); });

async function abrirProyecto(datos, archivo) {
  parar(); E.proyecto = datos; E.archivo = archivo; E.t = 0; E.audioLocal = ""; E.canto = null; E.mezcla = null;
  E.proyecto.colores ||= { acento: "#ff8a3d", acentoNoche: "#3fd6ff", texto: "#fff6ea" }; E.proyecto.escenas ||= []; E.proyecto.letra ||= [];
  llenarFormulario(); pintarPista(); ajustarLienzo();
  await Promise.all([cargarMedios(), cargarCancion().catch(fallo)]);
  if (E.proyecto.canto && E.proyecto.canto.activo) await generarCanto(true).catch(fallo);
  pintar();
}
async function listarProyectos() {
  let nombres = [];
  if (gh.conectado()) nombres = (await gh.listar("proyectos").catch(() => [])).map((x) => x.nombre).filter((n) => n.endsWith(".json") && n !== "indice.json");
  if (!nombres.length) nombres = JSON.parse(new TextDecoder().decode(await bytesDe("proyectos/indice.json")));
  if (!nombres.includes(E.archivo)) nombres.push(E.archivo);
  $("selProyecto").innerHTML = nombres.map((n) => `<option ${n === E.archivo ? "selected" : ""}>${n}</option>`).join("");
}
$("selProyecto").onchange = seguro(async (e) => { const n = e.target.value; await abrirProyecto(JSON.parse(new TextDecoder().decode(await bytesDe(`proyectos/${n}`))), n); estado(`Abierto: ${n}`, "bien"); });
$("btnNuevo").onclick = seguro(async () => {
  const p = JSON.parse(JSON.stringify(E.proyecto)); p.titulo = "Proyecto nuevo"; p.letra = []; p.voz = null; p.audio = "demo";
  await abrirProyecto(p, ""); estado("Proyecto nuevo creado a partir del actual. Ponle título y guárdalo.", "bien");
});
$("btnBajarJson").onclick = () => descargar(new Blob([JSON.stringify(E.proyecto, null, 2)], { type: "application/json" }), E.archivo || `${slug(E.proyecto.titulo)}.json`);
$("fJson").onchange = seguro(async (e) => { const f = e.target.files[0]; if (!f) return; await abrirProyecto(JSON.parse(await f.text()), f.name); await listarProyectos(); estado(`Abierto: ${f.name}`, "bien"); });
$("btnGuardar").onclick = seguro(async () => {
  if (!gh.conectado()) throw new Error("Primero conecta GitHub en la pestaña GitHub (o usa «Descargar proyecto»).");
  E.archivo ||= `${slug(E.proyecto.titulo)}.json`;
  estado("Guardando en GitHub…");
  await gh.guardar(`proyectos/${E.archivo}`, JSON.stringify(E.proyecto, null, 2) + "\n", `Proyecto: ${E.proyecto.titulo}`);
  const lista = (await gh.listar("proyectos")).map((x) => x.nombre).filter((n) => n.endsWith(".json") && n !== "indice.json");
  await gh.guardar("proyectos/indice.json", JSON.stringify(lista) + "\n", "Actualiza la lista de proyectos");
  await listarProyectos(); estado(`Guardado en GitHub: proyectos/${E.archivo}`, "bien");
});

// ───────────── Escenas ─────────────
function pintarEscenas() {
  const caja = $("listaEscenas"); caja.innerHTML = "";
  E.proyecto.escenas.forEach((e, i) => {
    const { tipo, desde, hasta, ...resto } = e, d = document.createElement("div"); d.className = "escena"; d.style.borderLeftColor = COLORES[tipo] || "#999";
    d.innerHTML = `<div class="fila"><label>Tipo <select>${TIPOS_ESCENA.map((t) => `<option ${t === tipo ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label>Desde <input type="number" step="0.1" min="0" value="${desde}"></label><label>Hasta <input type="number" step="0.1" min="0" value="${hasta}"></label>
      <button title="Ir a esta escena">Ver</button><button title="Quitar escena">✕</button></div>
      <label>Detalles <textarea rows="${Math.min(6, Object.keys(resto).length + 2)}" spellcheck="false"></textarea></label>`;
    const [sel, de, ha] = d.querySelectorAll("select,input"), ta = d.querySelector("textarea"), [ver, quitar] = d.querySelectorAll("button");
    ta.value = JSON.stringify(resto, null, 1);
    const aplicar = seguro(async () => {
      let extra; try { extra = JSON.parse(ta.value || "{}"); ta.style.borderColor = ""; } catch { ta.style.borderColor = "#ff6b6b"; return; }
      E.proyecto.escenas[i] = { tipo: sel.value, desde: +de.value, hasta: +ha.value, ...extra };
      d.style.borderLeftColor = COLORES[sel.value] || "#999"; pintarPista(); await cargarMedios(); pintar();
    });
    sel.onchange = de.onchange = ha.onchange = ta.oninput = aplicar;
    ver.onclick = () => { if (E.sonando) parar(); E.t = +de.value + Math.min(1, (+ha.value - +de.value) / 2); pintar(); };
    quitar.onclick = () => { E.proyecto.escenas.splice(i, 1); pintarEscenas(); pintarPista(); pintar(); };
    caja.appendChild(d);
  });
}
$("btnMasEscena").onclick = () => {
  const p = E.proyecto, ini = p.escenas.length ? Math.max(...p.escenas.map((e) => e.hasta)) : 0;
  p.escenas.push({ tipo: "dron", desde: ini, hasta: Math.min(p.duracion, ini + 5) || ini + 5, angulos: ["cenital", "persecucion", "lateral"], hora: [0.3, 0.6] });
  pintarEscenas(); pintarPista(); pintar();
};

// ───────────── Letra ─────────────
function leerLetra() {
  const lineas = $("tLetra").value.split("\n").map((s) => s.trim()).filter(Boolean), vieja = E.proyecto.letra || [];
  let fin = 0;
  E.proyecto.letra = lineas.map((texto, i) => {
    const v = vieja[i], l = v ? { inicio: v.inicio, fin: v.fin, texto, ...(v.texto === texto && v.palabras ? { palabras: v.palabras } : {}) } : { inicio: fin + 0.3, fin: fin + 2.8, texto };
    fin = l.fin; return l;
  });
  return lineas;
}
$("tLetra").oninput = () => { leerLetra(); pintar(); };
$("btnRepartir").onclick = () => {
  const lineas = leerLetra(), p = E.proyecto, ini = p.escenas[0] && p.escenas[0].tipo === "titulo" ? p.escenas[0].hasta : 0, tramoL = (p.duracion - ini - 1) / (lineas.length || 1);
  p.letra = lineas.map((texto, i) => ({ inicio: +(ini + i * tramoL + 0.2).toFixed(2), fin: +(ini + (i + 1) * tramoL - 0.1).toFixed(2), texto }));
  pintar(); estado("Letra repartida de forma pareja a lo largo de la canción.", "bien");
};
$("btnLetraVoz").onclick = seguro(() => {
  const v = E.proyecto.voz; if (!v || !v.segmentos || !v.segmentos.length) throw new Error("Primero analiza la voz en la pestaña Voz.");
  const lineas = leerLetra(), r = letraSegunVoz(lineas, v.segmentos); if (!r) throw new Error("No hay letra para acomodar.");
  E.proyecto.letra = r; pintar();
  estado(v.segmentos.length === lineas.length ? "Cada línea quedó sobre una frase cantada." : `La voz tiene ${v.segmentos.length} frases y la letra ${lineas.length} líneas: las repartí sobre el tiempo cantado. Revisa y ajusta con toques.`, "bien");
});
// Sincronizar con toques: cada toque marca el inicio de la siguiente palabra
const T = { activo: false, palabras: [], k: 0 };
$("btnToques").onclick = seguro(async () => {
  leerLetra(); if (!E.proyecto.letra.length) throw new Error("Escribe la letra primero.");
  T.palabras = E.proyecto.letra.flatMap((l, i) => l.texto.split(/\s+/).filter(Boolean).map((p) => ({ p, linea: i, inicio: null })));
  T.k = 0; T.activo = true; $("zonaToques").hidden = false; $("palabraActual").textContent = "▶ " + T.palabras[0].p;
  parar(); E.t = 0; await reproducir(0); $("btnToque").focus();
});
function toque() {
  if (!T.activo || T.k >= T.palabras.length) return;
  T.palabras[T.k].inicio = Math.max(0, E.t - 0.08); T.k++; // 80 ms de reacción al tocar
  $("palabraActual").textContent = T.k < T.palabras.length ? "▶ " + T.palabras[T.k].p : "¡Listo!";
  if (T.k >= T.palabras.length) setTimeout(finToques, 600);
}
function finToques() {
  if (!T.activo) return; T.activo = false; $("zonaToques").hidden = true; if (E.sonando) parar();
  let hechas = 0;
  E.proyecto.letra.forEach((l, i) => {
    const ps = T.palabras.filter((w) => w.linea === i); if (!ps.length || ps.some((w) => w.inicio === null)) return;
    const sig = T.palabras.find((w) => w.linea > i && w.inicio !== null);
    l.palabras = ps.map((w, j) => ({ p: w.p, inicio: +w.inicio.toFixed(2), fin: +Math.min(w.inicio + 1.5, ps[j + 1] ? ps[j + 1].inicio : Math.min(w.inicio + 1, sig ? sig.inicio - 0.05 : Infinity)).toFixed(2) }));
    l.inicio = l.palabras[0].inicio; l.fin = l.palabras.at(-1).fin; hechas++;
  });
  pintar(); estado(`Sincronicé ${hechas} de ${E.proyecto.letra.length} líneas con tus toques.`, "bien");
}
$("btnToque").onclick = toque; $("btnPararToques").onclick = finToques;
addEventListener("keydown", (e) => { if (T.activo && e.code === "Space") { e.preventDefault(); if (!e.repeat) toque(); } });

// ───────────── Voz ─────────────
function pintarVoz() {
  const v = E.proyecto.voz, caja = $("resVoz"), g = $("grafVoz");
  if (!v || !v.resumen) { caja.innerHTML = v ? "<div><b>Resultado</b>No encontré voz cantada clara en ese audio.</div>" : ""; g.hidden = true; return; }
  const r = v.resumen;
  caja.innerHTML = [["Nota más grave", r.grave], ["Nota central", r.centro], ["Nota más aguda", r.aguda], ["Rango", `${r.rangoSemitonos} semitonos`], ["Tonalidad probable", r.tonalidades[0]], ["Otras opciones", r.tonalidades.slice(1).join(" · ")], ["Voz activa", `${r.vozActiva} %`], ["Frases cantadas", r.frases]].map(([a, b]) => `<div><b>${a}</b>${b}</div>`).join("");
  g.hidden = false; const c = g.getContext("2d"), W = g.width, H = g.height, n = v.tono.length, notas = v.tono.filter((x) => x > 0), mn = Math.min(...notas) - 1, mx = Math.max(...notas) + 1;
  c.clearRect(0, 0, W, H); c.fillStyle = "rgba(63,214,255,.25)";
  for (let i = 0; i < n; i++) c.fillRect((i / n) * W, H - v.energia[i] * H * 0.35, Math.max(1, W / n), v.energia[i] * H * 0.35);
  c.fillStyle = "#ff8a3d"; for (let i = 0; i < n; i++) if (v.tono[i] > 0) c.fillRect((i / n) * W, H * 0.6 - ((v.tono[i] - mn) / (mx - mn)) * H * 0.55, 2, 2);
}
async function analizar(buffer, origen) {
  if (!buffer) throw new Error("No hay audio para analizar. Carga tu voz o una canción.");
  $("progVoz").hidden = false; estado("Analizando la voz…");
  const v = await analizarVoz(buffer, (k) => ($("progVoz").value = k));
  $("progVoz").hidden = true; E.proyecto.voz = v; pintarVoz(); pintar();
  estado(v.resumen ? `Voz analizada (${origen}): centro en ${v.resumen.centro}, tonalidad probable ${v.resumen.tonalidades[0]}.` : "No encontré voz cantada clara en ese audio.", v.resumen ? "bien" : "mal");
}
$("fVoz").onchange = seguro(async (e) => { const f = e.target.files[0]; if (f) { E.bufferVoz = await decodificar(await f.arrayBuffer()); estado(`Voz cargada: ${f.name}. Ahora pulsa «Analizar la voz».`, "bien"); } });
$("btnAnalizar").onclick = seguro(() => analizar(E.bufferVoz, "voz sola"));
$("btnAnalizarCancion").onclick = seguro(() => analizar(E.buffer, "canción completa"));

// ───────────── Voz cantada sintética ─────────────
async function generarCanto(silencioso = false) {
  const p = E.proyecto; parar(); leerLetraSiHaceFalta();
  if (p.voz && p.voz.deCanto) p.voz = null; // el análisis anterior venía del propio cantante sintético
  p.canto = { activo: true, melodia: $("selMelodia").value, octava: +$("selOctava").value, volumen: +$("rCanto").value };
  if (!silencioso) estado("Generando la voz cantada…");
  E.canto = await cantar(p, p.canto); remezclar();
  const conMelodiaPropia = p.canto.melodia === "voz" && p.voz && p.voz.resumen;
  if (!p.voz) { p.voz = await analizarVoz(E.canto); p.voz.deCanto = true; pintarVoz(); } // así el video también reacciona a esta voz
  $("infoCanto").textContent = `Voz cantada lista: ${p.letra.length} líneas, ${conMelodiaPropia ? "con la melodía de tu pista de voz" : "con melodía compuesta por el estudio"}. Si cambias la letra o los tiempos, vuelve a generarla.`;
  pintar(); if (!silencioso) estado("Voz cantada generada. Pulsa Reproducir para oírla.", "bien");
}
const leerLetraSiHaceFalta = () => { if (!(E.proyecto.letra || []).length) leerLetra(); };
$("btnCantar").onclick = seguro(() => generarCanto());
$("btnQuitarCanto").onclick = () => { parar(); E.canto = null; E.mezcla = null; if (E.proyecto.canto) E.proyecto.canto.activo = false; if (E.proyecto.voz && E.proyecto.voz.deCanto) { E.proyecto.voz = null; pintarVoz(); } $("infoCanto").textContent = "Voz cantada quitada."; pintar(); };
$("btnBajarCanto").onclick = seguro(() => { if (!E.canto) throw new Error("Primero genera la voz cantada."); descargar(aWav(E.canto), `${slug(E.proyecto.titulo)}_voz_cantada.wav`); });
$("rCanto").onchange = () => { if (E.proyecto.canto) E.proyecto.canto.volumen = +$("rCanto").value; const s = E.sonando; if (s) parar(); remezclar(); if (s) reproducir(); };

// ───────────── Medios: quitar fondo y subir ─────────────
let imagenOriginal = null;
function quitarFondo(datos, tol) {
  const { width: W, height: H, data: d } = datos, n = W * H, borde = [];
  for (let x = 0; x < W; x++) borde.push(x, (H - 1) * W + x); for (let y = 0; y < H; y++) borde.push(y * W, y * W + W - 1);
  const med = [0, 1, 2].map((k) => borde.map((i) => d[i * 4 + k]).sort((a, b) => a - b)[borde.length >> 1]);
  const parecido = (i) => Math.hypot(d[i * 4] - med[0], d[i * 4 + 1] - med[1], d[i * 4 + 2] - med[2]) < tol;
  const fondo = new Uint8Array(n), pila = borde.filter(parecido); pila.forEach((i) => (fondo[i] = 1));
  while (pila.length) { // solo cuenta como fondo lo que toca el borde (no borra una camiseta blanca)
    const i = pila.pop(), x = i % W;
    for (const j of [i - W, i + W, x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1]) if (j >= 0 && j < n && !fondo[j] && parecido(j)) { fondo[j] = 1; pila.push(j); }
  }
  let a = Float32Array.from(fondo, (f) => (f ? 0 : 255));
  for (let pasada = 0; pasada < 2; pasada++) { // suaviza el borde del recorte
    const b = new Float32Array(n);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0, c = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && xx < W && yy >= 0 && yy < H) { s += a[yy * W + xx]; c++; } } b[y * W + x] = Math.min(a[y * W + x], s / c); }
    a = b;
  }
  for (let i = 0; i < n; i++) d[i * 4 + 3] = a[i];
  return datos;
}
function pintarMedio() {
  if (!imagenOriginal) return;
  const cv = $("vistaImagen"), k = Math.min(1, 2000 / Math.max(imagenOriginal.width, imagenOriginal.height));
  cv.width = Math.round(imagenOriginal.width * k); cv.height = Math.round(imagenOriginal.height * k); cv.hidden = false;
  const c = cv.getContext("2d", { willReadFrequently: true }); c.drawImage(imagenOriginal, 0, 0, cv.width, cv.height);
  if ($("chkFondo").checked) c.putImageData(quitarFondo(c.getImageData(0, 0, cv.width, cv.height), +$("rTol").value), 0, 0);
}
$("fImagen").onchange = seguro(async (e) => {
  const f = e.target.files[0]; if (!f) return;
  imagenOriginal = await createImageBitmap(f); $("fNombreMedio").value = `medios/personajes/${slug(f.name.replace(/\.[^.]+$/, ""))}.png`; pintarMedio();
});
$("rTol").onchange = $("chkFondo").onchange = pintarMedio;
const pngMedio = () => new Promise((ok) => $("vistaImagen").toBlob(ok, "image/png"));
$("btnBajarMedio").onclick = seguro(async () => { if (!imagenOriginal) throw new Error("Carga una imagen primero."); descargar(await pngMedio(), $("fNombreMedio").value.split("/").pop() || "personaje.png"); });
async function subir(camino, bytes) {
  if (!gh.conectado()) throw new Error("Primero conecta GitHub en la pestaña GitHub.");
  if (bytes.length > 40 * 1024 * 1024) throw new Error("El archivo pesa más de 40 MB. Redúcelo antes de subirlo.");
  estado(`Subiendo ${camino}…`); await gh.guardar(camino, bytes, `Medio: ${camino}`); estado(`Subido: ${camino}. Ya puedes usar esa ruta en tus escenas.`, "bien");
}
$("btnSubirMedio").onclick = seguro(async () => { if (!imagenOriginal) throw new Error("Carga una imagen primero."); await subir($("fNombreMedio").value.trim(), new Uint8Array(await (await pngMedio()).arrayBuffer())); });
$("btnSubirArchivo").onclick = seguro(async () => {
  const f = $("fSubir").files[0]; if (!f) throw new Error("Elige un archivo.");
  const camino = `${$("selCarpeta").value}/${slug(f.name.replace(/\.[^.]+$/, ""))}.${f.name.split(".").pop().toLowerCase()}`;
  await subir(camino, new Uint8Array(await f.arrayBuffer()));
  if (f.type.startsWith("audio/")) { $("fAudioRuta").value = camino; E.proyecto.audio = camino; E.audioLocal = ""; await cargarCancion(); }
});

// ───────────── Exportar ─────────────
const cancelar = { ya: false };
$("infoExport").textContent = tipoDisponible() ? `Este navegador graba en ${tipoDisponible()[1].toUpperCase()}.` : "Este navegador no puede grabar video. Usa Chrome o Edge actualizados.";
$("btnGrabar").onclick = seguro(async () => {
  parar(); cancelar.ya = false;
  const modo = $("selModo").value === "portada" ? "video" : $("selModo").value, formato = $("selFormato").value;
  let gananciaDb = 0, nota = "";
  if ($("chkLufs").checked && sonido()) { estado("Midiendo el volumen…"); const m = await medirVolumen(sonido()); gananciaDb = m.gananciaDb; nota = ` Volumen: de ${m.lufs.toFixed(1)} a ${m.final.toFixed(1)} LUFS.`; }
  $("btnGrabar").disabled = true; $("btnCancelar").hidden = false; $("progExport").hidden = false; estado("Grabando… deja esta pestaña visible.");
  try {
    const { blob, extension } = await grabarVideo(E.proyecto, E.R, sonido(), { formato, modo, gananciaDb, cancelar, progreso: (k) => ($("progExport").value = k) });
    const nombre = `${slug(E.proyecto.titulo)}_${modo}_${formato}.${extension}`; descargar(blob, nombre);
    $("resExport").innerHTML = `<p>Listo: <a download="${nombre}" href="${URL.createObjectURL(blob)}">${nombre}</a> (${(blob.size / 1048576).toFixed(1)} MB).${nota}</p>`;
    estado("Video grabado.", "bien");
  } finally { $("btnGrabar").disabled = false; $("btnCancelar").hidden = true; $("progExport").hidden = true; pintar(); }
});
$("btnCancelar").onclick = () => (cancelar.ya = true);
$("btnPortada").onclick = seguro(async () => descargar(await exportarImagen(E.proyecto, E.R), `${slug(E.proyecto.titulo)}_portada.png`));

// ───────────── Ideas y GitHub ─────────────
$("btnGuardarIdeas").onclick = seguro(async () => { if (!gh.conectado()) throw new Error("Primero conecta GitHub en la pestaña GitHub."); estado("Guardando ideas…"); await gh.guardar("ideas/ideas.md", $("tIdeas").value, "Ideas"); estado("Ideas guardadas en GitHub.", "bien"); });
function llenarGithub() { const c = gh.config(); $("gDueno").value = c.dueno; $("gRepo").value = c.repo; $("gRama").value = c.rama; $("gToken").value = c.token; }
$("btnConectar").onclick = seguro(async () => {
  gh.guardarConfig({ dueno: $("gDueno").value.trim(), repo: $("gRepo").value.trim(), rama: $("gRama").value.trim() || "main", token: $("gToken").value.trim() });
  const r = await gh.probar();
  $("infoGithub").textContent = `Conectado a ${r.nombre} (${r.privado ? "privado" : "público"}). ${r.puedeEscribir ? "Puedes guardar." : "Este token solo permite leer: revisa el permiso Contents."}`;
  estado(`GitHub conectado: ${r.nombre}`, "bien"); await listarProyectos();
});
$("btnOlvidar").onclick = () => { const c = gh.config(); gh.guardarConfig({ ...c, token: "" }); llenarGithub(); $("infoGithub").textContent = "Token borrado de este navegador."; };

// ───────────── Arranque ─────────────
seguro(async () => {
  llenarGithub();
  const datos = JSON.parse(new TextDecoder().decode(await bytesDe(`proyectos/${E.archivo}`)));
  await abrirProyecto(datos, E.archivo); await listarProyectos();
  $("tIdeas").value = new TextDecoder().decode(await bytesDe("ideas/ideas.md").catch(() => new Uint8Array()));
  estado(gh.conectado() ? "Listo. GitHub conectado." : "Listo. Conecta GitHub para guardar desde aquí.", "bien");
})();
