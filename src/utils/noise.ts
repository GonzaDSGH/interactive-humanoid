/** Cheap deterministic value-noise (sum of sines) — good enough for CPU-side
 *  procedural displacement where a full simplex implementation is overkill. */
export function valueNoise1D(x: number, seed = 0): number {
  const a = Math.sin(x * 1.7 + seed * 12.9898) * 43758.5453;
  const b = Math.sin(x * 0.63 + seed * 78.233 + 13.1) * 12543.117;
  const c = Math.sin(x * 3.11 + seed * 3.7 + 5.9) * 9351.99;
  return (frac(a) + frac(b) * 0.6 + frac(c) * 0.3) / 1.9 - 0.5;
}

function frac(v: number): number {
  return v - Math.floor(v);
}

export function fbmNoise1D(x: number, octaves = 4, seed = 0): number {
  let total = 0;
  let amp = 0.5;
  let freq = 1.0;
  for (let i = 0; i < octaves; i++) {
    total += valueNoise1D(x * freq, seed + i * 17.13) * amp;
    amp *= 0.55;
    freq *= 2.05;
  }
  return total;
}
