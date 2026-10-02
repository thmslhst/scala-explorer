# Scala explorer

Browse the [Scala archive](https://www.huygens-fokker.org/scala/) of tunings —
5,233 `.scl` files. Each one is shown as a radial graph, a list of facts, a
table of degrees, and a keyboard to play it on (mouse, computer keys, or a MIDI
controller).

Live: <https://scala-explorer.lab.thmslhst.com>

## Run it

```bash
pnpm install
pnpm dev
```

`pnpm build` writes a static site to `dist/` (`pnpm preview` serves it).

## How it works

Everything runs in the browser. The build bundles an index of the archive
(name, description, size of every file); the scale you pick is fetched from
`/scales/<file>`, then parsed, graphed and analysed on the spot. The choice is
in the URL (`?scale=<name>`), so a scale can be linked to.

## Licence

MIT — see [LICENSE](LICENSE). The scale files in `public/scales` come from the
Scala archive by Manuel Op de Coul and its contributors.
