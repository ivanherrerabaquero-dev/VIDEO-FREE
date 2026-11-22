"""
VIDEO-FREE · director de video musical (código propio).

Convierte una canción en un video de varias tomas:
1. `planear()` escribe el plano de tomas sobre los compases de la canción
   (apertura con dron, subirse al auto, primeros planos cantando, la copiloto,
   insertos de instrumentos, recuerdo, noche, fantasma, cierre).
2. `componer_recorte()` arma el lienzo y la máscara para pintar la escena
   alrededor del personaje recortado, sin tocar su cara.
3. `montar()` corta cada toma a su tiempo, le pone color de cine y grano,
   las une y les pone la canción.

Aquí no se usa ningún modelo. Los modelos de IA (SDXL, Wan, LatentSync)
los llama el cuaderno 5_director_video.ipynb.
"""
from __future__ import annotations

import math
import subprocess
from pathlib import Path

from PIL import Image, ImageFilter

# ───────────────────────── Estilo general ─────────────────────────
ESTILO_FOTO = ("cinematic film still, shot on ARRI Alexa, 35mm anamorphic lens, natural skin texture, realistic, "
               "highly detailed, shallow depth of field, film grain, color graded music video")
NEGATIVO_FOTO = ("cartoon, illustration, painting, 3d render, cgi, anime, plastic skin, deformed, disfigured, extra limbs, "
                 "extra fingers, bad hands, bad anatomy, blurry, low quality, text, watermark, logo, two heads, duplicate person")
MOVIMIENTO_COMUN = "realistic natural human motion, cinematic camera movement, music video, highly detailed, consistent face"
NEGATIVO_VIDEO = ("static, frozen, still image, slideshow, blurry, low quality, worst quality, jpeg artifacts, deformed, disfigured, "
                  "morphing face, extra fingers, poorly drawn hands, distorted car, melting, text, subtitles, watermark, logo, "
                  "overexposed, flicker")

AUTO = "black 1969 convertible muscle car with chrome details"


def hora_texto(h: float) -> str:
    """0 = tarde dorada, 1 = noche cerrada."""
    if h < 0.25:
        return "warm golden hour afternoon light"
    if h < 0.5:
        return "sunset, orange sky, long shadows"
    if h < 0.7:
        return "blue hour twilight, purple sky, first stars"
    return "night, moonlight, car headlights and dashboard glow"


def grado_por_hora(h: float) -> str:
    return "dorado" if h < 0.5 else "crepusculo" if h < 0.7 else "noche"


# ───────────────────────── Catálogo de tomas ─────────────────────────
# personaje: recorte de medios/personajes (su cara se conserva tal cual)
# encuadre:  dónde y de qué tamaño va el recorte en el cuadro
# imagen:    lo que se pinta alrededor (fotograma clave)
# mueve:     lo que pasa durante la toma (prompt de video)
# canta:     se le sincronizan los labios con la voz
# prioridad: 1 = siempre, 5 = solo si sobra tiempo
TOMAS = {
    "dron_apertura": dict(
        compases=2, prioridad=1,
        imagen="aerial drone view high above an endless empty desert highway, a tiny {auto} driving alone, mountains on the horizon, {hora}",
        mueve="the drone slowly flies forward and tilts down following the car on the highway, dust behind the wheels"),
    "sube_al_auto": dict(
        compases=2, prioridad=1, personaje="actor_cuerpo.png", encuadre="cuerpo_izquierda",
        imagen="a young man standing next to a parked {auto} on the gravel shoulder of a desert highway, full body, {hora}",
        mueve="the man walks to the convertible, opens the driver door, gets in and sits behind the steering wheel, closes the door, natural body movement"),
    "canta_volante": dict(
        compases=2, prioridad=1, personaje="actor_canta.png", encuadre="primer_plano", canta=True,
        imagen="close-up of a young man singing while driving a {auto} with the top down, hands on the steering wheel, desert road behind him, wind in his hair, {hora}",
        mueve="he sings with emotion while driving, eyebrows rise, eyes close for a moment then look at the road, wind moves his hair, the background road moves past"),
    "detalle_rueda": dict(
        compases=1, prioridad=4,
        imagen="low angle close-up of the chrome wheel of a {auto} rolling fast on cracked asphalt, {hora}",
        mueve="the wheel spins fast, the asphalt rushes past, small stones fly, camera tracking low next to the tire"),
    "copiloto_tararea": dict(
        compases=2, prioridad=2, personaje="actriz_sonrie.png", encuadre="medio_derecha",
        imagen="a young woman sitting in the passenger seat of a {auto} with the top down, long hair, soft smile, desert highway behind, {hora}",
        mueve="she hums softly with closed lips and a gentle smile, her long hair blows in the wind, she turns her head slowly toward the driver"),
    "manos_volante": dict(
        compases=1, prioridad=3,
        imagen="close-up of a man's hands gripping the thin steering wheel of a vintage {auto}, silver ring, chrome dashboard, road ahead out of focus, {hora}",
        mueve="the hands turn the steering wheel gently, fingers tap the rhythm of the music on the wheel"),
    "guitarra": dict(
        compases=1, prioridad=4,
        imagen="close-up of hands strumming a nylon string acoustic guitar sitting on the hood of a {auto} parked on a desert roadside, {hora}",
        mueve="fingers strum the guitar strings to the beat, the strings vibrate, shallow depth of field"),
    "recuerdo_byn": dict(
        compases=2, prioridad=3, personaje="actriz_mira_atras.png", encuadre="medio_derecha", grado="byn",
        imagen="black and white photograph, a young woman in a field of tall dry grass looking back over her shoulder, wind, soft overcast light, nostalgic memory",
        mueve="she walks slowly away through the tall grass and looks back over her shoulder, the grass sways in the wind, slow motion, dreamy"),
    "retrovisor": dict(
        compases=1, prioridad=4,
        imagen="close-up of the chrome side mirror of a {auto}, the reflection shows the empty highway behind, {hora}",
        mueve="the road in the mirror reflection moves away, slight vibration of the mirror, camera fixed to the car door"),
    "canta_campo": dict(
        compases=2, prioridad=3, personaje="actor_melancolico.png", encuadre="primer_plano",
        canta=True, imagen="a melancholic young man standing in a field of tall dry grass next to a parked {auto}, {hora}",
        mueve="he sings with sadness, puts a hand on his chest, looks down and then up at the sky, slow camera push in, the grass moves in the wind"),
    "dron_atardecer": dict(
        compases=2, prioridad=3,
        imagen="aerial drone shot circling a {auto} driving on a winding mountain desert road, {hora}",
        mueve="the drone orbits slowly around the moving car, the car follows the curve of the road, headlights turn on"),
    "canta_noche": dict(
        compases=2, prioridad=2, personaje="actor_perfil.png", encuadre="primer_plano", canta=True, hora_fija=0.9,
        imagen="close-up of a young man singing at night inside a {auto}, face lit by the warm dashboard glow and passing street lights, {hora}",
        mueve="he sings with longing, passing lights sweep across his face, he glances at the empty passenger seat"),
    "fantasma": dict(
        compases=2, prioridad=2, personaje="actriz_cuerpo.png", encuadre="cuerpo_derecha", hora_fija=0.95, grado="fantasma",
        imagen="a translucent ghostly young woman standing in the middle of an empty desert highway at night, lit by car headlights, mist, {hora}",
        mueve="the ghostly woman looks at the camera, the mist moves around her, she slowly fades and dissolves into the headlights"),
    "maquina_ritmos": dict(
        compases=1, prioridad=5,
        imagen="close-up of fingers tapping the glowing pads of a drum machine on the passenger seat of a vintage car at night, neon reflections",
        mueve="fingers tap the pads to a reggaeton beat, the pads light up with each hit"),
    "cierre": dict(
        compases=2, prioridad=1, personaje="actor_cuerpo.png", encuadre="cuerpo_izquierda", hora_fija=1.0,
        imagen="wide shot, a {auto} stopped on the shoulder of a desert highway at night under a sky full of stars, a young man standing beside it, {hora}",
        mueve="the man leans on the car and looks up at the stars, slow camera pull back, the headlights fade out"),
}

# El orden de la historia. Si la canción es larga, el bloque de coro se repite antes del cierre.
HISTORIA = ["dron_apertura", "sube_al_auto", "canta_volante", "detalle_rueda", "copiloto_tararea", "manos_volante",
            "guitarra", "recuerdo_byn", "retrovisor", "canta_campo", "dron_atardecer", "canta_noche", "fantasma",
            "maquina_ritmos", "cierre"]
CORO = ["canta_volante", "guitarra", "copiloto_tararea", "canta_campo", "dron_atardecer", "canta_noche"]


def planear(duracion: float, bpm: float = 95, letra: list | None = None, hora: tuple[float, float] = (0.05, 1.0),
            semilla: int = 11, ritmo: str = "auto") -> list[dict]:
    """Escribe el plano de tomas: cada toma empieza y termina en un compás de la canción.

    ritmo: "rapido" (cortes cada compás, como un video urbano), "pausado" (tomas de dos compases)
    o "auto" (rápido si la canción dura menos de un minuto)."""
    compas = 4 * 60.0 / (bpm or 95)
    total = max(1, round(duracion / compas))
    rapido = ritmo == "rapido" or (ritmo == "auto" and duracion < 60)

    def compases(clase):
        c = TOMAS[clase]["compases"]
        return 1 if rapido and c == 2 and clase not in ("sube_al_auto", "cierre") else c

    historia = list(HISTORIA)
    # canción larga: repetir el bloque de coro antes del cierre
    while sum(compases(t) for t in historia) < total:
        historia[-1:-1] = CORO
    # canción corta: quitar tomas de menor prioridad (las del final de la lista primero)
    elegidas = [True] * len(historia)
    for prioridad in (5, 4, 3, 2):
        for i in reversed(range(len(historia))):
            if sum(compases(t) for t, s in zip(historia, elegidas) if s) <= total:
                break
            if elegidas[i] and TOMAS[historia[i]]["prioridad"] == prioridad:
                elegidas[i] = False
    historia = [t for t, s in zip(historia, elegidas) if s]

    plano, inicio = [], 0.0
    for n, clase in enumerate(historia):
        d = TOMAS[clase]
        fin = min(duracion, inicio + compases(clase) * compas)
        if n == len(historia) - 1:
            fin = duracion  # la última toma llega hasta el final de la canción
        if fin - inicio < 0.5:
            plano[-1]["hasta"] = round(duracion, 3)
            break
        h = d.get("hora_fija", hora[0] + (hora[1] - hora[0]) * (inicio / max(duracion, 1e-6)))
        vista = hora_texto(h)
        imagen = d["imagen"].format(auto=AUTO, hora=vista)
        plano.append({
            "n": len(plano) + 1,
            "clase": clase,
            "desde": round(inicio, 3),
            "hasta": round(fin, 3),
            "personaje": d.get("personaje"),
            "encuadre": d.get("encuadre"),
            "imagen": f"{imagen}, {ESTILO_FOTO}",
            "mueve": f"{d['mueve']}, {vista}, {MOVIMIENTO_COMUN}",
            "canta": bool(d.get("canta")),
            "grado": d.get("grado") or grado_por_hora(h),
            "hora": round(h, 2),
            "semilla": semilla + len(plano) * 7,
        })
        inicio = fin
        if inicio >= duracion - 0.01:
            break
    return plano


def letra_en(plano_toma: dict, letra: list | None) -> str:
    """Las líneas de la letra que suenan durante una toma (para mostrar en el plano)."""
    if not letra:
        return ""
    a, b = plano_toma["desde"], plano_toma["hasta"]
    return " / ".join(l.get("texto", "") for l in letra if l.get("inicio", 0) < b and l.get("fin", 0) > a)


def tabla(plano: list[dict], letra: list | None = None) -> str:
    filas = ["  n  desde–hasta   toma               labios  letra"]
    for t in plano:
        filas.append(f"{t['n']:>3}  {t['desde']:5.1f}–{t['hasta']:5.1f}  {t['clase']:<18} {'sí' if t['canta'] else '  '}      {letra_en(t, letra)[:60]}")
    return "\n".join(filas)


# ───────────────────────── Fotograma clave con el recorte ─────────────────────────
ENCUADRES = {
    # (alto del personaje respecto al cuadro, centro x, borde inferior y)
    "primer_plano": (0.95, 0.42, 1.04),
    "medio_derecha": (0.88, 0.64, 1.02),
    "medio_izquierda": (0.88, 0.36, 1.02),
    "cuerpo_izquierda": (0.8, 0.30, 0.97),
    "cuerpo_derecha": (0.8, 0.68, 0.97),
}


def componer_recorte(recorte: Image.Image, ancho: int, alto: int, encuadre: str = "primer_plano",
                     margen: int = 10) -> tuple[Image.Image, Image.Image]:
    """Pone el personaje recortado (PNG con transparencia) en el cuadro.

    Devuelve (lienzo RGB, máscara L). En la máscara, blanco = lo que la IA debe pintar
    (fondo, auto, paisaje) y negro = el personaje, que no se toca."""
    recorte = recorte.convert("RGBA")
    caja = recorte.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    if caja:
        recorte = recorte.crop(caja)
    escala_alto, cx, base = ENCUADRES.get(encuadre, ENCUADRES["primer_plano"])
    if alto > ancho:  # vertical: el personaje ocupa más ancho, va más centrado
        cx = 0.5 + (cx - 0.5) * 0.4
        escala_alto *= 0.8
    k = escala_alto * alto / recorte.height
    k = min(k, 0.95 * ancho / recorte.width) if encuadre.startswith("cuerpo") else k
    rec = recorte.resize((max(1, round(recorte.width * k)), max(1, round(recorte.height * k))), Image.LANCZOS)
    x = round(cx * ancho - rec.width / 2)
    y = round(base * alto - rec.height)
    lienzo = Image.new("RGB", (ancho, alto), (127, 127, 127))
    lienzo.paste(rec, (x, y), rec)
    alfa = Image.new("L", (ancho, alto), 0)
    alfa.paste(rec.getchannel("A"), (x, y))
    # la IA puede retocar unos píxeles del borde para que el personaje se funda con la luz de la escena
    protegido = alfa.point(lambda v: 255 if v > 128 else 0).filter(ImageFilter.MinFilter(margen | 1))
    mascara = protegido.point(lambda v: 255 - v).filter(ImageFilter.GaussianBlur(margen / 2))
    return lienzo, mascara


def a_multiplo(ancho: int, alto: int, m: int = 8) -> tuple[int, int]:
    return ancho // m * m, alto // m * m


# ───────────────────────── Video ─────────────────────────
def cuadros_para(segundos: float, fps: int = 24, maximo: int = 121) -> int:
    """Wan necesita 4k+1 cuadros. Se genera un poco más de lo que dura la toma, para cortar con margen."""
    n = math.ceil(segundos * fps) + 4
    n = 4 * math.ceil((n - 1) / 4) + 1
    return max(17, min(maximo, n))


# Color de cada toma (ffmpeg). Todo propio: curvas, balance, saturación, viñeta.
GRADOS = {
    "dorado": "colorbalance=rs=.06:gs=.02:bs=-.07:rm=.05:bm=-.05:rh=.04:bh=-.06,eq=contrast=1.06:saturation=1.08:gamma=.98",
    "crepusculo": "colorbalance=rs=.03:bs=.06:rm=.06:bm=.02:rh=.05:bh=-.02,eq=contrast=1.08:saturation=1.02:gamma=.95",
    "noche": "colorbalance=rs=-.05:gs=.01:bs=.09:rm=-.02:bm=.05:rh=.06:gh=.02:bh=-.04,eq=contrast=1.1:saturation=.92:gamma=.92",
    "byn": "hue=s=0,eq=contrast=1.18:brightness=.01:gamma=1.02",
    "fantasma": "colorbalance=bs=.12:gs=.04:bm=.08,eq=contrast=1.05:saturation=.6:brightness=.02,gblur=sigma=.8",
}


def _ffmpeg(args: list[str]) -> None:
    r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("ffmpeg falló:\n" + r.stderr[-2000:])


def duracion_de(archivo: str | Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(archivo)],
                       capture_output=True, text=True)
    return float(r.stdout.strip() or 0)


def montar(plano: list[dict], clips: dict[int, str | Path], audio: str | Path, salida: str | Path,
           formato: str = "horizontal", fps: int = 24, franjas: bool = True, grano: int = 7,
           carpeta: str | Path | None = None, crf: int = 20, resolucion: int = 1080) -> Path:
    """Une las tomas en un video con la canción.

    clips: número de toma → archivo de video. Una toma sin clip queda en negro (para ver el ritmo igual)."""
    corto, largo = resolucion, round(resolucion * 16 / 9 / 2) * 2  # 1080 → 1920x1080, 720 → 1280x720
    W, H = (largo, corto) if formato == "horizontal" else (corto, largo)
    carpeta = Path(carpeta or Path(salida).parent / "montaje")
    carpeta.mkdir(parents=True, exist_ok=True)
    partes = []
    total = plano[-1]["hasta"]
    for t in plano:
        dur = t["hasta"] - t["desde"]
        filtros = [f"scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos", f"crop={W}:{H}",
                   "unsharp=5:5:0.45:5:5:0", GRADOS.get(t.get("grado"), GRADOS["dorado"])]
        if grano:
            filtros.append(f"noise=c0s={grano}:c0f=t+u")
        filtros.append("vignette=PI/5")
        if franjas and formato == "horizontal":  # formato de cine 2.39:1
            barra = round((H - W / 2.39) / 2)
            filtros.append(f"drawbox=x=0:y=0:w=iw:h={barra}:color=black:t=fill,drawbox=x=0:y=ih-{barra}:w=iw:h={barra}:color=black:t=fill")
        if t["n"] == 1:
            filtros.append("fade=t=in:st=0:d=0.6")
        if t is plano[-1]:
            filtros.append(f"fade=t=out:st={max(0, dur - 1.2):.3f}:d=1.2")
        filtros += [f"fps={fps}", "format=yuv420p"]
        clip = clips.get(t["n"])
        destino = carpeta / f"toma_{t['n']:02d}.mp4"
        temporal = carpeta / f"toma_{t['n']:02d}.parcial.mp4"
        if clip and Path(clip).exists() and Path(clip).suffix.lower() in (".png", ".jpg", ".jpeg"):
            # sin video: el fotograma clave con un acercamiento lento de cámara
            n = max(1, round(dur * fps))
            filtros = [f"scale={W * 2}:{H * 2}:force_original_aspect_ratio=increase:flags=lanczos", f"crop={W * 2}:{H * 2}",
                       f"zoompan=z='1+0.08*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={n}:s={W}x{H}:fps={fps}"] + filtros[2:]
            entrada = ["-loop", "1", "-framerate", str(fps), "-i", str(clip)]
        elif clip and Path(clip).exists():
            largo = duracion_de(clip)
            if largo + 0.05 < dur <= largo * 1.6:
                # un poco más corto que la toma: cámara lenta, se nota menos que repetirlo
                filtros.insert(0, f"setpts={dur / largo:.4f}*PTS")
                entrada = ["-i", str(clip)]
            else:
                entrada = ["-stream_loop", "-1", "-i", str(clip)]  # mucho más corto: se repite
        else:
            entrada = ["-f", "lavfi", "-i", f"color=c=black:s={W}x{H}:r={fps}"]
        _ffmpeg([*entrada, "-t", f"{dur:.3f}", "-vf", ",".join(filtros), "-an", "-c:v", "libx264", "-preset", "veryfast",
                 "-crf", str(crf), "-r", str(fps), "-pix_fmt", "yuv420p", str(temporal)])
        temporal.replace(destino)
        partes.append(destino)
    lista = carpeta / "lista.txt"
    lista.write_text("".join(f"file '{p.resolve()}'\n" for p in partes))
    mudo = carpeta / "mudo.mp4"
    _ffmpeg(["-f", "concat", "-safe", "0", "-i", str(lista), "-c", "copy", str(mudo)])
    salida = Path(salida)
    temporal = salida.with_name(salida.stem + ".parcial.mp4")
    _ffmpeg(["-i", str(mudo), "-i", str(audio), "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
             "-t", f"{total:.3f}", "-movflags", "+faststart", str(temporal)])
    temporal.replace(salida)
    return salida


def hoja_de_contactos(imagenes: list[str | Path], salida: str | Path, columnas: int = 4, ancho: int = 400) -> Path:
    """Una sola imagen con todos los fotogramas clave, para revisarlos de un vistazo."""
    ims = [Image.open(i).convert("RGB") for i in imagenes]
    if not ims:
        raise ValueError("No hay imágenes")
    alto = round(ancho * ims[0].height / ims[0].width)
    filas = math.ceil(len(ims) / columnas)
    hoja = Image.new("RGB", (columnas * ancho, filas * alto), (0, 0, 0))
    for k, im in enumerate(ims):
        hoja.paste(im.resize((ancho, alto), Image.LANCZOS), ((k % columnas) * ancho, (k // columnas) * alto))
    hoja.save(salida, quality=90)
    return Path(salida)


# ───────────────────────── Video rápido (3 pasos) ─────────────────────────
# FastWan 2.2 (FastVideo, Apache 2.0) es Wan 2.2 5B destilado para generar en 3 pasos y sin «guía doble» (CFG):
# unas 20 veces menos trabajo que 30 pasos con CFG. Usa estos tiempos fijos del ruido.
PASOS_DMD = (1000, 757, 522)


def programador_dmd(pasos: tuple[int, ...] = PASOS_DMD):
    """Programador de ruido para FastWan: en cada paso predice la imagen limpia y la vuelve a ensuciar al nivel siguiente."""
    import torch
    from diffusers import FlowMatchEulerDiscreteScheduler

    class ProgramadorDMD(FlowMatchEulerDiscreteScheduler):
        def set_timesteps(self, num_inference_steps=None, device=None, **_):
            t = torch.tensor(pasos, dtype=torch.float32)
            self.timesteps = t.to(device)
            self.sigmas = torch.cat([t / 1000.0, torch.zeros(1)]).to(device)
            self.num_inference_steps = len(pasos)
            self._step_index = None
            self._begin_index = None

    return ProgramadorDMD(num_train_timesteps=1000, shift=1.0, stochastic_sampling=True)


# ───────────────────────── Fotos de entrenamiento ─────────────────────────
# Lugares, luces y encuadres para crear fotos variadas del personaje (cuaderno 6).
# La cara se conserva del recorte; cambia todo lo demás, así la IA aprende la cara y no el fondo de estudio.
LUGARES_ENTRENAMIENTO = [
    "in the driver seat of a {auto} with the top down, desert highway behind",
    "leaning on the door of a parked {auto} on a gravel roadside",
    "on an empty desert highway with mountains in the distance",
    "in a field of tall dry grass",
    "on a city street at night with neon signs and wet asphalt",
    "inside a dim recording studio with warm lamps",
    "on a rooftop at dusk with the city skyline behind",
    "in the passenger seat of a {auto}, wind in the hair",
    "at a roadside gas station at night under fluorescent lights",
    "on a beach boardwalk with the ocean behind",
]
LUCES_ENTRENAMIENTO = [
    "warm golden hour sunlight", "soft overcast daylight", "orange sunset backlight", "blue hour twilight",
    "night, warm dashboard glow", "harsh midday sun", "neon pink and blue light", "soft window light",
]
ENCUADRES_ENTRENAMIENTO = ["primer_plano", "medio_izquierda", "medio_derecha", "cuerpo_izquierda", "cuerpo_derecha"]


def variaciones_entrenamiento(cantidad: int, semilla: int = 3) -> list[dict]:
    """Combinaciones repetibles de lugar, luz y encuadre (sin azar del sistema)."""
    salida = []
    for k in range(cantidad):
        a = (k * 7 + semilla) % len(LUGARES_ENTRENAMIENTO)
        b = (k * 5 + semilla * 3) % len(LUCES_ENTRENAMIENTO)
        c = (k * 3 + semilla) % len(ENCUADRES_ENTRENAMIENTO)
        salida.append({"lugar": LUGARES_ENTRENAMIENTO[a].format(auto=AUTO), "luz": LUCES_ENTRENAMIENTO[b],
                       "encuadre": ENCUADRES_ENTRENAMIENTO[c], "semilla": semilla * 1000 + k})
    return salida
