// Small, dependency-free statistics for the harness: bootstrap CIs and tie-aware Spearman.
import { Rng } from '../../src/sim/rng';

export const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

/** Percentile bootstrap 95% CI of the mean. Deterministic (seeded). */
export function bootstrapCI(v: number[], reps = 2000, seed = 7): [number, number] {
  if (v.length < 2) return [mean(v), mean(v)];
  const rng = new Rng(seed);
  const means: number[] = [];
  for (let r = 0; r < reps; r++) {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[Math.floor(rng.next() * v.length)];
    means.push(s / v.length);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(reps * 0.025)], means[Math.floor(reps * 0.975)]];
}

/** Average ranks (ties share the mean rank). */
export function ranks(v: number[]): number[] {
  const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(v.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
}

/** Spearman's rho as the Pearson correlation of average ranks (correct with ties). */
export function spearman(a: number[], b: number[]): number {
  const ra = ranks(a);
  const rb = ranks(b);
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Paired bootstrap CI of mean(a - b). */
export function pairedDiffCI(a: number[], b: number[], reps = 2000, seed = 11): { mean: number; lo: number; hi: number } {
  const d = a.map((x, i) => x - b[i]);
  const [lo, hi] = bootstrapCI(d, reps, seed);
  return { mean: mean(d), lo, hi };
}
