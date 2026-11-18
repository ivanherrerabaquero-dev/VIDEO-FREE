// VIDEO-FREE · Núcleo de audio propio. Todo se calcula muestra por muestra en JavaScript,
// sin la Web Audio API, para que el resultado sea idéntico en cualquier navegador.

export const SR = 44100;
export const midiAHz = (m) => 440 * 2 ** ((m - 69) / 12);
export const dbAGanancia = (db) => 10 ** (db / 20);

/** Generador de ruido determinista (xorshift). Devuelve una función que da valores entre -1 y 1. */
export function generadorRuido(semilla = 1) {
  let x = (semilla * 2654435761) >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 2147483648 - 1; };
}

/** Filtro biquad (fórmulas de Robert Bristow-Johnson). tipo: lowpass, highpass, bandpass, peaking, lowshelf, highshelf, notch. */
export class Biquad {
  constructor(tipo, hz, q = 0.707, db = 0, sr = SR) { this.z1 = this.z2 = 0; this.ajustar(tipo, hz, q, db, sr); }
  ajustar(tipo, hz, q = 0.707, db = 0, sr = SR) {
    const w = (2 * Math.PI * Math.min(hz, sr * 0.49)) / sr, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q), A = 10 ** (db / 40);
    let b0, b1, b2, a0, a1, a2;
    switch (tipo) {
      case "lowpass": b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; break;
      case "highpass": b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; break;
      case "bandpass": b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; break;
      case "notch": b0 = 1; b1 = -2 * cs; b2 = 1; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; break;
      case "peaking": b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; break;
      case "lowshelf": { const r = 2 * Math.sqrt(A) * al; b0 = A * (A + 1 - (A - 1) * cs + r); b1 = 2 * A * (A - 1 - (A + 1) * cs); b2 = A * (A + 1 - (A - 1) * cs - r); a0 = A + 1 + (A - 1) * cs + r; a1 = -2 * (A - 1 + (A + 1) * cs); a2 = A + 1 + (A - 1) * cs - r; break; }
      case "highshelf": { const r = 2 * Math.sqrt(A) * al; b0 = A * (A + 1 + (A - 1) * cs + r); b1 = -2 * A * (A - 1 + (A + 1) * cs); b2 = A * (A + 1 + (A - 1) * cs - r); a0 = A + 1 - (A - 1) * cs + r; a1 = 2 * (A - 1 - (A + 1) * cs); a2 = A + 1 - (A - 1) * cs - r; break; }
      default: throw new Error("Filtro desconocido: " + tipo);
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  /** Forma transpuesta directa II: estable y barata. */
  paso(x) { const y = this.b0 * x + this.z1; this.z1 = this.b1 * x - this.a1 * y + this.z2; this.z2 = this.b2 * x - this.a2 * y; return y; }
  procesar(arr) { for (let i = 0; i < arr.length; i++) arr[i] = this.paso(arr[i]); return arr; }
}

/** Resonador de dos polos (como en el sintetizador de Klatt): un formante de la voz con frecuencia y ancho de banda. */
export class Resonador {
  constructor(sr = SR) { this.sr = sr; this.y1 = this.y2 = 0; this.A = 1; this.B = this.C = 0; }
  ajustar(hz, ancho) {
    const T = 1 / this.sr; this.C = -Math.exp(-2 * Math.PI * ancho * T); this.B = 2 * Math.exp(-Math.PI * ancho * T) * Math.cos(2 * Math.PI * hz * T); this.A = 1 - this.B - this.C;
  }
  paso(x) { const y = this.A * x + this.B * this.y1 + this.C * this.y2; this.y2 = this.y1; this.y1 = y; return y; }
}

/** Antirresonador (cero de dos polos): el "hueco" que da el sonido nasal a m, n y ñ. */
export class Antirresonador {
  constructor(sr = SR) { this.sr = sr; this.x1 = this.x2 = 0; this.A = 1; this.B = this.C = 0; }
  ajustar(hz, ancho) {
    const T = 1 / this.sr, C = -Math.exp(-2 * Math.PI * ancho * T), B = 2 * Math.exp(-Math.PI * ancho * T) * Math.cos(2 * Math.PI * hz * T), A = 1 - B - C;
    this.A = 1 / A; this.B = -B / A; this.C = -C / A;
  }
  paso(x) { const y = this.A * x + this.B * this.x1 + this.C * this.x2; this.x2 = this.x1; this.x1 = x; return y; }
}

/** Reverb de sala (estructura Freeverb: 8 filtros peine con amortiguación + 4 pasa-todo por canal). */
export function reverb(L, R, { sala = 0.82, brillo = 0.35, mezcla = 0.25, ancho = 1, sr = SR } = {}) {
  const k = sr / 44100, peines = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((n) => Math.round(n * k)), pasa = [556, 441, 341, 225].map((n) => Math.round(n * k)), sep = Math.round(23 * k);
  const sale = (entrada, extra) => {
    const out = new Float32Array(entrada.length);
    for (const largo of peines) {
      const b = new Float32Array(largo + extra); let i = 0, filtro = 0;
      for (let n = 0; n < entrada.length; n++) { const y = b[i]; filtro = y * (1 - brillo) + filtro * brillo; b[i] = entrada[n] * 0.015 + filtro * sala; out[n] += y; if (++i >= b.length) i = 0; }
    }
    for (const largo of pasa) {
      const b = new Float32Array(largo + extra); let i = 0;
      for (let n = 0; n < out.length; n++) { const y = b[i], x = out[n]; b[i] = x + y * 0.5; out[n] = y - x; if (++i >= b.length) i = 0; }
    }
    return out;
  };
  const mono = new Float32Array(L.length); for (let n = 0; n < L.length; n++) mono[n] = (L[n] + R[n]) * 0.5;
  const wL = sale(mono, 0), wR = sale(mono, sep), a = (1 + ancho) / 2, b = (1 - ancho) / 2;
  for (let n = 0; n < L.length; n++) { const l = wL[n] * a + wR[n] * b, r = wR[n] * a + wL[n] * b; L[n] = L[n] * (1 - mezcla * 0.5) + l * mezcla; R[n] = R[n] * (1 - mezcla * 0.5) + r * mezcla; }
}

/** Compresor estéreo con detector de envolvente. umbral en dB, ratio n:1, tiempos en segundos. */
export function comprimir(L, R, { umbral = -18, ratio = 3, ataque = 0.01, suelta = 0.15, ganancia = 0, sr = SR } = {}) {
  const at = Math.exp(-1 / (ataque * sr)), su = Math.exp(-1 / (suelta * sr)), mk = dbAGanancia(ganancia); let env = 0;
  for (let n = 0; n < L.length; n++) {
    const x = Math.max(Math.abs(L[n]), Math.abs(R[n])); env = x > env ? at * env + (1 - at) * x : su * env + (1 - su) * x;
    const db = 20 * Math.log10(env + 1e-9), red = db > umbral ? (umbral - db) * (1 - 1 / ratio) : 0, g = dbAGanancia(red) * mk;
    L[n] *= g; R[n] *= g;
  }
}

/** Limitador con mirada adelante: nunca deja pasar picos por encima del techo (dB). */
export function limitar(L, R, { techo = -1, mirada = 0.004, suelta = 0.08, sr = SR } = {}) {
  const lim = dbAGanancia(techo), m = Math.max(1, Math.round(mirada * sr)), su = Math.exp(-1 / (suelta * sr)), n = L.length;
  const necesaria = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = Math.max(Math.abs(L[i]), Math.abs(R[i])); necesaria[i] = p > lim ? lim / p : 1; }
  // mínimo en una ventana hacia adelante, para bajar la ganancia antes de que llegue el pico
  const min = new Float32Array(n), cola = [];
  for (let i = n - 1; i >= 0; i--) {
    while (cola.length && necesaria[cola[cola.length - 1]] >= necesaria[i]) cola.pop();
    cola.push(i); while (cola[0] > i + m) cola.shift();
    min[i] = necesaria[cola[0]];
  }
  let g = 1;
  for (let i = 0; i < n; i++) { g = min[i] < g ? min[i] : su * g + (1 - su) * min[i]; L[i] *= g; R[i] *= g; }
}

/** Pico máximo de un par de canales. */
export const pico = (L, R) => { let p = 0; for (let i = 0; i < L.length; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i])); return p; };
export function normalizar(L, R, objetivo = 0.89) { const p = pico(L, R); if (p > 0) { const k = objetivo / p; for (let i = 0; i < L.length; i++) { L[i] *= k; R[i] *= k; } } }

/** Convierte dos Float32Array en un AudioBuffer del navegador. */
export function aBuffer(ac, L, R, sr = SR) { const b = ac.createBuffer(2, L.length, sr); b.copyToChannel(L, 0); b.copyToChannel(R, 1); return b; }

/** Pausa breve para no congelar la página durante cálculos largos. */
export const respirar = () => new Promise((ok) => setTimeout(ok, 0));
