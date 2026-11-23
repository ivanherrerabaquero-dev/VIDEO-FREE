"""
VIDEO-FREE · motor del director (código propio).

Lo usan el cuaderno 5 (Colab, una GPU) y colab/kaggle/kaggle_2_director.ipynb (Kaggle, dos GPU). Varias GPU pueden trabajar a la vez
en el mismo video: cada una («trabajador») hace las tomas que le tocan y las sube a tu repo, en
`medios/director/<video>/`. Cualquiera de ellas puede montar el video cuando todas las tomas estén listas.

Desde la terminal (así lo lanza el cuaderno de Kaggle, una vez por GPU):
    python generar.py --config '{"proyecto": "carretera-sin-ti.json", "calidad": "borrador"}' --trabajador 2 --trabajadores 3
"""
from __future__ import annotations

import argparse
import gc
import json
import math
import shutil
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

import comun
import director

M5 = "Wan-AI/Wan2.2-TI2V-5B-Diffusers"
FAST = "FastVideo/FastWan2.2-TI2V-5B-FullAttn-Diffusers"
INPAINT = "OzzyGT/RealVisXL_V4.0_inpainting"
REALVIS = "SG161222/RealVisXL_V5.0"
REALVIS_RAPIDO = "SG161222/RealVisXL_V5.0_Lightning"
LS_COMMIT = "a229c3948406bc2cf6eaf4873e662e70c6a04746"
_BASE = __import__("os").environ.get("VIDEOFREE_HERRAMIENTAS", "/content")
LS_DIR = f"{_BASE}/latentsync"   # código de LatentSync
LS_ENV = f"{_BASE}/ls_env"       # su entorno de Python aparte
# Lo que hereda del cuaderno no sirve en su Python aparte: el gráfico «inline» de Jupyter rompía matplotlib
# («'module://matplotlib_inline.backend_inline' is not a valid value for backend») y fallaban todas las tomas.
ENTORNO_LS = {"MPLBACKEND": "Agg", "PYTHONPATH": "", "PYTHONNOUSERSITE": "1"}


@dataclass
class Config:
    proyecto: str = "carretera-sin-ti.json"
    formato: str = "horizontal"          # "horizontal" o "vertical"
    calidad: str = "borrador"            # "borrador" (480p, rápido) o "final"
    ritmo: str = "auto"
    semilla: int = 11
    motor: str = "rapido"                # "rapido" (FastWan, 3 pasos) o "calidad" (Wan, 30 pasos)
    modo_personaje: str = "recorte"      # "recorte" (cara exacta) o "entrenado" (LoRA del cuaderno 6)
    armonizar: float = 0.15
    rapido_imagen: bool = True
    pasos_imagen: int = 30
    pasos_video: int = 0
    labios: bool = True
    pasos_labios: int = 20
    trabajador: int = 1
    trabajadores: int = 1
    rehacer: list = field(default_factory=list)
    solo_labios: bool = False   # solo repite los labios de las tomas que cantan (las tomas ya existen)

    @property
    def borrador(self) -> bool:
        return self.calidad.startswith("borrador")


def _mostrar(img_o_archivo):
    """Muestra una imagen o un video en el cuaderno; fuera de un cuaderno no hace nada."""
    try:
        from IPython import get_ipython
        if get_ipython() is None:
            return
        from IPython.display import display
        from PIL import Image
        p = Path(str(img_o_archivo))
        if p.suffix.lower() == ".mp4":
            comun.ver(p, 480)
        else:
            display(Image.open(p))
    except Exception:
        pass


class Director:
    def __init__(self, cfg: Config, vram: float | None = None):
        self.cfg = cfg
        self.vram = vram if vram is not None else comun.gpu().get("vram_gb", 0)
        self.p = comun.proyecto(cfg.proyecto)
        self.duracion = self.p.get("duracion") or comun.duracion(comun.bajar(self.p["audio"]))
        self.nombre = comun.slug(self.p.get("titulo", "video"))
        # la carpeta lleva una huella de la canción: si cambias la canción, no se mezclan tomas viejas con las nuevas
        import hashlib
        huella = hashlib.sha1(f"{self.p.get('audio')}|{round(self.duracion, 1)}".encode()).hexdigest()[:6]
        self.carpeta = f"{self.nombre}_{cfg.formato}{'_borrador' if cfg.borrador else ''}_{huella}"
        self.base = f"medios/director/{self.carpeta}"   # lo compartido entre GPU, en tu repo (solo textos: plano y marcas)
        # fotogramas, tomas y video pesan mucho: van al «release» de GitHub de este video (hasta 1000 archivos de 2 GB)
        self.etiqueta = f"director-{self.carpeta}"
        self.local = comun.TRABAJO / self.carpeta
        self.local.mkdir(parents=True, exist_ok=True)
        self.plano = self._plano()
        self.por_n = {t["n"]: t for t in self.plano}
        self.claves: dict[int, Path] = {}
        self.tomas: dict[int, Path] = {}

    # ───────────── plano compartido ─────────────
    def _plano(self) -> list[dict]:
        datos = comun.leer(f"{self.base}/plano.json")
        if datos:
            print("Uso el plano compartido de", self.base)
            return json.loads(datos)
        guardado = (self.p.get("director") or {})
        plano_guardado = guardado.get("plano") or []
        # el plano guardado solo sirve si es de esta misma canción (misma duración) y formato
        if (plano_guardado and guardado.get("formato") == self.cfg.formato and guardado.get("carpeta") == self.base
                and abs(plano_guardado[-1]["hasta"] - self.duracion) < 0.5):
            plano = plano_guardado
        else:
            plano = director.planear_auto(self.duracion, self.p.get("bpm") or 95, self.p.get("letra"),
                                          semilla=self.cfg.semilla, ritmo=self.cfg.ritmo)
        if comun._token or comun.SALIDA:
            try:
                comun.guardar(f"{self.base}/plano.json", json.dumps(plano, ensure_ascii=False, indent=1), f"Director: plano de {self.carpeta}")
            except Exception as e:  # sin token: cada GPU calcula el mismo plano (es determinista)
                print("No guardé el plano compartido:", str(e)[:120])
        return plano

    def tabla(self) -> str:
        return director.tabla(self.plano, self.p.get("letra"))

    def mias(self) -> list[dict]:
        """Las tomas que le tocan a este trabajador (repartidas por turnos)."""
        k, n = self.cfg.trabajador, self.cfg.trabajadores
        return [t for t in self.plano if (t["n"] - 1) % n == k - 1]

    # ───────────── archivos compartidos ─────────────
    def _en_repo(self) -> set[str]:
        """Lo que ya existe, hecho aquí, por otra GPU o en otra sesión: marcas en el repo y archivos en el release."""
        hay = {f.name for f in self.local.iterdir() if f.is_file() and f.stat().st_size > 0}
        try:
            hay |= set(comun.listar(self.base))
        except Exception:
            pass
        try:
            self._grandes = set(comun.listar_grandes(self.etiqueta))
            hay |= self._grandes
        except Exception as e:
            print("No pude leer el release:", str(e)[:120])
        return hay

    def _traer(self, nombre: str, en_repo: set[str] | None = None) -> Path | None:
        """Busca un archivo: aquí, en Drive o en el repo (hecho por otra GPU o en otra sesión)."""
        local = self.local / nombre
        if local.exists() and local.stat().st_size > 0:
            return local
        previo = comun.en_drive(f"director/{self.carpeta}/{nombre}")
        if previo:
            shutil.copy(previo, local)
            return local
        if en_repo is None:
            en_repo = self._en_repo()
        if nombre in en_repo:
            if nombre in getattr(self, "_grandes", set()):
                try:
                    if comun.bajar_grande(self.etiqueta, nombre, local):
                        return local
                except Exception as e:
                    print(f"No pude bajar {nombre}:", str(e)[:120])
            datos = comun.leer(f"{self.base}/{nombre}")  # versiones anteriores lo guardaban en el repo
            if datos:
                local.write_bytes(datos)
                return local
        return None

    def _publicar(self, local: Path, mensaje: str) -> None:
        comun.a_drive(local, f"director/{self.carpeta}/{local.name}")
        if comun._token or comun.SALIDA:
            try:
                if local.suffix in (".txt", ".json"):
                    comun.guardar(f"{self.base}/{local.name}", local.read_bytes(), mensaje)
                else:
                    comun.subir_grande(self.etiqueta, local)
            except Exception as e:
                print("No pude subirlo a GitHub:", str(e)[:150])

    def _marca(self, nombre: str, texto: str) -> None:
        f = self.local / nombre
        f.write_text(texto)
        self._publicar(f, f"Director: {nombre}")

    def _falta_video(self, t: dict, en_repo: set[str]) -> bool:
        n = t["n"]
        if n in self.cfg.rehacer:
            return True
        return not (self._traer(f"toma_{n:02d}.mp4", en_repo) or f"falla_{n:02d}.txt" in en_repo)

    # ───────────── 1. fotogramas clave ─────────────
    def fotogramas(self) -> dict[int, Path]:
        import torch
        from diffusers import (DPMSolverMultistepScheduler, StableDiffusionXLImg2ImgPipeline, StableDiffusionXLInpaintPipeline,
                               StableDiffusionXLPipeline)
        from PIL import Image
        cfg = self.cfg
        W, H = (1344, 768) if cfg.formato == "horizontal" else (768, 1344)
        en_repo = self._en_repo()
        pendientes = []
        for t in self.mias():
            if not self._falta_video(t, en_repo):
                continue  # la toma ya existe: no hace falta su fotograma
            f = self._traer(f"clave_{t['n']:02d}.jpg", en_repo)
            if f and t["n"] not in cfg.rehacer:
                self.claves[t["n"]] = f
            else:
                pendientes.append(t)
        print(f"Trabajador {cfg.trabajador}/{cfg.trabajadores}: {len(self.claves)} fotogramas listos · {len(pendientes)} por pintar")

        loras = {}
        if cfg.modo_personaje.startswith("entrenado"):
            for quien in ("actor", "actriz"):
                datos = comun.leer(f"medios/lora/{quien}.json")
                if not datos:
                    continue
                archivo = comun.en_drive(f"lora/{quien}.safetensors")
                if not archivo:
                    try:
                        archivo = comun.bajar(f"medios/lora/{quien}.safetensors")
                    except FileNotFoundError:
                        archivo = None
                if archivo:
                    loras[quien] = (Path(archivo), json.loads(datos)["palabra"])
        usar_lora = bool(loras)

        def de_quien(t):
            return "actriz" if (t.get("personaje") or "").startswith("actriz") else "actor"

        con_recorte = [t for t in pendientes if t.get("personaje") and not (usar_lora and de_quien(t) in loras)]
        con_texto = [t for t in pendientes if t not in con_recorte]

        def planificador(pipe):
            return DPMSolverMultistepScheduler.from_config(pipe.scheduler.config, use_karras_sigmas=True, algorithm_type="sde-dpmsolver++")

        def guardar_clave(n, img):
            f = self.local / f"clave_{n:02d}.jpg"
            img.convert("RGB").save(f, quality=92)
            self._publicar(f, f"Director: fotograma {n} de {self.carpeta}")
            self.claves[n] = f
            print("Fotograma listo:", n, self.por_n[n]["clase"])

        pintadas = {}
        if con_recorte:
            pipe = StableDiffusionXLInpaintPipeline.from_pretrained(INPAINT, torch_dtype=torch.float16, variant="fp16").to("cuda")
            pipe.scheduler = planificador(pipe)
            pasos_a = 20 if cfg.borrador else 25
            for t in con_recorte:
                recorte = Image.open(comun.bajar(f"medios/personajes/{t['personaje']}"))
                lienzo, mascara = director.componer_recorte(recorte, W, H, t.get("encuadre") or "primer_plano")
                pintado = pipe(prompt=t["imagen"], negative_prompt=director.NEGATIVO_FOTO, image=lienzo, mask_image=mascara,
                               width=W, height=H, strength=0.99, num_inference_steps=pasos_a, guidance_scale=6.0,
                               generator=torch.Generator("cuda").manual_seed(t["semilla"])).images[0].resize((W, H))
                pintadas[t["n"]] = Image.composite(pintado, lienzo, mascara)  # la cara original vuelve encima
            del pipe
            gc.collect(); torch.cuda.empty_cache()

        if con_texto or (pintadas and cfg.armonizar > 0):
            base = REALVIS_RAPIDO if cfg.rapido_imagen else REALVIS
            pasos_b, guia_b = (6, 1.5) if cfg.rapido_imagen else (cfg.pasos_imagen, 5.0)
            pipe = StableDiffusionXLPipeline.from_pretrained(base, torch_dtype=torch.float16, variant="fp16").to("cuda")
            pipe.scheduler = planificador(pipe)
            for quien, (archivo, _) in loras.items():
                pipe.load_lora_weights(str(archivo.parent), weight_name=archivo.name, adapter_name=quien)
            for t in con_texto:
                prompt = t["imagen"]
                if usar_lora and t.get("personaje") and de_quien(t) in loras:
                    palabra = loras[de_quien(t)][1]
                    prompt = prompt.replace("young man", palabra).replace("young woman", palabra)
                    pipe.enable_lora(); pipe.set_adapters([de_quien(t)], adapter_weights=[0.9])
                elif usar_lora:
                    pipe.disable_lora()
                img = pipe(prompt=prompt, negative_prompt=director.NEGATIVO_FOTO, width=W, height=H, num_inference_steps=pasos_b,
                           guidance_scale=guia_b, generator=torch.Generator("cuda").manual_seed(t["semilla"])).images[0]
                guardar_clave(t["n"], img)
            if pintadas and cfg.armonizar > 0:
                if usar_lora:
                    pipe.disable_lora()
                repaso = StableDiffusionXLImg2ImgPipeline(**pipe.components)
                for n, img in list(pintadas.items()):
                    pintadas[n] = repaso(prompt=self.por_n[n]["imagen"], negative_prompt=director.NEGATIVO_FOTO, image=img,
                                         strength=cfg.armonizar, num_inference_steps=max(pasos_b, math.ceil(3 / cfg.armonizar)),
                                         guidance_scale=guia_b, generator=torch.Generator("cuda").manual_seed(self.por_n[n]["semilla"])
                                         ).images[0].resize((W, H))
                del repaso
            del pipe
            gc.collect(); torch.cuda.empty_cache()
        for n, img in pintadas.items():
            guardar_clave(n, img)
        if self.claves:
            hoja = director.hoja_de_contactos([self.claves[n] for n in sorted(self.claves)], self.local / "fotogramas.jpg",
                                              columnas=4 if cfg.formato == "horizontal" else 6,
                                              ancho=420 if cfg.formato == "horizontal" else 240)
            _mostrar(hoja)
        return self.claves

    # ───────────── 2. movimiento ─────────────
    def animar(self) -> dict[int, Path]:
        import numpy as np
        import torch
        from diffusers import AutoencoderKLWan, UniPCMultistepScheduler, WanImageToVideoPipeline, WanTransformer3DModel
        from diffusers.utils import export_to_video
        from PIL import Image
        cfg = self.cfg
        rapido = cfg.motor.startswith("rap") or cfg.motor.startswith("ráp")
        grande = self.vram >= 22
        dtype = torch.bfloat16 if grande else torch.float16
        if cfg.borrador:
            aw, ah = 832, 480
        elif grande:
            aw, ah = 1280, 704
        elif rapido:
            aw, ah = 1024, 576
        else:
            aw, ah = 832, 480
        if cfg.formato == "vertical":
            aw, ah = ah, aw
        pasos = 3 if rapido else (cfg.pasos_video or (30 if grande else 20))
        # en la T4 caben ~3,4 s (81 cuadros) a la vez; el montaje estira las tomas más largas en cámara lenta (hasta 1,6x)
        maximo = 121 if grande else 81
        guia = 1.0 if rapido else 5.0

        en_repo = self._en_repo()
        faltan = []
        for t in self.mias():
            n = t["n"]
            f = None if n in cfg.rehacer else self._traer(f"toma_{n:02d}.mp4", en_repo)
            if f:
                self.tomas[n] = f
            elif (n in cfg.rehacer or f"falla_{n:02d}.txt" not in en_repo) and n in self.claves:
                faltan.append(t)
        print(f"Trabajador {cfg.trabajador}: {len(self.tomas)} tomas listas · {len(faltan)} por animar · {aw}x{ah}, {pasos} pasos")
        if not faltan:
            return self.tomas

        def ajustar(img):
            k = max(aw / img.width, ah / img.height)
            img = img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)
            x, y = (img.width - aw) // 2, (img.height - ah) // 2
            return img.crop((x, y, x + aw, y + ah))

        # textos → embeddings en un proceso aparte: al terminar suelta toda la memoria del codificador UMT5 (~11 GB)
        emb = self._codificar([t["mueve"] for t in faltan], con_negativo=not rapido, dtype=dtype)
        emb = dict(zip([t["n"] for t in faltan], emb))
        # el modelo de video va directo a la GPU (5B parámetros: ~10 GB en 16 bits; cabe en una T4 de 15 GB)
        transformer = WanTransformer3DModel.from_pretrained(FAST if rapido else M5, subfolder="transformer", torch_dtype=dtype,
                                                            device_map="cuda", low_cpu_mem_usage=True)
        vae = AutoencoderKLWan.from_pretrained(M5, subfolder="vae", torch_dtype=torch.float32).to("cuda")
        try:
            vae.enable_tiling()
        except Exception:
            pass
        programador = director.programador_dmd() if rapido else UniPCMultistepScheduler.from_pretrained(M5, subfolder="scheduler")
        pipe = WanImageToVideoPipeline(tokenizer=None, text_encoder=None, vae=vae, transformer=transformer, expand_timesteps=True,
                                       scheduler=programador)
        print(f"Modelo de video listo · {torch.cuda.memory_allocated() / 2**30:.1f} GB en la GPU")
        for t in faltan:
            n, dur = t["n"], t["hasta"] - t["desde"]
            pe, ne = emb[n]
            inicio = time.time()
            cuadros = None
            # si no cabe, se reintenta con menos cuadros: el montaje la estira en cámara lenta (hasta 1,6x)
            for duracion_gen in (dur, dur / 1.6, dur / 2.5):
                try:
                    with torch.no_grad():
                        cuadros = pipe(image=ajustar(Image.open(self.claves[n]).convert("RGB")), prompt_embeds=pe, negative_prompt_embeds=ne,
                                       height=ah, width=aw, num_frames=director.cuadros_para(duracion_gen, 24, maximo=maximo),
                                       num_inference_steps=pasos,
                                       guidance_scale=guia, generator=torch.Generator("cuda").manual_seed(t["semilla"])).frames[0]
                    break
                except torch.cuda.OutOfMemoryError:
                    gc.collect(); torch.cuda.empty_cache()
                    print(f"Toma {n}: {duracion_gen:.1f} s no caben en la GPU; pruebo con menos cuadros.")
            if cuadros is None:
                print(f"Toma {n}: no cupo en la GPU; entra como foto con movimiento de cámara.")
                self._marca(f"falla_{n:02d}.txt", "sin memoria")
                continue
            arr = np.asarray(cuadros, dtype=np.float32)
            if not np.isfinite(arr).all() or arr.mean() < 0.02:
                print(f"Toma {n}: salió negra (puede pasar en T4 con float16); entra como foto con movimiento de cámara.")
                self._marca(f"falla_{n:02d}.txt", "negra")
                continue
            crudo = self.local / f"toma_{n:02d}_crudo.mp4"
            export_to_video(cuadros, str(crudo), fps=24)
            final = self.local / f"toma_{n:02d}.mp4"
            comun.sh(f'ffmpeg -hide_banner -loglevel error -y -i "{crudo}" -c:v libx264 -crf {23 if cfg.borrador else 18} -preset medium '
                     f'-pix_fmt yuv420p -an "{final}"')
            self.tomas[n] = final
            self._publicar(final, f"Director: toma {n} de {self.carpeta}")
            print(f"Toma {n} lista ({t['clase']}) en {time.time() - inicio:.0f} s")
            _mostrar(final)
        del pipe, transformer, vae, emb
        gc.collect(); torch.cuda.empty_cache()
        return self.tomas

    def _codificar(self, textos: list[str], con_negativo: bool, dtype) -> list[tuple]:
        """Convierte los textos en embeddings con UMT5 en un proceso aparte y los trae de vuelta."""
        import subprocess
        import sys

        import torch
        entrada, salida = self.local / "textos.json", self.local / "textos.pt"
        entrada.write_text(json.dumps({"textos": textos, "negativo": director.NEGATIVO_VIDEO if con_negativo else None}))
        r = subprocess.run([sys.executable, str(Path(__file__).resolve()), "--codificar", str(entrada), str(salida)],
                           cwd=str(Path(__file__).resolve().parent))
        if r.returncode != 0:
            raise RuntimeError("Falló la codificación de los textos (mira el registro de arriba).")
        datos = torch.load(salida)
        return [(pe.to("cuda", dtype), ne.to("cuda", dtype) if ne is not None else None) for pe, ne in datos]

    def adoptar_fotogramas(self, carpeta: str | Path) -> None:
        """Toma fotogramas hechos por una versión anterior del cuaderno (clave_NN.png) y los suma a este video."""
        from PIL import Image
        for f in sorted(Path(carpeta).glob("clave_*.png")):
            n = int(f.stem.split("_")[1])
            if n in self.por_n and n not in self.claves:
                destino = self.local / f"clave_{n:02d}.jpg"
                Image.open(f).convert("RGB").save(destino, quality=92)
                self._publicar(destino, f"Director: fotograma {n} de {self.carpeta}")
                self.claves[n] = destino
        print("Fotogramas adoptados:", sorted(self.claves))

    # ───────────── 3. labios ─────────────
    @staticmethod
    def instalar_latentsync(vram: float) -> tuple[str, str]:
        """Instala LatentSync en un entorno aparte (o lo recupera de Drive). Devuelve (versión, config)."""
        import os

        def construir():
            if not os.path.exists(LS_DIR):
                comun.sh(f"git clone -q https://github.com/bytedance/LatentSync {LS_DIR}")
                comun.sh(f"git -C {LS_DIR} checkout -q {LS_COMMIT}")
            comun.sh(f"pip install -q uv && uv venv -q -p 3.10 {LS_ENV}")
            comun.sh(f"uv pip install -q -p {LS_ENV}/bin/python -r requirements.txt", cwd=LS_DIR)

        if not os.path.exists(LS_DIR):
            comun.sh(f"git clone -q https://github.com/bytedance/LatentSync {LS_DIR}")
            comun.sh(f"git -C {LS_DIR} checkout -q {LS_COMMIT}")
        comun.con_cache_drive("latentsync_env", LS_ENV, construir)
        version = "1.6" if vram >= 18 else "1.5"
        config = "configs/unet/stage2_512.yaml" if version == "1.6" else "configs/unet/stage2.yaml"
        from huggingface_hub import hf_hub_download
        for f in ["whisper/tiny.pt", "latentsync_unet.pt"]:
            hf_hub_download(f"ByteDance/LatentSync-{version}", f, local_dir=f"{LS_DIR}/checkpoints")
        # la carpeta de sus modelos auxiliares se crea antes: si dos GPU la crean a la vez, una fallaba con FileExistsError
        os.makedirs(f"{LS_DIR}/checkpoints/auxiliary/models", exist_ok=True)
        return version, config

    def labios(self) -> dict[int, Path]:
        cfg = self.cfg
        cantan = [t for t in self.mias() if t["canta"] and t["n"] in self.tomas]
        if not cfg.labios or not cantan:
            print("Sin tomas para sincronizar labios en este trabajador.")
            return self.tomas
        en_repo = self._en_repo()
        pendientes = []
        for t in cantan:
            n = t["n"]
            f = None if n in cfg.rehacer else self._traer(f"labios_{n:02d}.mp4", en_repo)
            if f:
                self.tomas[n] = f
            elif n in cfg.rehacer or f"sin_labios_{n:02d}.txt" not in en_repo:
                pendientes.append(t)
        if not pendientes:
            return self.tomas
        version, config = self.instalar_latentsync(self.vram)
        camino_voz = ((self.p.get("ia") or {}).get("cancion") or {}).get("voz")
        voz = comun.bajar(camino_voz) if camino_voz else comun.separar_voz(comun.bajar(self.p["audio"]))[0]
        pasos = min(cfg.pasos_labios, 10) if cfg.borrador else cfg.pasos_labios
        for t in pendientes:
            n = t["n"]
            tramo = self.local / f"tramo_{n:02d}.wav"
            comun.sh(f'ffmpeg -hide_banner -loglevel error -y -ss {t["desde"]} -to {t["hasta"]} -i "{voz}" -ac 1 -ar 16000 "{tramo}"')
            crudo = self.local / f"labios_{n:02d}_crudo.mp4"
            orden = (f'{LS_ENV}/bin/python -m scripts.inference --unet_config_path "{config}" '
                     f'--inference_ckpt_path checkpoints/latentsync_unet.pt --inference_steps {pasos} --guidance_scale 1.5 '
                     f'--enable_deepcache --video_path "{self.tomas[n]}" --audio_path "{tramo}" --video_out_path "{crudo}"')
            try:
                try:
                    comun.sh(orden, cwd=LS_DIR, env=ENTORNO_LS)
                except RuntimeError:  # un segundo intento: la primera vez puede chocar con la otra GPU al bajar sus modelos
                    time.sleep(20)
                    comun.sh(orden, cwd=LS_DIR, env=ENTORNO_LS)
            except RuntimeError as e:
                print(f"Toma {n}: LatentSync no pudo con esta toma; queda sin labios sincronizados.\n{str(e)[-800:]}")
                self._marca(f"sin_labios_{n:02d}.txt", str(e)[-500:])
                continue
            final = self.local / f"labios_{n:02d}.mp4"
            comun.sh(f'ffmpeg -hide_banner -loglevel error -y -i "{crudo}" -c:v libx264 -crf {23 if cfg.borrador else 18} -pix_fmt yuv420p -an "{final}"')
            self.tomas[n] = final
            self._publicar(final, f"Director: labios de la toma {n} ({version})")
            print(f"Toma {n}: labios listos (LatentSync {version})")
            _mostrar(final)
        return self.tomas

    # ───────────── 4. montaje ─────────────
    def estado(self) -> tuple[dict[int, Path], list[int]]:
        """Para cada toma, el mejor archivo disponible (aquí, en Drive o en el repo) y las que todavía faltan."""
        en_repo = self._en_repo()
        listos, faltan = {}, []
        for t in self.plano:
            n = t["n"]
            if t["canta"] and self.cfg.labios:
                lab = self._traer(f"labios_{n:02d}.mp4", en_repo)
                if lab:
                    listos[n] = lab
                    continue
                esperar_labios = f"sin_labios_{n:02d}.txt" not in en_repo and f"falla_{n:02d}.txt" not in en_repo
            else:
                esperar_labios = False
            toma = self._traer(f"toma_{n:02d}.mp4", en_repo)
            if toma and not esperar_labios:
                listos[n] = toma
            elif f"falla_{n:02d}.txt" in en_repo:
                clave = self._traer(f"clave_{n:02d}.jpg", en_repo)
                if clave:
                    listos[n] = clave  # foto con un acercamiento lento de cámara
                else:
                    faltan.append(n)
            else:
                faltan.append(n)
        return listos, faltan

    def montar(self, esperar_min: float = 0, franjas: bool = True, grano: int = 7) -> Path:
        """Monta el video. Con esperar_min > 0 espera a que las otras GPU terminen sus tomas."""
        limite = time.time() + esperar_min * 60
        while True:
            listos, faltan = self.estado()
            if not faltan or time.time() > limite:
                break
            print(f"Esperando {len(faltan)} toma(s) de las otras GPU: {faltan} …")
            time.sleep(60)
        if faltan:
            print("Monto sin estas tomas (quedan en negro):", faltan)
        cancion = comun.bajar(self.p["audio"])
        salida = self.local / f"{self.nombre}_director_{self.cfg.formato}{'_borrador' if self.cfg.borrador else ''}.mp4"
        director.montar(self.plano, {n: str(f) for n, f in listos.items()}, cancion, salida, formato=self.cfg.formato,
                        franjas=franjas, grano=grano, carpeta=self.local / "montaje",
                        resolucion=720 if self.cfg.borrador else 1080, crf=23 if self.cfg.borrador else 20)
        comun.a_drive(salida, f"director/{self.carpeta}/{salida.name}")
        self.video = salida
        self.listos = listos
        return salida

    def guardar(self, poner_en_escenas: bool = True) -> str:
        """Sube el video al repo y, si se pide, convierte cada toma en una escena `video` del portal."""
        salida = self.video
        # 1) el video completo, en calidad final, al release (hasta 2 GB: alcanza para 30 min en 1080p)
        enlace = comun.subir_grande(self.etiqueta, salida)
        # 2) una copia en el repo para el portal, solo si cabe (GitHub no acepta archivos de más de 100 MB)
        destino = None
        final = salida
        if salida.stat().st_size > 20 * 2**20 and self.duracion <= 8 * 60:
            final = salida.with_name(salida.stem + "_liviano.mp4")
            comun.sh(f'ffmpeg -hide_banner -loglevel error -y -i "{salida}" -c:v libx264 -crf 26 -preset medium -c:a copy -movflags +faststart "{final}"')
        # la API de archivos de GitHub rechaza envíos grandes (422 con ~40 MB): el repo solo guarda copias livianas
        if final.stat().st_size <= 20 * 2**20:
            try:
                destino = f"medios/videos/{salida.name}"
                comun.guardar(destino, final.read_bytes(), f"Video director: {self.p.get('titulo')} ({self.carpeta})")
            except Exception as e:  # noqa: BLE001
                destino = None
                print("No pude dejar la copia en el repo (queda en el release):", str(e)[:150])
        if not destino:
            print("El video completo queda en el release:", enlace)
        # las escenas del portal apuntan a cada toma: solo para videos cortos (en uno de 30 min serían cientos de archivos)
        if poner_en_escenas and len(self.plano) > 80:
            print(f"No pongo las {len(self.plano)} tomas como escenas del portal (son demasiadas); el video completo queda guardado.")
            poner_en_escenas = False
        p = comun.proyecto(self.cfg.proyecto)  # leído de nuevo, por si cambió mientras tanto
        filtros = {"byn": "byn", "fantasma": "frio", "noche": "frio", "dorado": "calido"}
        if poner_en_escenas:
            nuevas = []
            for t in self.plano:
                f = self.listos.get(t["n"])
                if not f or Path(f).suffix != ".mp4":
                    continue
                # el portal lee las escenas del repo: se copia ahí cada toma usada
                if Path(f).name not in self._en_repo_textos():
                    comun.guardar(f"{self.base}/{Path(f).name}", Path(f).read_bytes(), f"Director: escena {Path(f).name}")
                e = {"tipo": "video", "desde": t["desde"], "hasta": t["hasta"], "archivo": f"{self.base}/{Path(f).name}", "inicioClip": 0,
                     "ia": {"director": t["clase"], "prompt": t["mueve"], "labios": Path(f).name.startswith("labios_")}}
                if t["grado"] in filtros:
                    e["filtro"] = filtros[t["grado"]]
                nuevas.append(e)
            if nuevas:
                p.setdefault("escenas_antes_director", p["escenas"])
                p["escenas"] = nuevas
        p["director"] = {"plano": self.plano, "formato": self.cfg.formato, "video": destino or enlace, "video_completo": enlace,
                         "release": self.etiqueta, "carpeta": self.base,
                         "config": {k: v for k, v in asdict(self.cfg).items() if k not in ("trabajador", "trabajadores", "rehacer")}}
        comun.guardar_proyecto(self.cfg.proyecto, p, f"Proyecto: video director para {p.get('titulo')}")
        print("Listo. Video completo:", enlace)
        if destino:
            print("Copia para el portal en", destino, "· En el portal pulsa «Recargar proyecto».")
        return destino or enlace

    def _en_repo_textos(self) -> set[str]:
        if not hasattr(self, "_repo_cache"):
            try:
                self._repo_cache = set(comun.listar(self.base))
            except Exception:
                self._repo_cache = set()
        return self._repo_cache

    def trabajar(self) -> None:
        """Lo que hace cada GPU: fotogramas, movimiento y labios de sus tomas."""
        print(self.tabla())
        print(f"\nTrabajador {self.cfg.trabajador} de {self.cfg.trabajadores}: tomas {[t['n'] for t in self.mias()]}")
        if self.cfg.solo_labios:
            en_repo = self._en_repo()
            for t in self.mias():
                f = self._traer(f"toma_{t['n']:02d}.mp4", en_repo)
                if f:
                    self.tomas[t["n"]] = f
            # vuelve a intentar también las que quedaron marcadas «sin labios»
            self.cfg.rehacer = [t["n"] for t in self.mias() if t["canta"] and f"labios_{t['n']:02d}.mp4" not in en_repo]
            self.labios()
            print(f"Trabajador {self.cfg.trabajador}: labios terminados")
            return
        self.fotogramas()
        self.animar()
        self.labios()
        print(f"Trabajador {self.cfg.trabajador}: terminado")


def _codificar_aqui(entrada: str, salida: str) -> None:
    """Modo --codificar: carga UMT5 en bfloat16 (en float16 puede dar NaN), codifica y guarda en CPU."""
    import torch
    from diffusers import WanPipeline
    datos = json.loads(Path(entrada).read_text())
    cod = WanPipeline.from_pretrained(M5, transformer=None, vae=None, torch_dtype=torch.bfloat16, device_map="cuda", low_cpu_mem_usage=True)
    res = []
    with torch.no_grad():
        for texto in datos["textos"]:
            pe, ne = cod.encode_prompt(prompt=texto, negative_prompt=datos["negativo"], do_classifier_free_guidance=datos["negativo"] is not None,
                                       device="cuda", dtype=torch.bfloat16)
            res.append((pe.float().cpu(), ne.float().cpu() if ne is not None else None))
    torch.save(res, salida)
    print(f"{len(res)} textos codificados")


if __name__ == "__main__":
    import sys
    if len(sys.argv) == 4 and sys.argv[1] == "--codificar":
        _codificar_aqui(sys.argv[2], sys.argv[3])
        sys.exit(0)
    ap = argparse.ArgumentParser(description="Trabajador del director de VIDEO-FREE")
    ap.add_argument("--config", default="{}", help="JSON con las opciones de Config")
    ap.add_argument("--trabajador", type=int, default=1)
    ap.add_argument("--trabajadores", type=int, default=1)
    ap.add_argument("--repo", default=comun.REPO)
    ap.add_argument("--rama", default=comun.RAMA)
    a = ap.parse_args()
    opciones = json.loads(a.config)
    opciones.update(trabajador=a.trabajador, trabajadores=a.trabajadores)
    comun.preparar(a.repo, a.rama, usar_drive=False)
    Director(Config(**opciones)).trabajar()
