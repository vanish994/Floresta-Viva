/**
 * Núcleo determinístico: hashes estáveis por coordenada + ruído coerente.
 *
 * Regra de ouro do projeto: nada depende do estado de um RNG global que avança
 * conforme chunks são carregados. Todo valor aleatório do mundo é uma função
 * pura de (seed, coordenadas globais, fluxo/sistema, propósito).
 */

/** Mistura inteira 32 bits (hash finalizer estilo xxhash/murmur). */
export function mix32(h: number): number {
  h |= 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  h ^= h >>> 15;
  return h >>> 0;
}

/** Hash determinístico de (seed, x, y, canal). Sempre o mesmo para as mesmas entradas. */
export function hash2(seed: number, x: number, y: number, channel = 0): number {
  let h = seed | 0;
  h = Math.imul(h ^ (x | 0), 0x27d4eb2d);
  h = Math.imul(h ^ (y | 0), 0x165667b1);
  h = Math.imul(h ^ (channel | 0), 0x9e3779b1);
  return mix32(h) / 4294967296; // [0,1)
}

/** Hash 1D de chave inteira (ex.: id de entidade, índice de chunk). */
export function hash1(seed: number, key: number, channel = 0): number {
  let h = seed | 0;
  h = Math.imul(h ^ (key | 0), 0x27d4eb2d);
  h = Math.imul(h ^ (channel | 0), 0x85ebca6b);
  return mix32(h) / 4294967296;
}

/** Converte uma string (seed digitada pelo jogador) em inteiro estável. */
export function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return mix32(h) | 0;
}

/** RNG local (mulberry32) — usado apenas para processos explicitamente locais (partículas de UI etc.). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PERM_SIZE = 256;

/**
 * Ruído de valor coerente 2D/3D com permutação derivada da seed.
 * Contínuo, determinístico e independente de ordem de avaliação.
 */
export class ValueNoise {
  private perm: Uint8Array;

  constructor(seed: number) {
    const p = new Uint8Array(PERM_SIZE * 2);
    const base = new Uint8Array(PERM_SIZE);
    for (let i = 0; i < PERM_SIZE; i++) base[i] = i;
    // Fisher-Yates com hash determinístico (não usa RNG estado-dependente)
    for (let i = PERM_SIZE - 1; i > 0; i--) {
      const j = Math.floor(hash1(seed, i, 777) * (i + 1));
      const t = base[i];
      base[i] = base[j];
      base[j] = t;
    }
    for (let i = 0; i < PERM_SIZE * 2; i++) p[i] = base[i & 255];
    this.perm = p;
  }

  private grad(ix: number, iy: number, iz: number): number {
    const p = this.perm;
    return p[(p[(p[ix & 255] + iy) & 255] + iz) & 255] / 127.5 - 1;
  }

  noise2(x: number, y: number, z = 0): number {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = this.grad(x0, y0, z);
    const b = this.grad(x0 + 1, y0, z);
    const c = this.grad(x0, y0 + 1, z);
    const d = this.grad(x0 + 1, y0 + 1, z);
    const ab = a + (b - a) * ux;
    const cd = c + (d - c) * ux;
    return ab + (cd - ab) * uy; // ~[-1,1]
  }

  /** fbm 2D: soma de oitavas com ganho/lacunidade configuráveis. */
  fbm2(x: number, y: number, octaves: number, gain = 0.5, lacunarity = 2, z = 0): number {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise2(x * freq, y * freq, z);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /** ruído "ridge" (cristas) — útil para cadeias de montanhas e trilhas sinuosas. */
  ridge2(x: number, y: number, octaves: number, z = 0): number {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(this.noise2(x * freq, y * freq, z));
      sum += amp * n * n;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm; // [0,1]
  }
}

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
