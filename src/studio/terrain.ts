export const TILE = 16;

const SEED = 1337;

export type Terrain = 'deep' | 'water' | 'sand' | 'grass' | 'meadow' | 'forest' | 'dirt';

function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm(x: number, y: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq, seed + i * 101) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export function terrainAt(tx: number, ty: number): Terrain {
  const originBoost = Math.max(0, 1 - Math.hypot(tx, ty) / 40) * 0.25;
  const elev = fbm(tx / 48, ty / 48, 4, SEED) + originBoost;
  if (elev < 0.3) return 'deep';
  if (elev < 0.36) return 'water';
  if (elev < 0.39) return 'sand';
  if (Math.abs(fbm(tx / 70, ty / 70, 3, SEED + 777) - 0.5) < 0.012) return 'dirt';
  const moist = fbm(tx / 32, ty / 32, 3, SEED + 4242);
  if (moist > 0.58) return 'forest';
  if (moist < 0.4) return 'meadow';
  return 'grass';
}
