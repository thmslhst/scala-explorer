// Scale → polar geometry, and the reveal schedule.
//
// The circle is one period. Each degree is a vertex: its angle is where it
// falls in the period (0 at 12 o'clock, clockwise), its radius is harmonic
// simplicity — Tenney height log2(n·d) of the degree's ratio. Simple ratios
// reach the rim, complex ones sink toward the floor circle.

import { gcd, ratioCents, type Scale } from './scl';

// ─── Tuning ─────────────────────────────────────────────────────────────────
export const RIM          = 1;     // radius of 1/1
export const FLOOR        = 0.34;  // most complex ratios bottom out here
export const HEIGHT_SCALE = 20;    // radius = 1 - height / HEIGHT_SCALE → 3/2 at 0.87
export const MATCH_CENTS  = 14;    // cents degrees snap to the simplest ratio this close
const MAX_DENOMINATOR     = 128;

export const REVEAL_MIN = 2200;    // ms, how long a graph takes to draw itself
export const REVEAL_MAX = 4800;

// ─── Types ───────────────────────────────────────────────────────────────────
export interface Vertex {
  cents: number;            // within the period
  ratio: [number, number];  // spelled by the file, or the nearby match
  exact: boolean;           // true when the file wrote a ratio
  height: number;           // Tenney height
  angle: number;            // radians, 0 = 12 o'clock, clockwise
  radius: number;           // FLOOR..RIM
  x: number;                // unit circle, y down
  y: number;
}

export interface Graph {
  name: string;
  description: string;
  periodCents: number;
  periodRatio?: [number, number];
  vertices: Vertex[];       // sorted by angle, vertices[0] is the 1/1
  fractions: number[];      // outline length drawn on arriving at each vertex; last = 1 (closed)
  length: number;           // outline perimeter in unit-circle units
}

// ─── Ratios ──────────────────────────────────────────────────────────────────
export const tenney = ([n, d]: [number, number]) => Math.log2(n * d);

/** Simplest ratio (lowest Tenney height) within MATCH_CENTS, else the nearest one. */
export function simplestRatio(cents: number): [number, number] {
  const target = Math.pow(2, cents / 1200);
  let best: [number, number] | null = null;
  let bestH = Infinity;
  let nearest: [number, number] = [1, 1];
  let nearestErr = Infinity;

  for (let d = 1; d <= MAX_DENOMINATOR; d++) {
    const n = Math.round(d * target);
    if (n < 1) continue;
    const g = gcd(n, d);
    const r: [number, number] = [n / g, d / g];
    const err = Math.abs(ratioCents(n, d) - cents);
    if (err < nearestErr) { nearestErr = err; nearest = r; }
    if (err <= MATCH_CENTS) {
      const h = tenney(r);
      if (h < bestH) { bestH = h; best = r; }
    }
  }
  return best ?? nearest;
}

const radiusFor = (height: number) => Math.max(FLOOR, RIM - height / HEIGHT_SCALE);

// ─── Geometry ────────────────────────────────────────────────────────────────
export function toGraph(scale: Scale): Graph {
  const last = scale.pitches[scale.pitches.length - 1];
  const periodCents = last && last.cents > 0 ? last.cents : 1200;
  const periodRatio = last && last.cents > 0 ? last.ratio : undefined;

  const degrees = [
    { cents: 0, ratio: [1, 1] as [number, number] },
    ...scale.pitches.slice(0, -1).map(p => ({
      cents: ((p.cents % periodCents) + periodCents) % periodCents,
      ratio: p.ratio,
    })),
  ];

  const seen = new Set<string>();
  const vertices: Vertex[] = [];
  for (const deg of degrees) {
    const key = deg.cents.toFixed(4);
    if (seen.has(key)) continue;
    seen.add(key);

    const ratio  = deg.ratio ?? simplestRatio(deg.cents);
    const height = tenney(ratio);
    const radius = radiusFor(height);
    const angle  = (deg.cents / periodCents) * Math.PI * 2;
    vertices.push({
      cents: deg.cents,
      ratio,
      exact: !!deg.ratio,
      height,
      angle,
      radius,
      x: radius * Math.sin(angle),
      y: -radius * Math.cos(angle),
    });
  }
  vertices.sort((a, b) => a.angle - b.angle);

  // Cumulative outline length, closing back on the 1/1.
  const cumulative = [0];
  for (let i = 1; i <= vertices.length; i++) {
    const a = vertices[i - 1];
    const b = vertices[i % vertices.length];
    cumulative.push(cumulative[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const length = cumulative[cumulative.length - 1];
  const fractions = cumulative.map((c, i) =>
    length > 0 ? c / length : i / Math.max(1, vertices.length),
  );

  return {
    name: scale.name,
    description: scale.description,
    periodCents,
    periodRatio,
    vertices,
    fractions,
    length,
  };
}

// ─── Reveal schedule ─────────────────────────────────────────────────────────
// Degrees arrive one by one on a jittered clock: the outline stalls on a
// vertex, then lurches to the next. Seeded from the scale name, so a scale
// always stutters in the same places.

export interface Reveal {
  total: number;       // ms until the outline closes
  arrivals: number[];  // ms at which vertex i lands; arrivals[n] closes the loop
  lurches: number[];   // ms spent travelling into arrival i (arrivals[0] has none)
}

function seeded(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let s = h >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function revealSchedule(graph: Graph): Reveal {
  const rand  = seeded(graph.name);
  const steps = graph.vertices.length; // n vertices → n moves, the last one closes
  const total = REVEAL_MIN + rand() * (REVEAL_MAX - REVEAL_MIN);
  const lead  = 150 + rand() * 250;

  // Mostly quick steps, with the occasional long stall.
  const weights = Array.from({ length: steps }, () => {
    const u = rand();
    return rand() < 0.18 ? 2.5 + 4 * u : 0.25 + u;
  });
  const sum = weights.reduce((a, b) => a + b, 0);

  const arrivals = [lead];
  const lurches  = [0];
  for (const w of weights) {
    const gap = (w / sum) * (total - lead);
    arrivals.push(arrivals[arrivals.length - 1] + gap);
    lurches.push(Math.min(gap * 0.6, 70 + rand() * 110));
  }
  return { total, arrivals, lurches };
}
