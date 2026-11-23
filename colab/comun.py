"""VIDEO-FREE · utilidades comunes para los cuadernos de Colab.

Conecta Colab con el repositorio de GitHub: lee el proyecto (letra, BPM, tonalidad, escenas),
guarda los resultados (canción, voz, clips) y deja copia en Google Drive.

El token de GitHub se lee de los "Secretos" de Colab (icono de llave, nombre GITHUB_TOKEN).
Sin token, los cuadernos pueden leer el repo público pero no guardar en él.
"""
from __future__ import annotations

import base64
import difflib
import json
import os
import re
import shutil
import subprocess
import unicodedata
from pathlib import Path

import requests

REPO = os.environ.get("VIDEOFREE_REPO", "ivanherrerabaquero-dev/VIDEO-FREE")
RAMA = os.environ.get("VIDEOFREE_RAMA", "main")
API = "https://api.github.com"
TRABAJO = Path(os.environ.get("VIDEOFREE_TRABAJO", "/content/trabajo"))
_token: str | None = None
_drive: Path | None = None


# ───────────────────────── Entorno ─────────────────────────
def gpu() -> dict:
    """Nombre y memoria de la GPU (o {} si no hay)."""
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], capture_output=True, text=True, check=True).stdout.strip()
        nombre, mem = [x.strip() for x in out.splitlines()[0].split(",")]
        return {"nombre": nombre, "vram_gb": round(int(mem) / 1024, 1)}
    except Exception:
        return {}


def preparar(repo: str = REPO, rama: str = RAMA, usar_drive: bool = True, exigir_gpu: bool = True) -> dict:
    """Revisa la GPU, lee el token de GitHub y monta Google Drive. Llamar al inicio de cada cuaderno."""
    global REPO, RAMA, _token, _drive
    REPO, RAMA = repo, rama
    TRABAJO.mkdir(parents=True, exist_ok=True)
    g = gpu()
    if g:
        print(f"GPU: {g['nombre']} con {g['vram_gb']} GB")
    elif exigir_gpu:
        raise SystemExit("No hay GPU. En Colab: Entorno de ejecución → Cambiar tipo de entorno → GPU (T4, L4 o A100).")
    _token = os.environ.get("GITHUB_TOKEN")
    if not _token:
        try:  # Colab: Secretos (icono de llave)
            from google.colab import userdata  # type: ignore

            _token = userdata.get("GITHUB_TOKEN")
        except Exception:
            try:  # Kaggle: Add-ons → Secrets
                from kaggle_secrets import UserSecretsClient  # type: ignore

                for nombre_secreto in ("GITHUB_TOKEN", "TOKEN"):  # se acepta también «TOKEN»
                    try:
                        _token = UserSecretsClient().get_secret(nombre_secreto)
                        if _token:
                            break
                    except Exception:
                        _token = None
            except Exception:
                _token = None
    print("GitHub:", f"conectado a {REPO} ({RAMA})" if _token else "sin token (solo lectura). Agrega el secreto GITHUB_TOKEN para guardar.")
    if usar_drive:
        try:
            from google.colab import drive  # type: ignore

            drive.mount("/content/drive")
            _drive = Path("/content/drive/MyDrive/VIDEO-FREE")
            _drive.mkdir(parents=True, exist_ok=True)
            print("Drive: copias en", _drive)
        except Exception as e:  # fuera de Colab o sin permiso
            print("Drive no disponible:", e)
    return {"gpu": g, "token": bool(_token), "drive": str(_drive) if _drive else None}


def sh(cmd: str, cwd: str | None = None, env: dict | None = None) -> None:
    """Ejecuta un comando mostrando su salida; falla con un mensaje claro."""
    print("$", cmd)
    # la salida pasa por print(): así Colab la muestra en la celda (con subprocess.run directo se pierde)
    p = subprocess.Popen(cmd, shell=True, cwd=cwd, env={**os.environ, **(env or {})}, stdout=subprocess.PIPE,
                         stderr=subprocess.STDOUT, text=True, bufsize=1)
    ultimas = []
    for linea in p.stdout:
        print(linea, end="")
        ultimas = (ultimas + [linea.rstrip()])[-15:]
    if p.wait() != 0:
        raise RuntimeError(f"El comando falló ({p.returncode}): {cmd}\n" + "\n".join(ultimas))


# ───────────────────────── GitHub ─────────────────────────
def _cab(raw: bool = False) -> dict:
    h = {"Accept": "application/vnd.github.raw+json" if raw else "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if _token:
        h["Authorization"] = f"Bearer {_token}"
    return h


# Sin token (por ejemplo en Kaggle sin el secreto), lo que se «guarda» queda en esta carpeta, con las mismas rutas del repo,
# y se lee de aquí primero. En Kaggle es /kaggle/working/VIDEO-FREE: aparece en «Output» y se puede descargar.
SALIDA = os.environ.get("VIDEOFREE_SALIDA")


def leer(camino: str) -> bytes | None:
    """Lee un archivo del repo (cualquier tamaño hasta 100 MB). None si no existe."""
    if SALIDA and (Path(SALIDA) / camino).is_file():
        return (Path(SALIDA) / camino).read_bytes()
    url = f"{API}/repos/{REPO}/contents/{camino}?ref={RAMA}"
    r = requests.get(url, headers=_cab(raw=True), timeout=120)
    if r.status_code == 404:
        return None
    if r.status_code == 403 and not _token:  # límite de la API sin token: usar el enlace directo
        r = requests.get(f"https://raw.githubusercontent.com/{REPO}/{RAMA}/{camino}", timeout=120)
        if r.status_code == 404:
            return None
    r.raise_for_status()
    return r.content


def guardar(camino: str, datos: bytes | str, mensaje: str) -> str:
    """Crea o actualiza un archivo del repo con un commit. Devuelve el sha del commit."""
    if isinstance(datos, str):
        datos = datos.encode("utf-8")
    if not _token:
        if SALIDA:
            destino = Path(SALIDA) / camino
            destino.parent.mkdir(parents=True, exist_ok=True)
            destino.write_bytes(datos)
            print(f"Guardado aquí (sin GitHub): {destino}")
            return "local"
        raise RuntimeError("Para guardar en GitHub agrega el secreto GITHUB_TOKEN (icono de llave en Colab) y vuelve a ejecutar preparar().")
    if len(datos) > 95 * 1024 * 1024:
        raise RuntimeError(f"{camino} pesa {len(datos) / 1048576:.0f} MB; GitHub acepta hasta 100 MB. Guárdalo solo en Drive.")
    import random
    import time
    url = f"{API}/repos/{REPO}/contents/{camino}"
    contenido = base64.b64encode(datos).decode()
    for intento in range(8):
        actual = requests.get(f"{url}?ref={RAMA}", headers=_cab(), timeout=60)
        cuerpo = {"message": mensaje, "content": contenido, "branch": RAMA}
        if actual.status_code == 200:
            cuerpo["sha"] = actual.json()["sha"]
        r = requests.put(url, headers=_cab(), json=cuerpo, timeout=600)
        if r.status_code in (409, 422) and intento < 7:
            # varias GPU guardando a la vez en la misma rama: esperar un poco y reintentar
            time.sleep(2 + intento * 3 + random.random() * 3)
            continue
        r.raise_for_status()
        print(f"Guardado en GitHub: {camino}")
        return r.json()["commit"]["sha"]
    raise RuntimeError(f"No pude guardar {camino} en GitHub tras varios intentos.")


def listar(carpeta: str) -> list[str]:
    """Nombres de los archivos de una carpeta del repo ([] si no existe)."""
    locales = []
    if SALIDA and (Path(SALIDA) / carpeta).is_dir():
        locales = [f.name for f in (Path(SALIDA) / carpeta).iterdir() if f.is_file()]
    r = requests.get(f"{API}/repos/{REPO}/contents/{carpeta}?ref={RAMA}", headers=_cab(), timeout=60)
    if r.status_code in (404, 403):  # 403: límite de la API sin token
        return locales
    r.raise_for_status()
    return sorted(set(locales) | {x["name"] for x in r.json() if x.get("type") == "file"})


# ───────────────────────── Archivos grandes: «releases» de GitHub ─────────────────────────
# Un video largo (30 min) tiene cientos de tomas y el video final pesa más de 100 MB: no caben en el repo.
# Cada video del director tiene su propio «release» (etiqueta director-<carpeta>), con hasta 1000 archivos de hasta 2 GB.
# El repo sigue liviano y el token fino con «Contents: Read and write» alcanza.
_releases: dict = {}


def _release(etiqueta: str, crear: bool = True) -> dict | None:
    if etiqueta in _releases:
        return _releases[etiqueta]
    r = requests.get(f"{API}/repos/{REPO}/releases/tags/{etiqueta}", headers=_cab(), timeout=60)
    if r.status_code == 200:
        _releases[etiqueta] = r.json()
    elif r.status_code == 404 and crear and _token:
        r = requests.post(f"{API}/repos/{REPO}/releases", headers=_cab(), timeout=60,
                          json={"tag_name": etiqueta, "target_commitish": RAMA, "name": f"VIDEO-FREE · {etiqueta}", "prerelease": True,
                                "body": "Tomas, fotogramas y video final del director de VIDEO-FREE. Se generan solos desde Colab o Kaggle."})
        if r.status_code == 422:  # otra GPU lo creó al mismo tiempo
            r = requests.get(f"{API}/repos/{REPO}/releases/tags/{etiqueta}", headers=_cab(), timeout=60)
        r.raise_for_status()
        _releases[etiqueta] = r.json()
    else:
        return None
    return _releases[etiqueta]


def _assets(etiqueta: str) -> list[dict]:
    rel = _release(etiqueta, crear=False)
    if not rel:
        return []
    salida, pagina = [], 1
    while True:
        r = requests.get(f"{API}/repos/{REPO}/releases/{rel['id']}/assets?per_page=100&page={pagina}", headers=_cab(), timeout=60)
        if r.status_code != 200:
            return salida
        lote = r.json()
        salida += lote
        if len(lote) < 100:
            return salida
        pagina += 1


def listar_grandes(etiqueta: str) -> list[str]:
    """Nombres de los archivos guardados en el release `etiqueta` (más los guardados aquí sin token)."""
    locales = []
    if SALIDA and (Path(SALIDA) / "releases" / etiqueta).is_dir():
        locales = [f.name for f in (Path(SALIDA) / "releases" / etiqueta).iterdir() if f.is_file()]
    return sorted(set(locales) | {a["name"] for a in _assets(etiqueta)})


def subir_grande(etiqueta: str, archivo: str | Path) -> str | None:
    """Sube (o reemplaza) un archivo al release `etiqueta`. Devuelve su enlace de descarga."""
    import time
    archivo = Path(archivo)
    if not _token:
        if SALIDA:
            destino = Path(SALIDA) / "releases" / etiqueta / archivo.name
            destino.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(archivo, destino)
            print(f"Guardado aquí (sin GitHub): {destino}")
            return str(destino)
        raise RuntimeError("Para guardar archivos grandes en GitHub agrega el secreto GITHUB_TOKEN.")
    if archivo.stat().st_size > 2 * 1024**3 - 1024**2:
        raise RuntimeError(f"{archivo.name} pesa más de 2 GB, el máximo de GitHub por archivo.")
    rel = _release(etiqueta)
    for a in _assets(etiqueta):
        if a["name"] == archivo.name:
            requests.delete(f"{API}/repos/{REPO}/releases/assets/{a['id']}", headers=_cab(), timeout=60)
    url = f"https://uploads.github.com/repos/{REPO}/releases/{rel['id']}/assets?name={archivo.name}"
    for intento in range(5):
        with open(archivo, "rb") as f:
            r = requests.post(url, headers={**_cab(), "Content-Type": "application/octet-stream"}, data=f, timeout=1800)
        if r.status_code in (200, 201):
            print(f"Guardado en GitHub (release {etiqueta}): {archivo.name}")
            return r.json()["browser_download_url"]
        if r.status_code == 422:  # ya existía (otra GPU lo subió a la vez): se borra y se reintenta
            for a in _assets(etiqueta):
                if a["name"] == archivo.name:
                    requests.delete(f"{API}/repos/{REPO}/releases/assets/{a['id']}", headers=_cab(), timeout=60)
        time.sleep(3 + intento * 4)
    raise RuntimeError(f"No pude subir {archivo.name} al release {etiqueta}: {r.status_code} {r.text[:200]}")


def bajar_grande(etiqueta: str, nombre: str, destino: str | Path) -> Path | None:
    """Descarga un archivo del release `etiqueta` (o de la copia local sin token)."""
    destino = Path(destino)
    if SALIDA and (Path(SALIDA) / "releases" / etiqueta / nombre).is_file():
        shutil.copy(Path(SALIDA) / "releases" / etiqueta / nombre, destino)
        return destino
    for a in _assets(etiqueta):
        if a["name"] == nombre:
            r = requests.get(a["url"], headers={**_cab(), "Accept": "application/octet-stream"}, timeout=1800, stream=True)
            r.raise_for_status()
            with open(destino, "wb") as f:
                for trozo in r.iter_content(1 << 20):
                    f.write(trozo)
            return destino
    return None


def a_drive(local: str | Path, nombre: str | None = None) -> Path | None:
    """Copia un archivo a Google Drive (VIDEO-FREE/), si Drive está montado."""
    if not _drive:
        return None
    destino = _drive / (nombre or Path(local).name)
    destino.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(local, destino)
    print("Copia en Drive:", destino)
    return destino


def con_cache_drive(nombre: str, carpeta: str | Path, construir) -> str:
    """Guarda una instalación pesada (por ejemplo el entorno de LatentSync) en Drive como .tar.

    La primera vez la construye y la copia a Drive (si cabe); las siguientes sesiones solo la descomprimen,
    que es mucho más rápido que instalar de nuevo. Devuelve "local", "drive" o "nuevo"."""
    carpeta = Path(carpeta)
    if carpeta.exists() and any(carpeta.iterdir()):
        return "local"
    tar = (_drive / "cache" / f"{nombre}.tar") if _drive else None
    if tar and tar.exists():
        print(f"Recupero {nombre} desde Drive…")
        sh(f'tar -xf "{tar}" -C "{carpeta.parent}"')
        return "drive"
    construir()
    if tar:
        tamano = int(subprocess.run(["du", "-sb", str(carpeta)], capture_output=True, text=True).stdout.split()[0])
        libre = shutil.disk_usage(_drive).free
        if tamano * 1.1 < libre:
            tar.parent.mkdir(parents=True, exist_ok=True)
            print(f"Guardo {nombre} en Drive ({tamano / 2**30:.1f} GB) para la próxima sesión…")
            sh(f'tar -cf "{tar}.parcial" -C "{carpeta.parent}" "{carpeta.name}" && mv "{tar}.parcial" "{tar}"')
        else:
            print(f"{nombre} ocupa {tamano / 2**30:.1f} GB y en Drive quedan {libre / 2**30:.1f} GB libres: no lo guardo.")
    return "nuevo"


def carpeta_drive(sub: str) -> Path | None:
    """Una carpeta dentro de VIDEO-FREE/ en Drive (la crea). None si Drive no está montado."""
    if not _drive:
        return None
    c = _drive / sub
    c.mkdir(parents=True, exist_ok=True)
    return c


def en_drive(nombre: str) -> Path | None:
    """El archivo de Drive (VIDEO-FREE/<nombre>) si ya existe: sirve para retomar un trabajo largo tras una desconexión."""
    if not _drive:
        return None
    f = _drive / nombre
    return f if f.exists() and f.stat().st_size > 0 else None


def bajar(camino_repo: str, local: str | Path | None = None) -> Path:
    """Descarga un archivo del repo a la carpeta de trabajo."""
    datos = leer(camino_repo)
    if datos is None:
        raise FileNotFoundError(f"No existe en el repo: {camino_repo}")
    local = Path(local or TRABAJO / Path(camino_repo).name)
    local.parent.mkdir(parents=True, exist_ok=True)
    local.write_bytes(datos)
    return local


# ───────────────────────── Proyecto ─────────────────────────
def proyecto(nombre: str) -> dict:
    datos = leer(f"proyectos/{nombre}")
    if datos is None:
        raise FileNotFoundError(f"No existe proyectos/{nombre} en {REPO}.")
    p = json.loads(datos.decode("utf-8"))
    print(f"Proyecto: {p.get('titulo')} · {p.get('duracion')} s · {p.get('bpm')} BPM · {len(p.get('letra', []))} líneas · {len(p.get('escenas', []))} escenas")
    return p


def guardar_proyecto(nombre: str, p: dict, mensaje: str) -> None:
    guardar(f"proyectos/{nombre}", json.dumps(p, ensure_ascii=False, indent=2) + "\n", mensaje)


def slug(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-") or "proyecto"


NOTAS_ES = ["Do", "Do#", "Re", "Re#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"]
NOTAS_EN = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def tonalidad_en_ingles(p: dict) -> str | None:
    """'Sol# menor' (del arreglo o del análisis de voz) → 'G# minor', como lo pide ACE-Step."""
    txt = (p.get("arreglo") or {}).get("tonalidad") or ""
    if not txt or txt == "auto":
        voz = p.get("voz") or {}
        txt = ((voz.get("resumen") or {}).get("tonalidades") or [""])[0]
    m = re.match(r"^(Do#|Do|Re#|Re|Mi|Fa#|Fa|Sol#|Sol|La#|La|Si) (mayor|menor)", txt or "")
    if not m:
        return None
    return f"{NOTAS_EN[NOTAS_ES.index(m.group(1))]} {'major' if m.group(2) == 'mayor' else 'minor'}"


def letra_con_secciones(p: dict, por_bloque: int = 4) -> str:
    """Letra del proyecto con etiquetas [verse]/[chorus]/… para el modelo de canción.

    Usa la sección de cada línea (`seccion`) si la tiene; si no, alterna verso y coro cada `por_bloque` líneas."""
    lineas = [l for l in p.get("letra", []) if l.get("texto", "").strip()]
    out, actual = [], None
    if any(l.get("seccion") for l in lineas):
        for l in lineas:
            sec = l.get("seccion") or actual or "verse"
            if sec != actual:
                if out:
                    out.append("")
                out.append(f"[{sec}]")
                actual = sec
            out.append(l["texto"])
        return "\n".join(out).strip()
    textos = [l["texto"] for l in lineas]
    for i in range(0, len(textos), por_bloque):
        out.append("[verse]" if (i // por_bloque) % 2 == 0 else "[chorus]")
        out.extend(textos[i : i + por_bloque])
        out.append("")
    return "\n".join(out).strip()


def lineas_etiquetadas(letra: str) -> list[tuple[str, str]]:
    """De una letra con etiquetas ([verse], [chorus]…) saca (sección, línea) en orden."""
    out, sec = [], "verse"
    for l in letra.splitlines():
        l = l.strip()
        if not l:
            continue
        if l.startswith("[") and l.endswith("]"):
            sec = l[1:-1].strip().lower()
            continue
        out.append((sec, l))
    return out


def tiempos_estimados(letra: str, bpm: float = 95) -> tuple[list[dict], float]:
    """Reparte la letra sobre los compases como la cantaría una canción: 2 compases por línea, un compás entre
    secciones, entrada y final instrumentales. Devuelve (líneas con tiempos, duración sugerida en segundos)."""
    compas = 4 * 60.0 / (bpm or 95)
    t, anterior, lineas = 2 * compas, None, []
    for sec, texto in lineas_etiquetadas(letra):
        if anterior is not None and sec != anterior:
            t += compas
        lineas.append({"texto": texto, "inicio": round(t, 2), "fin": round(t + 2 * compas - 0.3, 2), "seccion": sec})
        t += 2 * compas
        anterior = sec
    duracion = t + 4 * compas
    return lineas, float(min(300.0, max(60.0, round(duracion / 5) * 5)))


# ───────────────────────── Audio ─────────────────────────
def a_mp3(entrada: str | Path, salida: str | Path, lufs: float = -14.0, kbps: int = 224) -> Path:
    """Normaliza a la sonoridad de las plataformas (−14 LUFS por defecto) y convierte a MP3."""
    sh(f'ffmpeg -hide_banner -loglevel error -y -i "{entrada}" -af loudnorm=I={lufs}:TP=-1:LRA=11 -ar 44100 -b:a {kbps}k "{salida}"')
    return Path(salida)


def duracion(archivo: str | Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(archivo)], capture_output=True, text=True).stdout
    return float(out.strip() or 0)


def _norm(p: str) -> str:
    p = unicodedata.normalize("NFD", p.lower())
    p = "".join(c for c in p if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9ñ]", "", p)


def alinear_letra(palabras: list[dict], lineas: list[str]) -> list[dict]:
    """Pone los tiempos de Whisper [{p, inicio, fin}] sobre la letra escrita (respeta tus renglones)."""
    letra = [(i, w) for i, l in enumerate(lineas) for w in l.split()]
    a, b = [_norm(w["p"]) for w in palabras], [_norm(w) for _, w in letra]
    tiempos: list = [None] * len(letra)
    for bloque in difflib.SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks():
        for k in range(bloque.size):
            w = palabras[bloque.a + k]
            tiempos[bloque.b + k] = (w["inicio"], w["fin"])
    conocidos = [i for i, t in enumerate(tiempos) if t]
    if len(conocidos) < max(3, 0.35 * len(letra)) and palabras:
        # Whisper entendió poco de lo que se canta: reparte la letra a lo largo del tramo cantado, según el largo de cada línea
        print(f"Aviso: solo reconocí {len(conocidos)} de {len(letra)} palabras; reparto la letra en el tramo cantado. Ajusta los tiempos en el portal.")
        t0, t1 = palabras[0]["inicio"], palabras[-1]["fin"]
        pesos = [len(l) + 6 for l in lineas]
        total, acum, salida = sum(pesos), 0, []
        for l, w in zip(lineas, pesos):
            a = t0 + (t1 - t0) * acum / total
            acum += w
            b = t0 + (t1 - t0) * acum / total - 0.1
            salida.append({"inicio": round(a, 2), "fin": round(max(a + 0.3, b), 2), "texto": l})
        return salida
    if not conocidos:
        raise ValueError("No pude alinear la letra con lo que se canta. ¿Es la misma letra?")
    for i, t in enumerate(tiempos):  # rellena palabras que Whisper no entendió
        if t:
            continue
        antes = max([j for j in conocidos if j < i], default=None)
        despues = min([j for j in conocidos if j > i], default=None)
        t0 = tiempos[antes][1] if antes is not None else tiempos[despues][0] - 0.4
        t1 = tiempos[despues][0] if despues is not None else t0 + 0.4 * (i - antes)
        n0 = antes if antes is not None else i - 1
        n1 = despues if despues is not None else i + 1
        paso = (t1 - t0) / max(1, n1 - n0)
        ini = t0 + paso * (i - n0 - 1)
        tiempos[i] = (round(ini, 3), round(ini + paso, 3))
    salida = []
    for n, l in enumerate(lineas):
        ps = [(w, tiempos[k]) for k, (i, w) in enumerate(letra) if i == n]
        if ps:
            salida.append({"inicio": round(ps[0][1][0], 2), "fin": round(ps[-1][1][1], 2), "texto": l,
                           "palabras": [{"p": w, "inicio": round(t[0], 2), "fin": round(t[1], 2)} for w, t in ps]})
    return salida


def _cargar_cuda_de_pip() -> None:
    """faster-whisper (CTranslate2) busca libcublas.so.12 y cuDNN 9. Los instala pip (paquetes de NVIDIA)
    y se cargan aquí antes de importar ctranslate2, sin tocar LD_LIBRARY_PATH."""
    import ctypes
    import glob
    import site
    rutas = []
    for base in site.getsitepackages():
        rutas += sorted(glob.glob(f"{base}/nvidia/cublas/lib/libcublas*.so*")) + sorted(glob.glob(f"{base}/nvidia/cudnn/lib/libcudnn*.so*"))
    for r in rutas:
        try:
            ctypes.CDLL(r, mode=ctypes.RTLD_GLOBAL)
        except OSError:
            pass


def _audio_16k(audio: str | Path):
    """Audio en 16 kHz mono como arreglo float32, decodificado con ffmpeg (sin depender de PyAV)."""
    import numpy as np
    crudo = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(audio), "-f", "f32le", "-ac", "1", "-ar", "16000", "-"],
                           capture_output=True, check=True).stdout
    return np.frombuffer(crudo, dtype=np.float32).copy()


def liberar_gpu() -> None:
    """Suelta la memoria de la GPU, también la que retiene el último error de una celda (guarda el modelo que falló)."""
    import gc
    import sys
    for nombre in ("last_traceback", "last_value", "last_type", "last_exc"):
        if hasattr(sys, nombre):
            setattr(sys, nombre, None)
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:  # noqa: BLE001
        pass


def _palabras_faster_whisper(audio: str | Path, idioma: str, pista: str | None) -> list[dict]:
    """faster-whisper (MIT, SYSTRAN): más rápido y con filtro de voz (VAD). Se instala al usarlo."""
    import importlib.util
    if importlib.util.find_spec("faster_whisper") is None:
        sh('pip install -q "faster-whisper>=1.1" nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*"')
    _cargar_cuda_de_pip()
    from faster_whisper import WhisperModel  # type: ignore
    g = gpu()
    # el audio lo decodifica ffmpeg: la versión de PyAV que trae Kaggle no es compatible con faster-whisper
    muestras = _audio_16k(audio)
    modelo = WhisperModel("large-v3-turbo", device="cuda" if g else "cpu", compute_type="float16" if g else "int8")
    segmentos, _ = modelo.transcribe(muestras, language=idioma, word_timestamps=True, vad_filter=True,
                                     initial_prompt=pista, condition_on_previous_text=False, beam_size=5)
    palabras = [{"p": w.word.strip(), "inicio": float(w.start), "fin": float(w.end)}
                for seg in segmentos for w in (seg.words or []) if w.word.strip()]
    del modelo
    return palabras


def _palabras_transformers(audio: str | Path, idioma: str, modelo: str) -> list[dict]:
    import torch
    from transformers import pipeline  # type: ignore

    muestras = _audio_16k(audio)
    g = gpu()
    # con dos GPU (Kaggle) usa la que tenga más memoria libre
    disp = max(range(torch.cuda.device_count()), key=lambda i: torch.cuda.mem_get_info(i)[0]) if g else -1
    asr = pipeline("automatic-speech-recognition", model=modelo, torch_dtype=torch.float16 if g else torch.float32, device=disp)
    r = asr({"raw": muestras, "sampling_rate": 16000}, return_timestamps="word", chunk_length_s=30, batch_size=4,
            generate_kwargs={"language": idioma, "task": "transcribe"})
    palabras = []
    for ch in r.get("chunks", []):
        a, b = ch.get("timestamp") or (None, None)
        texto = (ch.get("text") or "").strip()
        if a is None or not texto:
            continue
        palabras.append({"p": texto, "inicio": float(a), "fin": float(b if b is not None else a + 0.3)})
    del asr
    return palabras


def tiempos_de_palabras(audio: str | Path, idioma: str = "es", modelo: str = "openai/whisper-large-v3-turbo",
                        letra: str | None = None, motor: str = "auto") -> list[dict]:
    """Tiempos por palabra sobre la voz cantada.

    motor "auto": primero faster-whisper (más rápido, con VAD y con la letra como pista);
    si algo falla, Whisper con transformers sobre el mismo PyTorch del resto."""
    import gc

    import torch
    pista = " ".join((letra or "").split())[:800] or None
    liberar_gpu()
    palabras = []
    if motor in ("auto", "faster-whisper"):
        try:
            palabras = _palabras_faster_whisper(audio, idioma, pista)
            print(f"faster-whisper: {len(palabras)} palabras")
        except Exception as e:  # noqa: BLE001
            if motor == "faster-whisper":
                raise
            print("faster-whisper no funcionó aquí, uso transformers:", str(e)[:200])
    if not palabras:
        liberar_gpu()
        palabras = _palabras_transformers(audio, idioma, modelo)
    gc.collect()
    if gpu():
        torch.cuda.empty_cache()
    return palabras


def separar_voz(cancion: str | Path, salida: str | Path = TRABAJO / "separado") -> tuple[Path, Path]:
    """Separa voz e instrumental con Demucs (htdemucs). Devuelve (voz.wav, instrumental.wav)."""
    sh(f'python -m demucs --two-stems=vocals -n htdemucs -o "{salida}" "{cancion}"')
    base = Path(salida) / "htdemucs" / Path(cancion).stem
    return base / "vocals.wav", base / "no_vocals.wav"


def mezclar(voz: str | Path, instrumental: str | Path, salida: str | Path, voz_db: float = 0.0) -> Path:
    """Suma voz e instrumental (la voz con su ganancia en dB) y limita los picos."""
    sh(f'ffmpeg -hide_banner -loglevel error -y -i "{instrumental}" -i "{voz}" -filter_complex '
       f'"[1:a]volume={voz_db}dB[v];[0:a][v]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95" -ar 44100 "{salida}"')
    return Path(salida)


def escuchar(archivo: str | Path):
    from IPython.display import Audio, display  # type: ignore

    display(Audio(str(archivo)))


def ver(archivo: str | Path, ancho: int = 640):
    from IPython.display import HTML, display  # type: ignore

    datos = base64.b64encode(Path(archivo).read_bytes()).decode()
    display(HTML(f'<video width="{ancho}" controls src="data:video/mp4;base64,{datos}"></video>'))
