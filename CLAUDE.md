## What this is

Scala Explorer: a browser for the Scala archive of tunings (`.scl` files). One
file at a time, with its radial graph, its facts, a table of degrees and a
keyboard to play it on. Extracted from thmslhst.com; one of the tools listed on
its lab page. Public, MIT.

Vite + React + TypeScript (strict) + Tailwind v4, pnpm. `pnpm dev`,
`pnpm build` (typechecks, then builds `dist/`), `pnpm preview`.

## Conventions

- `base: "/"` — the tool is served at the root of its own subdomain.
- Pure, reusable logic (ratios, cents, parsing, mapping…) lives in
  `src/lib/scala` with no React or DOM imports. It is meant to move to the npm
  package `@thmslhst/microtonal-core`; keep it that clean.
- GitHub repo metadata: topic `thmslhst-lab`, a short description, `homepage`
  set to the live URL.
- Two colours only, as CSS variables in `src/index.css`: `--ink` and `--paper`.
  Flat, 1px hairlines, system monospace (`font-mono`), highlight = inversion
  (ink background, paper text). The graph's ink is `currentColor`.

## Files

Format reference: https://www.huygens-fokker.org/scala/scl_format.html

| | |
|---|---|
| `src/lib/scala/scl.ts` | `.scl` parser; each pitch keeps the index of its line in the file |
| `src/lib/scala/graph.ts` | scale → polar geometry, and the reveal schedule |
| `src/lib/scala/svg.ts` | **the only place a graph is drawn** — returns SVG markup (plus `renderMarksSvg`, an overlay ringing chosen vertices) |
| `src/lib/scala/facts.ts` | scale → period, how it's written, prime limit, step sizes, equal-division fit, order |
| `src/lib/scala/mapping.ts` | scale → MIDI keys: `linear` (Scala's default) or `nearest` (piano layout kept) |
| `src/lib/scala/entry.ts` | the `ScaleEntry` tuple type |
| `scale-index.ts` | Vite plugin providing `virtual:scale-index` (Node only, runs at dev start / build) |
| `src/components/ScalaExplorer.tsx` | the explorer: windowed search list, graph, facts, degree table / raw file, keyboard |
| `src/components/ScalaGraph.tsx` | thin React wrapper over `svg.ts` |
| `src/components/ScalaKeyboard.tsx` | piano keys labelled with the degree each plays; pointer input only |
| `src/components/synth.ts` | tiny Web Audio synth (8 harmonics, so just intervals lock) |
| `src/App.tsx` | passes the index to `ScalaExplorer` |

### The scale library

`public/scales/` is the whole Scala archive — 5,233 `.scl` files (plus the
archive's `scalesdir.txt` index and `complimit.lst`). All of them parse. They
are ASCII except ~100 Latin-1 files, so everything is decoded as Latin-1.

**Never parse or render the whole folder in the browser.** The one place that
parses all of it is `scale-index.ts`, at build time (~0.6 s). Rendering it all
would be ~40 MB of SVG.

The range is wide: median 12 degrees, 90th percentile 31, max 569; 247 scales
exceed 43 degrees and 780 have a non-octave period.

## The explorer

The bundle carries only the index (~5k `[file, description, count]`
tuples, from `virtual:scale-index`); the chosen file is fetched from
`/scales/<file>` and parsed, graphed and analysed in the browser — everything in
`src/lib/scala` is pure TypeScript, no React, no DOM. The choice is in the URL
(`?scale=<name>`); an unknown or missing one picks a random file.

Playing: mouse/touch on the keys (slides across them), computer keys by
physical position (`a w s e d…` from the 1/1, `z`/`x` shift a period, `/`
focuses search, arrows browse), a MIDI controller after clicking "MIDI", or
pressing a row of the degree table. Whatever sounds — or is hovered — is lit on
the keys, the table, the file text, the period ruler and the graph (a chord is
drawn as a polygon). The 1/1's key and frequency are adjustable; changing the
key resets the frequency to that key's 12-TET pitch.

"equal" means every degree lies within 0.01¢ of a division of the period (up to
400 divisions), so it only fires for files written in cents; e.g. `12-31` reads
"12 of 31-EDO".

## The graph

A scale drawn as a radial graph, Read `svg.ts` first and
iterate on the look there.

### How a scale becomes a shape

The circle is one period of the scale. Each degree is a vertex:

- **angle** — where the degree falls in the period (0 at 12 o'clock, clockwise),
  normalized, so a 3/1-period scale still fills the circle.
- **radius** — harmonic simplicity. Every degree is identified with a ratio (the
  one the file spelled, or the simplest within 14 cents when the file gives
  cents) and scored by Tenney height, `log2(n*d)`: radius `= max(0.34, 1 − h/20)`.
  1/1 sits on the rim, 3/2 at 0.87, 243/128 on the floor circle.

Consonances become the star's points, so the outline is a fingerprint: 12-EDO is
a near-regular lump, Pythagorean a hard star, Partch's 43 tones a sunburst.
Solid vertices were written as ratios; faint ones were cents, matched to a
nearby ratio. A side effect of the 14-cent window: 12-EDO's minor third matches
13/11, since 6/5 is 15.6 cents away.

Many scales are non-octave (Bohlen-Pierce and friends) — do not assume a
1200-cent period anywhere.

### The reveal

The graph draws itself rather than appearing: degrees arrive on a jittered
schedule and the outline stalls and lurches between them, then the shape fills.
The jitter is seeded from the scale name, so a scale always stutters in the same
places and the markup is deterministic. Refreshing the page replays it;
remounting the component (a new `key`) does too.

It is pure CSS keyframes — no state, no effects, no `use client`, nothing to
hydrate. Keep it that way unless there is a reason not to.

Every graph carries the same shared `<style>` block, so a later copy on the page
overrides earlier ones at equal specificity. Per-graph rules are written as
`.sg.sg-<id>` to outrank it — keep that when adding per-graph CSS. The id is a
slug of the name plus a hash of the exact name, so near-identical file names
("a_b", "a-b") can't share keyframes.

## Open design questions

1. **Radius contrast is gentle** — 3/2 lands at 0.87, the floor is 0.34. Pushing
   the spread makes the stars more violent.
2. **Period size is normalized away** — Bohlen-Pierce's 1902-cent circle looks
   identical to 12-EDO's 1200. Could be encoded in ring weight, an arc gap, or
   the outer radius.
3. **Density above ~20 degrees** — Partch at 43 nearly fills in as a solid disc
   and may need thinning or a different treatment. The archive has 247 scales
   above 43 degrees, up to 569.
