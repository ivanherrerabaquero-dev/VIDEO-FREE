// VIDEO-FREE · Conexión con GitHub: el portal lee y guarda proyectos, ideas y medios en tu repo.
// Usa la API oficial de GitHub directamente desde el navegador. El token se guarda solo en este
// navegador (localStorage) y solo se envía a api.github.com.

const CLAVE = "videofree.github";
const API = "https://api.github.com";

/** Si el portal está en usuario.github.io/repo, deduce dueño y repo de la dirección. */
function deducir() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  return m ? { dueno: m[1], repo: location.pathname.split("/").filter(Boolean)[0] || "" } : { dueno: "", repo: "" };
}
export function config() {
  let g = {}; try { g = JSON.parse(localStorage.getItem(CLAVE) || "{}"); } catch {}
  return { rama: "main", token: "", ...deducir(), ...g };
}
export function guardarConfig(c) { try { localStorage.setItem(CLAVE, JSON.stringify(c)); } catch {} }
export const conectado = () => { const c = config(); return !!(c.token && c.dueno && c.repo); };

const aBase64 = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const deBase64 = (b64) => Uint8Array.from(atob(b64.replace(/\s/g, "")), (ch) => ch.charCodeAt(0));
const ruta = (p) => p.split("/").map(encodeURIComponent).join("/");

async function pedir(metodo, camino, cuerpo) {
  const c = config();
  const r = await fetch(`${API}/repos/${c.dueno}/${c.repo}${camino ? "/" + camino : ""}`, {
    method: metodo,
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(c.token ? { Authorization: `Bearer ${c.token}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  if (r.status === 404) return null;
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    const pista = r.status === 401 ? " El token no es válido o venció." : r.status === 403 ? " El token no tiene permiso de escritura sobre este repo (Contents: Read and write)." : r.status === 409 ? " Alguien cambió el archivo; vuelve a cargarlo." : "";
    throw new Error(`GitHub respondió ${r.status}: ${d.message || "error"}.${pista}`);
  }
  return r.json();
}

/** Comprueba el token y el repo. Devuelve { nombre, privado, puedeEscribir }. */
export async function probar() {
  const d = await pedir("GET", "");
  if (!d) throw new Error("No encuentro ese repo. Revisa dueño y nombre, y que el token tenga acceso a él.");
  return { nombre: d.full_name, privado: d.private, puedeEscribir: !!(d.permissions && d.permissions.push) };
}

/** Lee un archivo del repo. Devuelve { texto, bytes, sha } o null si no existe. */
export async function leer(camino) {
  const d = await pedir("GET", `contents/${ruta(camino)}?ref=${encodeURIComponent(config().rama)}&t=${Date.now()}`);
  if (!d || Array.isArray(d)) return null;
  let bytes = deBase64(d.content || "");
  if (d.encoding === "none" || (!bytes.length && d.size > 0)) { // archivos de más de 1 MB: la API no los manda en base64
    const c = config(), r = await fetch(`${API}/repos/${c.dueno}/${c.repo}/contents/${ruta(camino)}?ref=${encodeURIComponent(c.rama)}&t=${Date.now()}`, { headers: { Accept: "application/vnd.github.raw+json", "X-GitHub-Api-Version": "2022-11-28", ...(c.token ? { Authorization: `Bearer ${c.token}` } : {}) } });
    if (!r.ok) throw new Error(`GitHub respondió ${r.status} al leer ${camino}.`);
    bytes = new Uint8Array(await r.arrayBuffer());
  }
  return { texto: new TextDecoder().decode(bytes), bytes, sha: d.sha };
}

/** Lista los archivos de una carpeta del repo. */
export async function listar(carpeta) {
  const d = await pedir("GET", `contents/${ruta(carpeta)}?ref=${encodeURIComponent(config().rama)}&t=${Date.now()}`);
  return Array.isArray(d) ? d.filter((x) => x.type === "file").map((x) => ({ nombre: x.name, camino: x.path, tam: x.size })) : [];
}

/** Guarda (crea o actualiza) un archivo con un commit. `contenido` puede ser texto o Uint8Array. */
export async function guardar(camino, contenido, mensaje) {
  const bytes = typeof contenido === "string" ? new TextEncoder().encode(contenido) : contenido;
  const actual = await pedir("GET", `contents/${ruta(camino)}?ref=${encodeURIComponent(config().rama)}&t=${Date.now()}`);
  const r = await pedir("PUT", `contents/${ruta(camino)}`, { message: mensaje, content: aBase64(bytes), branch: config().rama, ...(actual && actual.sha ? { sha: actual.sha } : {}) });
  return r.commit.sha;
}
