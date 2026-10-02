// The only place a graph is drawn. Returns self-contained SVG markup: the
// reveal is CSS keyframes inside the SVG's own <style>, so there is no state
// and nothing to hydrate — mounting the markup plays it, remounting replays it.
//
// Ink is currentColor; the page decides the colour.

import { FLOOR, revealSchedule, type Graph, type Reveal } from './graph';

// ─── Look ────────────────────────────────────────────────────────────────────
const R       = 100;   // unit circle → SVG units
const PAD     = 16;
const EASE    = 'cubic-bezier(.65,0,.35,1)'; // the lurch between vertices
const SPOKE_0 = 0.1;   // spokes start this far out, so they don't pile up at the centre

const STYLE = `
.sg{display:block;width:100%;height:100%;overflow:visible}
.sg .f{animation:sg-fade .5s ease-out both}
.sg .rim{fill:none;stroke:currentColor;stroke-opacity:.35;stroke-width:.6}
.sg .floor{fill:none;stroke:currentColor;stroke-opacity:.3;stroke-width:.5;stroke-dasharray:1.5 2.5}
.sg .tick{stroke:currentColor;stroke-width:.8}
.sg .s{stroke:currentColor;stroke-opacity:.16;stroke-width:.5;animation:sg-fade .4s ease-out both}
.sg .fill{fill:currentColor;fill-opacity:0;animation:sg-fill 1.2s ease-out both}
.sg .o{fill:none;stroke:currentColor;stroke-width:1.1;stroke-linejoin:round}
.sg .v{fill:currentColor;transform-box:fill-box;transform-origin:center;animation:sg-pop .28s cubic-bezier(.2,.8,.3,1.4) both}
.sg .v.a{fill-opacity:.45}
@keyframes sg-fade{from{opacity:0}to{opacity:1}}
@keyframes sg-fill{to{fill-opacity:.07}}
@keyframes sg-pop{from{opacity:0;transform:scale(2.4)}to{opacity:1;transform:scale(1)}}
@media (prefers-reduced-motion:reduce){.sg *{animation:none!important;stroke-dashoffset:0!important}.sg .fill{fill-opacity:.07}}
`;

const n = (v: number) => +v.toFixed(2);
const pct = (t: number, total: number) => `${+((t / total) * 100).toFixed(3)}%`;
// Readable slug plus a hash of the exact name, so "a_b" and "a-b" can't share keyframes.
const slug = (name: string) => {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${(h >>> 0).toString(36)}`;
};
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Stall on each vertex, then lurch to the next. */
function drawKeyframes(id: string, graph: Graph, reveal: Reveal, L: number): string {
  const { arrivals, lurches, total } = reveal;
  const f = graph.fractions;
  const off = (fr: number) => n(L * (1 - fr));
  const frames = [`0%{stroke-dashoffset:${off(0)}}`, `${pct(arrivals[0], total)}{stroke-dashoffset:${off(0)}}`];
  for (let i = 1; i < arrivals.length; i++) {
    const start = arrivals[i] - lurches[i];
    frames.push(`${pct(start, total)}{stroke-dashoffset:${off(f[i - 1])};animation-timing-function:${EASE}}`);
    frames.push(`${pct(arrivals[i], total)}{stroke-dashoffset:${off(f[i])}}`);
  }
  return `@keyframes ${id}-draw{${frames.join('')}}`;
}

export function renderGraphSvg(graph: Graph, reveal: Reveal = revealSchedule(graph)): string {
  const id = `sg-${slug(graph.name)}`;
  const v = graph.vertices;
  const L = graph.length * R;
  const ms = (t: number) => `${Math.round(t)}ms`;

  const outline = v.length > 1
    ? `M${v.map(p => `${n(p.x * R)} ${n(p.y * R)}`).join('L')}Z`
    : '';

  const spokes = v.map((p, i) => {
    const k = SPOKE_0 / p.radius;
    return `<line class="s" x1="${n(p.x * R * k)}" y1="${n(p.y * R * k)}" x2="${n(p.x * R)}" y2="${n(p.y * R)}" style="animation-delay:${ms(reveal.arrivals[i])}"/>`;
  }).join('');

  const dots = v.map((p, i) =>
    `<circle class="v ${p.exact ? 'x' : 'a'}" cx="${n(p.x * R)}" cy="${n(p.y * R)}" r="${p.exact ? 2.6 : 2.1}" style="animation-delay:${ms(reveal.arrivals[i])}"><title>${p.ratio[0]}/${p.ratio[1]} · ${p.cents.toFixed(1)}¢</title></circle>`,
  ).join('');

  // STYLE is repeated in every graph on the page, so per-graph rules need the
  // extra class to outrank a later copy of it.
  const css = STYLE
    + `.sg.${id} .o{stroke-dasharray:${n(L + 1)} ${n(L + 1)};stroke-dashoffset:${n(L)};animation:${id}-draw ${ms(reveal.total)} linear both}`
    + `.sg.${id} .fill{animation-delay:${ms(reveal.total)}}`
    + drawKeyframes(id, graph, reveal, L);

  const box = R + PAD;
  return `<svg class="sg ${id}" viewBox="${-box} ${-box} ${box * 2} ${box * 2}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(graph.description || graph.name)}">`
    + `<style>${css}</style>`
    + `<g class="f"><circle class="rim" r="${R}"/><circle class="floor" r="${FLOOR * R}"/><line class="tick" x1="0" y1="${-R}" x2="0" y2="${-R - 9}"/></g>`
    + `<g>${spokes}</g>`
    + (outline ? `<path class="fill" d="${outline}"/><path class="o" d="${outline}"/>` : '')
    + `<g>${dots}</g>`
    + `</svg>`;
}

/**
 * Marks laid over a graph drawn by renderGraphSvg (same box, so the two stack
 * exactly): the given vertices are ringed and spoked, and joined when there are
 * several — a chord drawn inside the scale.
 */
export function renderMarksSvg(graph: Graph, indices: number[]): string {
  const v = Array.from(new Set(indices)).sort((a, b) => a - b).map(i => graph.vertices[i]).filter(Boolean);
  const pt = (p: (typeof v)[number]) => `${n(p.x * R)} ${n(p.y * R)}`;
  const chord = v.length > 1
    ? `<path d="M${v.map(pt).join('L')}${v.length > 2 ? 'Z' : ''}" fill="currentColor" fill-opacity=".12" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`
    : '';
  const marks = v.map(p =>
    `<line x1="0" y1="0" x2="${n(p.x * R)}" y2="${n(p.y * R)}" stroke="currentColor" stroke-width=".9"/>`
    + `<circle cx="${n(p.x * R)}" cy="${n(p.y * R)}" r="6" fill="none" stroke="currentColor" stroke-width="1.4"/>`,
  ).join('');
  const box = R + PAD;
  return `<svg viewBox="${-box} ${-box} ${box * 2} ${box * 2}" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:100%;overflow:visible" aria-hidden="true">`
    + chord + marks
    + `</svg>`;
}
