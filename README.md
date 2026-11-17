# VIDEO-FREE · Estudio de videos musicales con código propio

Un portal web para armar videos musicales. Todo el código es propio: HTML, CSS y JavaScript del navegador, sin librerías, sin npm, sin fuentes ni fotos de terceros y sin paso de instalación.

**Software propietario. Todos los derechos reservados.** Lee `LICENSE` antes de usar cualquier parte de este repositorio.

## Qué hace

| Pestaña | Para qué |
|---|---|
| Proyecto | Título, artista, BPM, colores y canción |
| Escenas | Armar la historia por tiempos |
| Letra | Karaoke palabra por palabra |
| Voz | Notas, rango, tonalidad y frases |
| Medios | Quitar fondo y subir archivos |
| Exportar | Video y portada |
| Ideas | Libreta guardada en el repo |
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

## Voz cantada sintética

En la pestaña Voz, «Generar voz cantada» hace que el estudio cante la letra con un sintetizador propio (síntesis por formantes: una fuente tipo cuerdas vocales, filtros que imitan cada vocal y ruido para las consonantes).

- **Letra y tiempos:** los de la pestaña Letra. Sincroniza primero la letra.
- **Melodía:** si analizaste tu pista de voz, canta las notas que tú cantaste en cada momento. Si no, compone una melodía dentro de la tonalidad y cerca del centro de tu voz.
- **Mezcla:** la voz se suma a la canción en la vista previa y en el video exportado. También se descarga sola en WAV.

Es una voz de instrumento, con sonido sintético. No es un clon: no copia tu timbre. Un clon de tu voz necesita un modelo de IA entrenado, que es un servicio externo.

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
js/sonido.js          audio, pista de prueba, LUFS
js/voz.js             análisis de la voz
js/canto.js           cantante sintético
js/exportar.js        grabación y portada
js/github.js          guardar y leer en el repo
js/app.js             interfaz
proyectos/            un .json por video
medios/               personajes, audio y clips
ideas/ideas.md        libreta
```

## Licencia

Copyright © 2026 ivanherrerabaquero-dev. Todos los derechos reservados. Nadie puede copiar, modificar, distribuir ni usar comercialmente este proyecto sin permiso escrito del titular. El texto completo está en `LICENSE`.
