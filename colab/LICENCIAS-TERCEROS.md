# Licencias de terceros (solo cuadernos de Colab)

El portal web de VIDEO-FREE (`index.html`, `css/`, `js/`) es código propio y no usa nada de terceros.

Los cuadernos de esta carpeta (`colab/`) son la única excepción. Descargan y ejecutan modelos y programas de IA abiertos **dentro de Google Colab, en el momento de usarlos**. Ninguno de esos modelos ni programas se copia ni se guarda en este repositorio. Cada uno conserva su propia licencia. El código de los cuadernos y `comun.py` es del titular de VIDEO-FREE y está cubierto por el archivo `LICENSE` de la raíz.

| Componente | Para qué | Licencia |
|---|---|---|
| ACE-Step 1.5 XL Turbo | Canción con voz | MIT |
| Diffusers (Hugging Face) | Ejecutar modelos | Apache 2.0 |
| Demucs | Separar voz | MIT |
| Whisper large-v3 turbo (transformers) | Tiempos de la letra | MIT |
| faster-whisper (SYSTRAN) y CTranslate2 | Tiempos de la letra, más rápido | MIT |
| RVC (Retrieval-based Voice Conversion) | Tu timbre | MIT |
| Modelos base de RVC (lj1995) | Entrenar tu voz | MIT |
| Wan 2.2 TI2V-5B / Wan 2.1 T2V-1.3B | Tomas de video | Apache 2.0 |
| Wan 2.2 TI2V-5B GGUF (QuantStack) | Video en T4 (comprimido) | Apache 2.0 |
| RealVisXL 5.0 y RealVisXL 4.0 inpainting (base SDXL) | Fotogramas clave fotorrealistas | OpenRAIL++ |
| Script DreamBooth LoRA SDXL (Diffusers) | Entrenar tu personaje | Apache 2.0 |
| PEFT, bitsandbytes, gguf | Entrenar y cargar modelos | Apache 2.0 / MIT / MIT |
| LatentSync (código) | Labios | Apache 2.0 |
| LatentSync 1.5 / 1.6 (modelos) | Labios | OpenRAIL++ |
| uv | Entornos aparte | Apache 2.0 / MIT |

## Lo que esto significa en la práctica

- **MIT y Apache 2.0** permiten el uso comercial. Lo que generes (canciones, voces, videos) es tuyo. Si algún día copias el código de uno de estos proyectos dentro del tuyo, debes conservar su aviso de licencia.
- **OpenRAIL++** (modelos de LatentSync) también permite el uso comercial, pero prohíbe usos dañinos. Entre ellos están suplantar a una persona sin su permiso, engañar o difamar. Úsalo con tu propia cara o con personajes originales.
- **ComfyUI** (GPL-3.0) y el **código fuente de FFmpeg** (LGPL/GPL) no se incluyen. Copiar código GPL obligaría a publicar VIDEO-FREE con esa licencia. Los cuadernos usan los mismos modelos con Diffusers (Apache 2.0), y FFmpeg solo como programa ya instalado en Colab.
- **Google Colab** es un servicio de Google con sus propias condiciones. Su plan gratuito no garantiza GPU ni tiempo de uso.
- **Voces y caras:** entrena RVC solo con tu voz, o con la de alguien que te dé permiso. Lo mismo aplica a las caras.

Las licencias pueden cambiar en versiones futuras de cada modelo. Los cuadernos fijan versiones concretas (commits de RVC y LatentSync) para que no cambien sin aviso.
