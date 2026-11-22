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
# Corto a propósito: SDXL solo lee 77 «tokens» por prompt; lo que sobra se pierde.
ESTILO_FOTO = "cinematic film still, 35mm, realistic skin, film grain"
NEGATIVO_FOTO = ("cartoon, illustration, painting, 3d render, cgi, anime, plastic skin, deformed, disfigured, extra limbs, "
                 "extra fingers, bad hands, bad anatomy, blurry, low quality, text, watermark, logo, two heads, duplicate person")
MOVIMIENTO_COMUN = "realistic natural human motion, cinematic camera movement, music video, highly detailed, consistent face"
NEGATIVO_VIDEO = ("static, frozen, still image, slideshow, blurry, low quality, worst quality, jpeg artifacts, deformed, disfigured, "
                  "morphing face, extra fingers, poorly drawn hands, distorted car, melting, text, subtitles, watermark, logo, "
                  "overexposed, flicker")

AUTO = "black 1969 convertible muscle car with the top down"
# Cómo se ve el protagonista cuando no se usa su recorte (de espaldas o de lejos): coincide con sus fotos.
ACTOR = "a young man with messy dark brown hair and a short beard, black leather jacket, white t-shirt, dark jeans"
ACTRIZ = "a young woman with long wavy brown hair, black blazer, dark red shirt and tie"


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
        mueve="the drone slowly flies forward and tilts down following the black open-top convertible on the highway, dust behind the wheels"),
    "sube_al_auto": dict(
        # sin recorte: visto de espaldas y de lejos, para que camine y se suba con movimiento natural
        compases=2, prioridad=1,
        imagen="wide shot from behind, {actor} walking toward a parked {auto} on the gravel shoulder of a desert highway, {hora}",
        mueve="the man walks to the open-top convertible, opens the driver door, gets in and sits behind the steering wheel, natural body movement"),
    "canta_volante": dict(
        compases=2, prioridad=1, personaje="actor_canta.png", encuadre="primer_plano", canta=True,
        imagen="close-up of a young man singing while driving a {auto} with the top down, hands on the steering wheel, desert road behind him, wind in his hair, {hora}",
        mueve="he sings the lyrics with clear mouth movements while driving, eyebrows rise, eyes close for a moment then look at the road, wind moves his hair, the background road moves past"),
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
        mueve="he sings the lyrics with sadness and clear mouth movements, puts a hand on his chest, looks down and then up at the sky, slow camera push in, the grass moves in the wind"),
    "canta_capo": dict(
        compases=2, prioridad=4, personaje="actor_canta.png", encuadre="medio_izquierda", canta=True,
        imagen="a young man singing while sitting on the hood of a parked {auto} at a desert roadside, mountains behind, {hora}",
        mueve="he sings the lyrics with passion and clear mouth movements, gestures with one hand, slow camera arc around him, wind in his hair"),
    "dron_atardecer": dict(
        compases=2, prioridad=3,
        imagen="aerial drone shot circling a {auto} driving on a winding mountain desert road, {hora}",
        mueve="the drone orbits slowly around the moving black open-top convertible, the car follows the curve of the road, headlights turn on"),
    "canta_noche": dict(
        compases=2, prioridad=2, personaje="actor_perfil.png", encuadre="primer_plano", canta=True, hora_fija=0.9,
        imagen="close-up of a young man singing at night inside a {auto}, face lit by the warm dashboard glow and passing street lights, {hora}",
        mueve="he sings the lyrics with longing and clear mouth movements, passing lights sweep across his face, he glances at the empty passenger seat"),
    "fantasma": dict(
        compases=2, prioridad=2, hora_fija=0.95, grado="fantasma",
        imagen="a translucent ghostly figure of {actriz} in the middle of an empty desert highway at night, lit by car headlights, mist, {hora}",
        mueve="the ghostly woman looks at the camera, the mist moves around her, she slowly fades and dissolves into the headlights"),
    "maquina_ritmos": dict(
        compases=1, prioridad=5,
        imagen="close-up of fingers tapping the glowing pads of a drum machine on the passenger seat of a vintage car at night, neon reflections",
        mueve="fingers tap the pads to a reggaeton beat, the pads light up with each hit"),
    "cierre": dict(
        compases=2, prioridad=1, hora_fija=1.0,
        imagen="wide shot, a {auto} stopped on the shoulder of a desert highway under a sky full of stars, {actor} leaning on it seen from the side, {hora}",
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
        imagen = d["imagen"].format(auto=AUTO, hora=vista, actor=ACTOR, actriz=ACTRIZ)
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


# ───────────────────────── Plano sobre la letra ─────────────────────────
# Qué tomas van en cada parte de la canción. «canta»: sobre las líneas cantadas (primer plano del cantante, con labios);
# «corte»: tomas de apoyo dentro de una línea larga; «hueco»: partes sin voz (intro, puentes instrumentales, final).
POR_SECCION = {
    "intro": {"canta": ["copiloto_tararea"], "corte": ["detalle_rueda"], "hueco": ["dron_apertura", "sube_al_auto", "detalle_rueda"]},
    "verse": {"canta": ["canta_volante"], "corte": ["manos_volante", "retrovisor", "copiloto_tararea", "detalle_rueda"],
              "hueco": ["detalle_rueda", "manos_volante"]},
    "pre-chorus": {"canta": ["canta_volante", "canta_capo"], "corte": ["copiloto_tararea", "recuerdo_byn", "retrovisor"], "hueco": ["recuerdo_byn"]},
    "chorus": {"canta": ["canta_campo", "canta_capo", "canta_volante"], "corte": ["dron_atardecer", "guitarra", "maquina_ritmos"],
               "hueco": ["dron_atardecer", "guitarra"]},
    "bridge": {"canta": ["canta_noche"], "corte": ["recuerdo_byn", "fantasma", "copiloto_tararea"], "hueco": ["fantasma", "recuerdo_byn"]},
    "outro": {"canta": ["canta_noche"], "corte": ["fantasma", "dron_atardecer"], "hueco": ["fantasma", "dron_atardecer"]},
}
HUECO_ENTRE_SECCIONES = ["dron_atardecer", "detalle_rueda", "guitarra", "maquina_ritmos", "dron_apertura"]
NOCHE_DESDE = 0.62  # a partir de esta parte de la canción ya es de noche


def _seccion(linea: dict, i: int) -> str:
    s = (linea.get("seccion") or "").lower().strip("[] ")
    for clave in POR_SECCION:
        if s.startswith(clave):
            return clave
    if s.startswith("pre"):
        return "pre-chorus"
    return "verse" if (i // 4) % 2 == 0 else "chorus"


def _es_tarareo(texto: str) -> bool:
    import re
    t = texto.lower().strip()
    return t.startswith("(") or bool(re.fullmatch(r"[\s,.\-…()]*((m+h*m*|a+h*|o+h+|u+h+|la+|na+)[\s,.\-…()]*)+", t))


def planear_por_letra(duracion: float, bpm: float, letra: list, hora: tuple[float, float] = (0.05, 1.0), semilla: int = 11) -> list[dict]:
    """Plano que sigue la canción: un primer plano cantando sobre cada línea, la copiloto en los tarareos,
    tomas de paisaje e instrumentos en las partes sin voz y el cierre al final. Los cortes caen en los compases."""
    compas = 4 * 60.0 / (bpm or 95)

    def q(t):  # al compás más cercano
        return max(0.0, min(duracion, round(t / compas) * compas))

    lineas = sorted([l for l in letra if l.get("texto", "").strip() and l.get("fin", 0) > l.get("inicio", 0)], key=lambda l: l["inicio"])
    tramos = []  # (desde, hasta, tipo, seccion, texto)
    cursor = 0.0
    for i, l in enumerate(lineas):
        sec = _seccion(l, i)
        ini = q(l["inicio"])
        if ini - cursor >= compas * 0.75:
            tramos.append((cursor, ini, "hueco", sec if cursor > 0 else "intro", ""))
            cursor = ini
        siguiente = q(lineas[i + 1]["inicio"]) if i + 1 < len(lineas) else None
        fin_canto = max(q(l["fin"]), cursor + compas)
        if siguiente is not None and siguiente - fin_canto < compas * 1.5:
            fin_canto = max(siguiente, cursor + compas)  # la toma dura hasta la línea siguiente (incluye la respiración)
        fin_canto = min(fin_canto, duracion)
        if fin_canto > cursor:
            tramos.append((cursor, fin_canto, "tarareo" if _es_tarareo(l["texto"]) else "canta", sec, l["texto"]))
            cursor = fin_canto
    if duracion - cursor > 0.3:
        tramos.append((cursor, duracion, "hueco", "outro", ""))

    contadores: dict = {}
    ultima = [None]

    def elegir(lista, clave, f):
        lista = [c for c in lista if not (TOMAS[c].get("hora_fija", 0) > 0.8 and f < NOCHE_DESDE - 0.1)] or lista
        k = contadores.get(clave, 0)
        for d in range(len(lista)):
            c = lista[(k + d) % len(lista)]
            if c != ultima[0] or len(lista) == 1:
                contadores[clave] = k + d + 1
                ultima[0] = c
                return c
        return lista[0]

    plano = []
    linea_en_seccion: dict = {}
    for desde, hasta, tipo, sec, texto in tramos:
        if tipo == "canta":
            j = linea_en_seccion.get(sec, 0)
            linea_en_seccion[sec] = j + 1
            if j % 3 == 2:
                tipo = "apoyo"  # una de cada tres líneas va con tomas de apoyo, para que no sea siempre el mismo plano
        # trozos de hasta 2 compases (~5 s): lo que un modelo de video genera de una vez
        n_trozos = max(1, math.ceil((hasta - desde) / (2 * compas) - 0.15))
        bordes = [desde + (hasta - desde) * k / n_trozos for k in range(n_trozos + 1)]
        for k in range(n_trozos):
            a, b = bordes[k], bordes[k + 1]
            f = a / max(duracion, 1e-6)
            pools = POR_SECCION[sec]
            if tipo == "canta":
                clase = elegir(pools["canta"] if k % 2 == 0 else pools["corte"], f"{sec}:{'c' if k % 2 == 0 else 'x'}", f)
                if clase == "canta_volante" and f >= NOCHE_DESDE:
                    clase = "canta_noche"
            elif tipo == "apoyo":
                clase = elegir(pools["corte"], f"{sec}:x", f)
            elif tipo == "tarareo" and sec == "intro" and not any(t["clase"] == "sube_al_auto" for t in plano):
                clase = "sube_al_auto"  # al empezar, él camina hacia el auto y se sube
            elif tipo == "tarareo":
                clase = elegir(["copiloto_tararea", "fantasma"] if f >= NOCHE_DESDE else ["copiloto_tararea", "recuerdo_byn"], "tarareo", f)
            elif sec == "intro" and not plano:
                clase = "dron_apertura"
            else:
                clase = elegir(pools["hueco"] if sec in ("intro", "outro", "bridge") else HUECO_ENTRE_SECCIONES, f"{sec}:h", f)
            plano.append(_toma(clase, a, b, len(plano) + 1, semilla, hora, duracion, texto))
    # el final siempre es el cierre
    if plano and plano[-1]["clase"] != "cierre":
        ult = plano[-1]
        if ult["hasta"] - ult["desde"] >= 2 * compas and not ult["canta"]:
            plano[-1] = _toma("cierre", ult["desde"], ult["hasta"], ult["n"], semilla, hora, duracion, "")
        elif duracion - ult["desde"] > compas:
            mitad = max(ult["desde"] + compas * 0.75, duracion - 2 * compas)
            ult["hasta"] = round(mitad, 3)
            plano.append(_toma("cierre", mitad, duracion, len(plano) + 1, semilla, hora, duracion, ""))
    return plano


def _toma(clase: str, desde: float, hasta: float, n: int, semilla: int, hora: tuple[float, float], duracion: float, texto: str) -> dict:
    d = TOMAS[clase]
    h = d.get("hora_fija", hora[0] + (hora[1] - hora[0]) * (desde / max(duracion, 1e-6)))
    vista = hora_texto(h)
    imagen = d["imagen"].format(auto=AUTO, hora=vista, actor=ACTOR, actriz=ACTRIZ)
    return {"n": n, "clase": clase, "desde": round(desde, 3), "hasta": round(hasta, 3), "personaje": d.get("personaje"),
            "encuadre": d.get("encuadre"), "imagen": f"{imagen}, {ESTILO_FOTO}", "mueve": f"{d['mueve']}, {vista}, {MOVIMIENTO_COMUN}",
            "canta": bool(d.get("canta")), "grado": d.get("grado") or grado_por_hora(h), "hora": round(h, 2),
            "semilla": semilla + n * 7, "linea": texto}


def letra_sirve(letra: list | None, duracion: float) -> bool:
    """¿La letra tiene tiempos reales que cubren buena parte de la canción?"""
    con_tiempo = [l for l in (letra or []) if l.get("fin", 0) > l.get("inicio", 0)]
    if len(con_tiempo) < 3:
        return False
    tramo = max(l["fin"] for l in con_tiempo) - min(l["inicio"] for l in con_tiempo)
    return tramo >= 0.4 * duracion and max(l["fin"] for l in con_tiempo) <= duracion + 2


def planear_auto(duracion: float, bpm: float = 95, letra: list | None = None, semilla: int = 11, ritmo: str = "auto") -> list[dict]:
    """Sigue la letra si tiene tiempos; si no, reparte la historia por compases."""
    if letra_sirve(letra, duracion):
        return planear_por_letra(duracion, bpm, letra, semilla=semilla)
    return planear(duracion, bpm, letra, semilla=semilla, ritmo=ritmo)


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
    # fantasma: frío, desaturado y con un brillo difuso encima (la imagen se «funde» con la luz)
    "fantasma": ("colorbalance=bs=.12:gs=.04:bm=.08,eq=contrast=1.05:saturation=.55:brightness=.02,format=gbrp,split[fa][fb];"
                 "[fb]gblur=sigma=18[fg];[fa][fg]blend=all_mode=screen:all_opacity=0.55,format=yuv420p"),
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
