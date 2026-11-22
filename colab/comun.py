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
TRABAJO = Path("/content/trabajo")
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
    try:
        from google.colab import userdata  # type: ignore

        _token = userdata.get("GITHUB_TOKEN")
    except Exception:
        _token = os.environ.get("GITHUB_TOKEN")
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
    r = subprocess.run(cmd, shell=True, cwd=cwd, env={**os.environ, **(env or {})})
    if r.returncode != 0:
        raise RuntimeError(f"El comando falló ({r.returncode}): {cmd}")


# ───────────────────────── GitHub ─────────────────────────
def _cab(raw: bool = False) -> dict:
    h = {"Accept": "application/vnd.github.raw+json" if raw else "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if _token:
        h["Authorization"] = f"Bearer {_token}"
    return h


def leer(camino: str) -> bytes | None:
    """Lee un archivo del repo (cualquier tamaño hasta 100 MB). None si no existe."""
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
    if not _token:
        raise RuntimeError("Para guardar en GitHub agrega el secreto GITHUB_TOKEN (icono de llave en Colab) y vuelve a ejecutar preparar().")
    if isinstance(datos, str):
        datos = datos.encode("utf-8")
    if len(datos) > 95 * 1024 * 1024:
        raise RuntimeError(f"{camino} pesa {len(datos) / 1048576:.0f} MB; GitHub acepta hasta 100 MB. Guárdalo solo en Drive.")
    url = f"{API}/repos/{REPO}/contents/{camino}"
    actual = requests.get(f"{url}?ref={RAMA}", headers=_cab(), timeout=60)
    cuerpo = {"message": mensaje, "content": base64.b64encode(datos).decode(), "branch": RAMA}
    if actual.status_code == 200:
        cuerpo["sha"] = actual.json()["sha"]
    r = requests.put(url, headers=_cab(), json=cuerpo, timeout=600)
    if r.status_code == 409:
        raise RuntimeError("Alguien cambió ese archivo mientras tanto; vuelve a ejecutar la celda.")
    r.raise_for_status()
    print(f"Guardado en GitHub: {camino}")
    return r.json()["commit"]["sha"]


def a_drive(local: str | Path, nombre: str | None = None) -> Path | None:
    """Copia un archivo a Google Drive (VIDEO-FREE/), si Drive está montado."""
    if not _drive:
        return None
    destino = _drive / (nombre or Path(local).name)
    destino.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(local, destino)
    print("Copia en Drive:", destino)
    return destino


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
    """Letra del proyecto con etiquetas [verse]/[chorus] alternadas cada `por_bloque` líneas."""
    lineas = [l["texto"] for l in p.get("letra", []) if l.get("texto", "").strip()]
    out = []
    for i in range(0, len(lineas), por_bloque):
        out.append("[verse]" if (i // por_bloque) % 2 == 0 else "[chorus]")
        out.extend(lineas[i : i + por_bloque])
        out.append("")
    return "\n".join(out).strip()


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


def tiempos_de_palabras(audio: str | Path, idioma: str = "es", modelo: str = "openai/whisper-large-v3-turbo") -> list[dict]:
    """Whisper (con transformers, sobre el mismo PyTorch y CUDA del resto) con tiempos por palabra sobre la voz cantada."""
    import gc

    import numpy as np
    import torch
    from transformers import pipeline  # type: ignore

    # El audio lo decodifica ffmpeg (16 kHz, mono): así no dependemos de la versión de PyAV que traiga Colab
    crudo = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(audio), "-f", "f32le", "-ac", "1", "-ar", "16000", "-"],
                           capture_output=True, check=True).stdout
    muestras = np.frombuffer(crudo, dtype=np.float32).copy()
    g = gpu()
    asr = pipeline("automatic-speech-recognition", model=modelo, torch_dtype=torch.float16 if g else torch.float32, device=0 if g else -1)
    r = asr({"raw": muestras, "sampling_rate": 16000}, return_timestamps="word", chunk_length_s=30, batch_size=8,
            generate_kwargs={"language": idioma, "task": "transcribe"})
    palabras = []
    for ch in r.get("chunks", []):
        a, b = ch.get("timestamp") or (None, None)
        texto = (ch.get("text") or "").strip()
        if a is None or not texto:
            continue
        palabras.append({"p": texto, "inicio": float(a), "fin": float(b if b is not None else a + 0.3)})
    del asr
    gc.collect()
    if g:
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
