# VIDEO-FREE · Estudio de videos musicales con código propio

Un portal web para armar videos musicales. Todo el código es propio: HTML, CSS y JavaScript del navegador, sin librerías, sin npm, sin fuentes ni fotos de terceros y sin paso de instalación.

**Software propietario. Todos los derechos reservados.** Lee `LICENSE` antes de usar cualquier parte de este repositorio.

## Qué hace

| Pestaña | Para qué |
|---|---|
| Proyecto | Título, artista, BPM, colores y canción |
| Escenas | Armar la historia por tiempos |
| Letra | Karaoke palabra por palabra |
| Música | Pista con instrumentos propios |
| Voz | Análisis y voz que canta la letra |
| Medios | Quitar fondo y subir archivos |
| Exportar | Video y portada |
| Ideas | Libreta guardada en el repo |
| IA | Cuadernos de Colab y recarga del proyecto |
| GitHub | Conectar el portal con el repo |

## Abrir el portal

**En internet (GitHub Pages).** En el repo: Settings → Pages → Source: «Deploy from a branch» → rama `main`, carpeta `/ (root)` → Save. En uno o dos minutos queda en:

`https://ivanherrerabaquero-dev.github.io/VIDEO-FREE/`

**En tu equipo.** Descarga el repo y, dentro de la carpeta:

```bash
python -m http.server 8000
```

Luego abre `http://localhost:8000`. Usa Chrome o Edge actualizados.

## Conectar con GitHub para guardar desde el portal

1. En GitHub: Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.
2. Repository access: «Only select repositories» → `VIDEO-FREE`.
3. Permissions → Repository permissions → **Contents: Read and write**.
4. En el portal, pestaña GitHub: pega el token y pulsa Conectar.

El token queda solo en ese navegador y solo se envía a `api.github.com`. Desde ahí, «Guardar en GitHub» crea un commit con tu proyecto, tus ideas o tus medios. GitHub Pages tarda cerca de un minuto en publicar cada cambio; con el token puesto, el portal lee directo del repo y ve los cambios al instante.

## La voz

Carga tu voz cantada en la pestaña Voz, ojalá sola y sin pista. El estudio calcula, con su propio algoritmo de detección de tono (YIN):

- la nota más grave, la central y la más aguda, y el rango en semitonos;
- la tonalidad más probable, para elegir en qué tono producir la pista;
- las frases cantadas, con su inicio y su fin;
- la fuerza de la voz en cada instante.

Con eso, el video responde a la voz: el brillo del cantante crece cuando canta, el lyric video dibuja la línea melódica, y «Acomodar según la voz» pone cada línea de la letra sobre una frase cantada. Para afinar palabra por palabra, usa «Sincronizar con toques»: suena la canción y marcas cada palabra con la barra espaciadora.

## Música

La pestaña Música compone y toca la pista con instrumentos propios, sintetizados muestra por muestra: batería, bajo 808, guitarra de nailon (cuerda pulsada Karplus-Strong), piano, cuerdas y percusión. Eliges el estilo (reggaetón, balada pop, trap latino), la tonalidad (o la de tu voz), la progresión de acordes, la intensidad y qué instrumentos suenan. Las secciones siguen la letra: intro hasta que empiezas a cantar, luego versos y coros, y un final.

## La voz que canta la letra

En la pestaña Voz, «Generar voz cantada» canta la letra con sus tiempos. Hay dos motores:

- **Voz sintética mejorada.** Síntesis por formantes: una fuente glotal con pequeñas irregularidades humanas (jitter, shimmer, aire), cinco formantes que se mueven de una vocal a otra, nasales, consonantes con ruido filtrado, portamento, vibrato que llega tarde, un doblaje y reverb. Suena mucho más natural que la versión anterior, pero sigue siendo una voz sintética.
- **Con mis vocales (tu timbre).** Grabas las cinco vocales sostenidas en «Mi banco de vocales» y el estudio las reafina nota por nota (PSOLA), conservando tu color de voz. Las consonantes salen del motor sintético. El banco se guarda en `medios/voz/`.

La melodía sale de tu pista de voz analizada (con afinador automático opcional) o se compone sobre los acordes de la pista, con frases que se repiten como en una canción. La voz se mezcla con la pista, que baja un poco cuando cantas, y se descarga sola en WAV.

Ningún motor es un clon de voz con IA: eso requiere modelos entrenados y servicios externos.

## Inteligencia artificial en Google Colab

Para lo que el código propio del navegador no alcanza (una voz humana natural, tu timbre, video realista y labios sincronizados), el estudio trae cuatro cuadernos de Google Colab en la carpeta `colab/`. Cada uno lee tu proyecto desde GitHub, usa una GPU de Colab y devuelve el resultado a tu repo. En el portal, la pestaña **IA** tiene los botones para abrirlos.

| Cuaderno | Qué hace | GPU |
|---|---|---|
| 1 · Canción IA | Canción con voz en español | T4 |
| 2 · Mi voz | La voz pasa a tu timbre | T4 |
| 3 · Video IA | Tomas desde texto o imagen | L4/A100 (T4 a 480p) |
| 4 · Labios | Boca sincronizada con el canto | L4/A100 (T4 a 256 px) |

1. **Canción con voz** (ACE-Step 1.5): toma tu letra, el estilo, el BPM y la tonalidad, y genera la canción completa con voz cantando en español. Separa la voz (Demucs) y sincroniza la letra palabra por palabra (Whisper).
2. **Mi voz** (RVC): entrenas un modelo con 10 minutos o más de tu voz limpia y la voz de la canción pasa a ser la tuya, con la misma melodía. El modelo queda en tu Drive.
3. **Video IA** (Wan 2.2 / 2.1): crea tomas realistas de unos 5 segundos desde un texto o desde una imagen, por ejemplo tu hoja de personaje. Las pone en las escenas que tengan `"ia"`, o en todas.
4. **Labios** (LatentSync): toma una escena donde se ve la cara del cantante y le mueve la boca al ritmo de la parte de la canción que suena en esa escena.

**Para empezar:** abre el cuaderno, elige *Entorno de ejecución → Cambiar tipo → GPU* y guarda tu token de GitHub en los **Secretos** de Colab con el nombre `GITHUB_TOKEN`. Luego ejecuta las celdas en orden y, al terminar, pulsa «Recargar proyecto» en la pestaña IA del portal.

**Seedance** (de ByteDance) es un modelo cerrado. No publica sus pesos y solo se usa pagando su API, así que no puede correr en Colab. Wan 2.2 es el modelo de video abierto más avanzado que se puede descargar.

Estos modelos son de terceros con licencias abiertas. El detalle está en `colab/LICENCIAS-TERCEROS.md`.

## Escenas

Cada escena tiene `tipo`, `desde` y `hasta` (segundos) y sus opciones.

| Tipo | Qué muestra | Opciones |
|---|---|---|
| `titulo` | Auto de perfil, artista y canción | `hora` |
| `auto` | Auto de perfil, paisaje pasando | `hora` |
| `dron` | Tomas siguiendo al auto | `angulos`, `cada`, `hora` |
| `carretera` | Carretera de frente y personaje | `personaje`, `lado`, `fantasma`, `hora` |
| `recuerdo` | Luz dorada y polvo | `personaje`, `objeto` |
| `cierre` | Noche, auto detenido, créditos | `personaje` |
| `foto` | Imagen con zoom lento | `imagen`, `zoom` |
| `video` | Clip a pantalla completa | `archivo`, `inicioClip` |

- `hora` va de 0 (tarde) a 1 (noche): `[inicio, fin]`.
- `angulos` del dron: `"cenital"` (desde arriba), `"persecucion"` (desde atrás) y `"lateral"`.
- Cualquier escena acepta `"filtro": "byn"` (blanco y negro), `"calido"` o `"frio"`.

## Imagen real o dibujada

Las escenas `titulo`, `auto`, `dron`, `carretera`, `recuerdo` y `cierre` son **ilustración animada** hecha con código. No son imagen real.

Para un video con actores, calles y luz reales hay dos caminos: grabarlo con cámara o generar las tomas con un modelo de video con IA. En ambos casos las tomas entran al estudio como escenas `video`, y aquí se montan con la canción, la letra, los filtros y los formatos de salida. La sincronía de labios realista también depende de esas tomas: se graba cantando sobre la pista, o la hace un modelo de IA de sincronía labial.

## Exportar

«Grabar video» usa el grabador del navegador y va en tiempo real: una canción de 3 minutos tarda 3 minutos. Deja la pestaña visible mientras graba. La fluidez depende del equipo: si el video sale a saltos, cierra otras pestañas o graba en un equipo con mejor tarjeta gráfica.

Chrome y Edge graban en MP4 cuando el equipo tiene codificador H.264; si no, en WebM. La casilla de volumen deja la canción en −14 LUFS, el nivel que usan YouTube, Spotify, TikTok e Instagram.

## De qué depende y de qué no

| No depende de | Sí necesita |
|---|---|
| Librerías o frameworks | Un navegador moderno |
| npm o instalación | GitHub, si quieres el portal en línea |
| Fuentes, fotos o audios ajenos | — |
| Licencias de otros proyectos | — |

## Estructura

```
index.html            el portal
css/estilo.css
js/motor.js           motor de dibujo y escenas
js/sonido.js          audio y LUFS
js/dsp.js             filtros, reverb, compresor
js/instrumentos.js    instrumentos y arreglista
js/voz.js             análisis de la voz
js/canto.js           voz que canta la letra
js/exportar.js        grabación y portada
js/github.js          guardar y leer en el repo
js/app.js             interfaz
proyectos/            un .json por video
medios/               personajes, audio y clips
ideas/ideas.md        libreta
colab/                cuadernos de IA para Google Colab
```

## Licencia

Copyright © 2026 ivanherrerabaquero-dev. Todos los derechos reservados. Nadie puede copiar, modificar, distribuir ni usar comercialmente este proyecto sin permiso escrito del titular. El texto completo está en `LICENSE`.
