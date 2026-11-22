# VIDEO-FREE — instrucciones para Claude

Estudio web de videos musicales con **código propio**. El dueño no quiere depender de terceros.

## Reglas que no se rompen

1. **Cero dependencias.** Nada de npm, CDN, librerías, fuentes descargadas ni frameworks. Solo HTML, CSS y JavaScript del navegador (Canvas 2D, Web Audio, MediaRecorder, fetch). No hay paso de compilación.
2. **Nada de material de terceros**: ni fotos, ni muestras de audio, ni tipografías. Las fuentes son las del sistema. Los personajes son originales del dueño.
3. Personajes: solo caras originales o del propio dueño. Nunca parecidos de famosos.
4. Todo lo dibujado depende solo del tiempo `t` y del proyecto. Nada de `Math.random()` ni de relojes al dibujar: usa `azar(semilla)` de `motor.js`. Así la vista previa y el video exportado coinciden.
5. Nombres, comentarios y textos de la interfaz en español.
6. Las escenas deben verse bien en horizontal y en vertical (`H > W`).
7. Licencia propietaria (`LICENSE`): no agregar código con otra licencia.
8. **Excepción: `colab/`.** Los cuadernos de Google Colab pueden instalar y ejecutar modelos de IA abiertos de terceros (solo con licencias MIT, Apache 2.0 u OpenRAIL++, listadas en `colab/LICENCIAS-TERCEROS.md`). Nada de eso se copia al repo ni entra al portal web; se descarga en Colab al usarlo. No usar modelos con licencias no comerciales (por ejemplo Wav2Lip, MusicGen, HunyuanVideo).

## Mapa

- `index.html`, `css/estilo.css` — el portal.
- `js/motor.js` — motor de dibujo: utilidades, piezas (cielo, paisaje, auto, personaje), escenas (`ESCENAS`), letra karaoke, línea melódica, acabado y `dibujar()`.
- `js/sonido.js` — carga de audio y medición LUFS.
- `js/dsp.js` — núcleo de audio propio: biquads, resonadores de formante, reverb, compresor, limitador.
- `js/instrumentos.js` — instrumentos sintetizados (batería, bajo 808, guitarra Karplus-Strong, piano, cuerdas, percusión) y arreglista por secciones.
- `js/voz.js` — análisis de la voz: tono (YIN), energía, rango, tonalidad, frases.
- `js/canto.js` — cantante: texto en español → fonemas → partitura → audio. Motor «sintetica» (formantes tipo Klatt con jitter, shimmer, aire, vibrato, coarticulación, doblaje) y motor «mivoz» (PSOLA con las vocales grabadas por el dueño en `medios/voz/`). Mezcla final con la pista.
- `js/exportar.js` — grabación con MediaRecorder y portada PNG.
- `js/github.js` — leer y guardar en el repo con la API de GitHub.
- `js/app.js` — la interfaz.
- `proyectos/*.json` — cada video: datos, escenas, letra y análisis de voz. `proyectos/indice.json` lista los proyectos.
- `medios/` — personajes, audio y clips. `ideas/ideas.md` — libreta del dueño.
- `colab/` — cuadernos de IA (1 canción con voz, 2 mi voz con RVC, 3 video con Wan, 4 labios con LatentSync, 5 director del video completo, 6 entrenar personaje con LoRA), `comun.py` (GitHub, Drive, audio, alineación de letra con faster-whisper o transformers), `director.py` (plano de tomas por compases, fotograma con recorte, montaje con ffmpeg; se puede probar sin GPU) y `generar.py` (motor del director que usan el cuaderno 5 en Colab y el 7 en Kaggle; varias GPU se reparten las tomas y las comparten por `medios/director/` en el repo). Los cuadernos se generan con celdas JSON; valida su sintaxis antes de subirlos.

## Cómo agregar una escena nueva

Agrega una función a `ESCENAS` en `js/motor.js` con la firma `(c, W, H, e, tl, dur, p, R, t)`:
`c` contexto 2D, `e` datos de la escena, `tl` segundos dentro de la escena, `p` proyecto, `R` recursos, `t` tiempo global. Aparece sola en el selector de tipos. Documenta sus opciones en la ayuda de la pestaña Escenas de `index.html`.

## Cómo probar

Sirve la carpeta (`python3 -m http.server 8000`) y abre `http://localhost:8000`. Antes de dar algo por terminado, mira fotogramas en los momentos con más cosas en pantalla, en horizontal y vertical, y revisa que la consola no tenga errores.
