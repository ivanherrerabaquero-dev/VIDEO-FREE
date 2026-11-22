# Licencias de terceros (solo cuadernos de Colab)

El portal web de VIDEO-FREE (`index.html`, `css/`, `js/`) es código propio y no usa nada de terceros.

Los cuadernos de esta carpeta (`colab/`) son la única excepción. Descargan y ejecutan modelos y programas de IA abiertos **dentro de Google Colab, en el momento de usarlos**. Ninguno de esos modelos ni programas se copia ni se guarda en este repositorio. Cada uno conserva su propia licencia. El código de los cuadernos y `comun.py` es del titular de VIDEO-FREE y está cubierto por el archivo `LICENSE` de la raíz.

| Componente | Para qué | Licencia |
|---|---|---|
| ACE-Step 1.5 XL Turbo | Canción con voz | MIT |
| Diffusers (Hugging Face) | Ejecutar modelos | Apache 2.0 |
| Demucs | Separar voz | MIT |
| faster-whisper + Whisper large-v3 | Tiempos de la letra | MIT |
| RVC (Retrieval-based Voice Conversion) | Tu timbre | MIT |
| Modelos base de RVC (lj1995) | Entrenar tu voz | MIT |
| Wan 2.2 TI2V-5B / Wan 2.1 T2V-1.3B | Tomas de video | Apache 2.0 |
| LatentSync (código) | Labios | Apache 2.0 |
| LatentSync 1.5 / 1.6 (modelos) | Labios | OpenRAIL++ |
| uv | Entornos aparte | Apache 2.0 / MIT |

## Lo que esto significa en la práctica

- **MIT y Apache 2.0** permiten el uso comercial. Lo que generes (canciones, voces, videos) es tuyo. Si algún día copias el código de uno de estos proyectos dentro del tuyo, debes conservar su aviso de licencia.
- **OpenRAIL++** (modelos de LatentSync) también permite el uso comercial, pero prohíbe usos dañinos. Entre ellos están suplantar a una persona sin su permiso, engañar o difamar. Úsalo con tu propia cara o con personajes originales.
- **Google Colab** es un servicio de Google con sus propias condiciones. Su plan gratuito no garantiza GPU ni tiempo de uso.
- **Voces y caras:** entrena RVC solo con tu voz, o con la de alguien que te dé permiso. Lo mismo aplica a las caras.

Las licencias pueden cambiar en versiones futuras de cada modelo. Los cuadernos fijan versiones concretas (commits de RVC y LatentSync) para que no cambien sin aviso.
