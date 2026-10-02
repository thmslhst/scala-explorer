// What a scale is, at a glance: its period, how it is written, its prime limit,
// its step sizes, whether it is (or sits inside) an equal division. Pure, so it
// runs anywhere.
//
// Nothing assumes a 1200-cent period, or that the file is sorted.

import type { Scale } from './scl';

export interface Facts {
  count: number;                        // pitches in the file (the period included)
  periodCents: number;
  periodRatio?: [number, number];
  periodName?: string;                  // "octave", "tritave", … when it has one
  written: 'ratios' | 'cents' | 'mixed';
  primeLimit?: number;                  // ratios only; undefined if some ratio is too big to factor
  steps: number[];                      // between consecutive degrees in pitch order, the last one closing on the period
  stepSizes: number;                    // distinct step sizes, to 0.01¢
  equal?: { divisions: number; subset: boolean }; // every degree on an equal division of the period
  descents: number;                     // lines lower than the one before (0 = written in ascending order)
}

const EQUAL_TOLERANCE = 0.01; // cents
const MAX_DIVISIONS   = 400;

const PERIOD_NAMES: Record<string, string> = {
  '2/1': 'octave',
  '3/1': 'tritave',
  '3/2': 'fifth',
  '4/1': 'two octaves',
  '5/1': 'fifth harmonic',
  '4/3': 'fourth',
};

// ─── Primes ──────────────────────────────────────────────────────────────────
const SMALL_PRIMES = (() => {
  const LIMIT = 10_000;
  const sieve = new Uint8Array(LIMIT + 1);
  const primes: number[] = [];
  for (let i = 2; i <= LIMIT; i++) {
    if (sieve[i]) continue;
    primes.push(i);
    for (let j = i * i; j <= LIMIT; j += i) sieve[j] = 1;
  }
  return primes;
})();

/** Largest prime factor, or undefined past what can be factored quickly and exactly. */
function largestPrime(x: number): number | undefined {
  if (!Number.isSafeInteger(x)) return undefined;
  let largest = 1;
  for (const p of SMALL_PRIMES) {
    if (p * p > x) break;
    if (x % p) continue;
    largest = p;
    while (x % p === 0) x /= p;
  }
  if (x === 1) return largest;
  // No factor up to 10⁴ left, so anything below 10⁸ is prime.
  return x < 1e8 ? Math.max(largest, x) : undefined;
}

// ─── Facts ───────────────────────────────────────────────────────────────────
export function scaleFacts(scale: Scale): Facts {
  const { pitches } = scale;
  const last = pitches[pitches.length - 1];
  const periodCents = last && last.cents > 0 ? last.cents : 1200;
  const periodRatio = last && last.cents > 0 ? last.ratio : undefined;
  const periodName = periodRatio
    ? PERIOD_NAMES[`${periodRatio[0]}/${periodRatio[1]}`]
    : Math.abs(periodCents - 1200) < 1e-6 ? 'octave' : undefined;

  const ratios = pitches.filter(p => p.ratio).length;
  const written = ratios === pitches.length ? 'ratios' : ratios === 0 ? 'cents' : 'mixed';

  let primeLimit: number | undefined;
  if (written === 'ratios') {
    primeLimit = 1;
    for (const { ratio: [n, d] } of pitches as Required<(typeof pitches)[number]>[]) {
      const pn = largestPrime(n);
      const pd = largestPrime(d);
      if (pn === undefined || pd === undefined) { primeLimit = undefined; break; }
      primeLimit = Math.max(primeLimit, pn, pd);
    }
  }

  // Degrees within one period, in pitch order.
  const degrees = [0, ...pitches.slice(0, -1).map(p => ((p.cents % periodCents) + periodCents) % periodCents)]
    .sort((a, b) => a - b);
  const steps = degrees.map((c, i) => (degrees[i + 1] ?? periodCents) - c);
  const stepSizes = new Set(steps.map(s => s.toFixed(2))).size;

  // Only a scale with some cents in it can sit exactly on an equal division:
  // no ratio but the period itself lands on one.
  let equal: Facts['equal'];
  if (written !== 'ratios' && degrees.length > 1) {
    for (let m = degrees.length; m <= MAX_DIVISIONS; m++) {
      const step = periodCents / m;
      if (degrees.every(c => Math.abs(c - Math.round(c / step) * step) < EQUAL_TOLERANCE)) {
        equal = { divisions: m, subset: m !== degrees.length };
        break;
      }
    }
  }

  let descents = 0;
  for (let i = 1; i < pitches.length; i++) if (pitches[i].cents < pitches[i - 1].cents) descents++;

  return {
    count: pitches.length,
    periodCents,
    periodRatio,
    periodName,
    written,
    primeLimit,
    steps,
    stepSizes,
    equal,
    descents,
  };
}
