import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import ScalaGraph from './ScalaGraph';
import ScalaKeyboard from './ScalaKeyboard';
import { allOff, noteOff, noteOn, unlockAudio } from './synth';
import type { ScaleEntry } from '@/lib/scala/entry';
import { parseScl, ratioCents, type Scale } from '@/lib/scala/scl';
import { simplestRatio, toGraph, type Graph } from '@/lib/scala/graph';
import { renderMarksSvg } from '@/lib/scala/svg';
import { scaleFacts, type Facts } from '@/lib/scala/facts';
import {
  DEFAULT_MAPPING, keyMapper, keyName, nearestTet, tetHz,
  type KeyPitch, type Mapping,
} from '@/lib/scala/mapping';

// Browse the whole archive: search on the left, the chosen file on the right —
// its graph, its facts, every degree, and a keyboard to play it on (mouse,
// computer keys, or a MIDI controller).
//
// The index is in the bundle (see scale-index.ts). The file itself is fetched from
// /scales/<file> and parsed here, so choosing one costs a single small request.
// The choice lives in the URL (?scale=<name>) so a scale can be linked to.

const KEYS_FROM = 36; // C2
const KEYS_TO = 96;   // C7
const ROW_H = 38;     // px, list row height (the list is windowed)

// Computer keys, by physical position (so AZERTY works too): a piano row from
// the 1/1 up, z/x shift it down/up.
const QWERTY = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL', 'KeyP', 'Semicolon'];

const stem = (file: string) => file.replace(/\.scl$/i, '');
const fmt = (x: number, digits = 2) => x.toFixed(digits).replace('-', '−');
const signed = (x: number, digits = 1) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(digits)}`;

interface Loaded {
  file: string;
  lines: string[];
  scale: Scale;
  graph: Graph;
  facts: Facts;
  vertexOf: number[]; // degree → graph vertex
}

function load(file: string, text: string): Loaded {
  const scale = parseScl(text, stem(file));
  const graph = toGraph(scale);
  const period = graph.periodCents;
  const vertexOf = [0, ...scale.pitches.slice(0, -1).map(p => p.cents)].map(c => {
    const within = ((c % period) + period) % period;
    return graph.vertices.findIndex(v => Math.abs(v.cents - within) < 1e-3);
  });
  return { file, lines: text.split(/\r?\n/), scale, graph, facts: scaleFacts(scale), vertexOf };
}

export default function ScalaExplorer({ index }: { index: ScaleEntry[] }) {
  // ─── Choosing ──────────────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const haystacks = useMemo(() => index.map(([file, desc]) => `${file} ${desc}`.toLowerCase()), [index]);
  const results = useMemo(() => {
    const terms = deferredQuery.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return index;
    return index.filter((_, i) => terms.every(t => haystacks[i].includes(t)));
  }, [index, haystacks, deferredQuery]);

  const [file, setFile] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = useCallback((next: string) => {
    setFile(next);
    history.replaceState(null, '', `?scale=${encodeURIComponent(stem(next))}`);
  }, []);

  // First visit: the scale in the URL, else a random one.
  useEffect(() => {
    const wanted = new URLSearchParams(location.search).get('scale');
    const found = wanted && index.find(([f]) => stem(f) === wanted);
    const first = found ? found[0] : index[Math.floor(Math.random() * index.length)]?.[0];
    if (first) choose(first);
  }, [index, choose]);

  useEffect(() => {
    if (!file) return;
    let stale = false;
    fetch(`/scales/${encodeURIComponent(file)}`)
      .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status} ${r.statusText}`))))
      .then(buf => {
        if (stale) return;
        // The archive is ASCII plus a few Latin-1 files; Latin-1 decodes both.
        setLoaded(load(file, new TextDecoder('latin1').decode(buf)));
        setError(null);
      })
      .catch(err => !stale && setError(`${file}: ${(err as Error).message}`));
    return () => { stale = true; };
  }, [file]);

  const move = useCallback((by: number) => {
    if (!results.length) return;
    const at = results.findIndex(([f]) => f === file);
    const next = at < 0 ? 0 : Math.min(results.length - 1, Math.max(0, at + by));
    choose(results[next][0]);
  }, [results, file, choose]);

  // ─── Playing ───────────────────────────────────────────────────────────────
  const [mapping, setMapping] = useState<Mapping>(DEFAULT_MAPPING);
  const pitchOf = useMemo(
    () => (loaded ? keyMapper(loaded.scale, mapping) : () => null),
    [loaded, mapping],
  );
  const pitchRef = useRef(pitchOf);
  pitchRef.current = pitchOf;

  // Everything holding a key down, by source ("p1" a pointer, "q:KeyA" a
  // computer key, "m:60" MIDI), so one letting go doesn't silence another.
  const [held, setHeld] = useState<Map<string, number>>(new Map());
  const [hoverKey, setHoverKey] = useState<number | null>(null);
  const [lastKey, setLastKey] = useState<number | null>(null);
  const [row, setRow] = useState<number | null>(null); // table row hovered or held

  const press = useCallback((source: string, key: number, velocity = 0.8) => {
    const p = pitchRef.current(key);
    if (!p) return;
    noteOn(source, p.hz, velocity);
    setHeld(h => new Map(h).set(source, key));
    setLastKey(key);
  }, []);
  const release = useCallback((source: string) => {
    noteOff(source);
    setHeld(h => {
      if (!h.has(source)) return h;
      const next = new Map(h);
      next.delete(source);
      return next;
    });
  }, []);

  // A new scale starts from silence.
  useEffect(() => {
    allOff();
    setHeld(new Map());
    setRow(null);
  }, [loaded]);

  // Computer keys: play, z/x shift, arrows browse.
  const [shift, setShift] = useState(0);
  const shiftRef = useRef(shift);
  shiftRef.current = shift;
  const moveRef = useRef(move);
  moveRef.current = move;
  const mappingRef = useRef(mapping);
  mappingRef.current = mapping;
  // z/x move by a period's worth of keys.
  const periodKeys = mapping.mode === 'linear' ? loaded?.scale.pitches.length || 12 : 12;
  const periodRef = useRef(periodKeys);
  periodRef.current = periodKeys;

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const field = e.target instanceof HTMLElement ? e.target.closest('input, select, textarea') : null;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        // Arrows browse the list, from anywhere but another field.
        if (field && !field.matches('[data-browse]')) return;
        e.preventDefault();
        moveRef.current(e.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (field || e.repeat) return;
      if (e.key === '/') {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('[data-browse]')?.focus();
        return;
      }
      if (e.code === 'KeyZ') return setShift(s => s - 1);
      if (e.code === 'KeyX') return setShift(s => s + 1);
      const i = QWERTY.indexOf(e.code);
      if (i < 0) return;
      e.preventDefault();
      press(`q:${e.code}`, mappingRef.current.base + shiftRef.current * periodRef.current + i);
    };
    const up = (e: KeyboardEvent) => QWERTY.includes(e.code) && release(`q:${e.code}`);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [press, release]);

  // MIDI controllers, once asked for (browsers prompt for it).
  const [midi, setMidi] = useState<'off' | 'waiting' | 'unsupported' | 'denied' | number>('off');
  const connectMidi = async () => {
    unlockAudio();
    if (!navigator.requestMIDIAccess) return setMidi('unsupported');
    setMidi('waiting');
    try {
      const access = await navigator.requestMIDIAccess();
      const attach = () => {
        access.inputs.forEach(input => {
          input.onmidimessage = ({ data }) => {
            if (!data) return;
            const status = data[0], key = data[1], velocity = data[2];
            const type = status & 0xf0;
            if (type === 0x90 && velocity > 0) press(`m:${key}`, key, 0.25 + (velocity / 127) * 0.75);
            else if (type === 0x80 || type === 0x90) release(`m:${key}`);
          };
        });
        setMidi(access.inputs.size);
      };
      access.onstatechange = attach;
      attach();
    } catch {
      setMidi('denied');
    }
  };

  // ─── What is lit ───────────────────────────────────────────────────────────
  const activeKeys = useMemo(() => {
    const keys = new Set(held.values());
    if (hoverKey !== null) keys.add(hoverKey);
    return keys;
  }, [held, hoverKey]);

  const count = loaded?.scale.pitches.length ?? 0;
  const activeRows = useMemo(() => {
    const rows = new Set<number>();
    activeKeys.forEach(k => {
      const d = pitchOf(k)?.degree;
      if (d === undefined) return;
      rows.add(d);
      if (d === 0) rows.add(count); // the period is the 1/1 again
    });
    if (row !== null) rows.add(row);
    return rows;
  }, [activeKeys, pitchOf, row, count]);

  const marks = useMemo(() => {
    if (!loaded) return '';
    const vertices = Array.from(activeRows).map(r => loaded.vertexOf[r % count]).filter(v => v >= 0);
    return vertices.length ? renderMarksSvg(loaded.graph, vertices) : '';
  }, [loaded, activeRows, count]);

  const readout = hoverKey ?? lastKey;

  // ─── Layout ────────────────────────────────────────────────────────────────
  return (
    <div className="grid min-h-dvh grid-cols-[minmax(0,1fr)] font-mono text-[11px] leading-[1.45] lg:h-dvh lg:grid-cols-[19rem_minmax(0,1fr)]">
      <aside className="flex h-[45dvh] min-h-0 flex-col border-b border-(--ink)/25 lg:h-auto lg:border-r lg:border-b-0">
        <div className="flex flex-col gap-2 p-3">
          <h1 className="m-0 text-[11px] font-normal uppercase tracking-[.2em]">Scala explorer</h1>
          <input
            type="search"
            data-browse
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="search  /"
            spellCheck={false}
            onKeyDown={e => e.key === 'Escape' && e.currentTarget.blur()}
            className="w-full border border-(--ink)/40 bg-transparent px-2 py-1 text-[12px] outline-none placeholder:text-(--ink)/45 focus:border-(--ink)"
          />
          <div className="flex justify-between text-(--ink)/60">
            <span>{results.length.toLocaleString('en')} of {index.length.toLocaleString('en')}</span>
            <button
              type="button"
              className="cursor-pointer underline-offset-2 hover:underline"
              onClick={() => results.length && choose(results[Math.floor(Math.random() * results.length)][0])}
            >
              random
            </button>
          </div>
        </div>
        <ScaleList results={results} selected={file} onChoose={choose} />
      </aside>

      <main className="flex min-h-0 min-w-0 flex-col">
        {error && <p className="m-0 border-b border-(--ink)/25 p-3">Could not read {error}</p>}
        {loaded ? (
          <>
            <header className="border-b border-(--ink)/25 px-4 py-3">
              <h2 className="m-0 text-[15px] font-normal">{loaded.scale.name}</h2>
              <p className="m-0 text-(--ink)/70">{loaded.scale.description || '—'}</p>
            </header>

            <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
              <section className="flex min-h-0 flex-col gap-3 border-(--ink)/25 p-4 lg:border-r">
                <div className="relative aspect-square w-full lg:aspect-auto lg:min-h-0 lg:flex-1">
                  <ScalaGraph key={loaded.file} graph={loaded.graph} className="absolute inset-0" />
                  <div className="pointer-events-none absolute inset-0" dangerouslySetInnerHTML={{ __html: marks }} />
                </div>
                <FactList facts={loaded.facts} />
                <PeriodRuler facts={loaded.facts} lit={Array.from(activeRows).map(r => r % count)} scale={loaded.scale} />
              </section>

              <section className="flex min-h-0 flex-col">
                <Degrees
                  loaded={loaded}
                  mapping={mapping}
                  lit={activeRows}
                  onRow={(index, down) => {
                    if (down && index !== null) {
                      const cents = index === 0 ? 0 : loaded.scale.pitches[index - 1].cents;
                      noteOn('row', mapping.baseHz * Math.pow(2, cents / 1200));
                    } else noteOff('row');
                    setRow(index);
                  }}
                />
              </section>
            </div>

            <footer className="border-t border-(--ink)/25 p-4">
              <Controls
                mapping={mapping}
                setMapping={setMapping}
                midi={midi}
                connectMidi={connectMidi}
                shiftBase={mapping.base + shift * periodKeys}
              />
              <div className="mt-3 h-28">
                <ScalaKeyboard
                  from={KEYS_FROM}
                  to={KEYS_TO}
                  pitchOf={pitchOf}
                  active={activeKeys}
                  onPress={press}
                  onRelease={release}
                  onHover={setHoverKey}
                />
              </div>
              <Readout pitch={readout === null ? null : pitchOf(readout)} scale={loaded.scale} />
            </footer>
          </>
        ) : (
          !error && <p className="m-0 p-4 text-(--ink)/60">…</p>
        )}
      </main>
    </div>
  );
}

// ─── The list ────────────────────────────────────────────────────────────────
// Up to 5k rows, so only the ones in view are rendered.
function ScaleList({ results, selected, onChoose }: {
  results: ScaleEntry[];
  selected: string | null;
  onChoose: (file: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 800 });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setView({ top: el.scrollTop, height: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A new search starts at the top…
  useEffect(() => {
    if (box.current) box.current.scrollTop = 0;
  }, [results]);

  // …and the selection stays in view as it moves.
  const at = results.findIndex(([f]) => f === selected);
  useEffect(() => {
    const el = box.current;
    if (!el || at < 0) return;
    const top = at * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
  }, [at, results]);

  const first = Math.max(0, Math.floor(view.top / ROW_H) - 8);
  const last = Math.min(results.length, Math.ceil((view.top + view.height) / ROW_H) + 8);

  return (
    <div
      ref={box}
      className="min-h-0 flex-1 overflow-y-auto border-t border-(--ink)/25"
      onScroll={e => {
        const top = e.currentTarget.scrollTop;
        setView(v => ({ ...v, top }));
      }}
    >
      <div className="relative" style={{ height: results.length * ROW_H }}>
        {results.slice(first, last).map(([file, desc, count], i) => {
          const on = file === selected;
          return (
            <button
              key={file}
              type="button"
              onClick={() => onChoose(file)}
              className={`absolute inset-x-0 flex cursor-pointer flex-col justify-center px-3 text-left ${
                on ? 'bg-(--ink) text-(--paper)' : 'hover:bg-(--ink)/10'
              }`}
              style={{ top: (first + i) * ROW_H, height: ROW_H }}
            >
              <span className="flex w-full justify-between gap-2">
                <span className="truncate">{stem(file)}</span>
                <span className="shrink-0 opacity-60 tabular-nums">{count}</span>
              </span>
              <span className="w-full truncate text-[10px] opacity-60">{desc || '—'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Facts ───────────────────────────────────────────────────────────────────
function FactList({ facts }: { facts: Facts }) {
  const { count, periodCents, periodRatio, periodName, written, primeLimit, steps, stepSizes, equal, descents } = facts;
  const period = [`${fmt(periodCents)}¢`, periodRatio && `${periodRatio[0]}/${periodRatio[1]}`, periodName ?? 'non-octave']
    .filter(Boolean).join(' · ');
  const equalText = equal && (
    periodName === 'octave'
      ? equal.subset ? `${count} of ${equal.divisions}-EDO` : `${equal.divisions}-EDO`
      : equal.subset
        ? `${count} of ${equal.divisions} equal divisions of the ${periodName ?? 'period'}`
        : `${equal.divisions} equal divisions of the ${periodName ?? 'period'}`
  );
  const min = Math.min(...steps);
  const max = Math.max(...steps);

  const rows: [string, string][] = [
    ['pitches', `${count}`],
    ['period', period],
    ['written', written === 'ratios' ? `ratios · ${primeLimit ? `${primeLimit}-limit` : 'limit too large to factor'}` : written === 'mixed' ? 'ratios and cents' : 'cents'],
    ['equal', equalText || 'no'],
    ['steps', stepSizes === 1 ? `${fmt(min)}¢, all equal` : `${fmt(min)}–${fmt(max)}¢ · ${stepSizes} sizes`],
    ['order', descents ? `unsorted · ${descents} step${descents > 1 ? 's' : ''} down` : 'ascending'],
  ];

  return (
    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-(--ink)/55">{k}</dt>
          <dd className="m-0">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// One period, laid flat: the scale's degrees above the line, the 12-TET grid
// below it, so the step pattern and how far it strays read at a glance.
function PeriodRuler({ facts, scale, lit }: { facts: Facts; scale: Scale; lit: number[] }) {
  const P = facts.periodCents;
  const degrees = [0, ...scale.pitches.slice(0, -1).map(p => ((p.cents % P) + P) % P)];
  const litSet = new Set(lit);
  const x = (c: number) => (c / P) * 1000;
  return (
    <svg viewBox="-4 0 1008 34" className="block w-full overflow-visible" aria-hidden>
      <line x1="0" x2="1000" y1="17" y2="17" stroke="currentColor" strokeOpacity=".5" strokeWidth="1" />
      {Array.from({ length: Math.floor(P / 100) + 1 }, (_, i) => (
        <line key={i} x1={x(i * 100)} x2={x(i * 100)} y1="18" y2={i % 12 ? 23 : 28} stroke="currentColor" strokeOpacity=".4" strokeWidth="1" />
      ))}
      <line x1="1000" x2="1000" y1="2" y2="17" stroke="currentColor" strokeWidth="1.5" />
      {degrees.map((c, d) => (
        <line
          key={d}
          x1={x(c)} x2={x(c)} y1={litSet.has(d) ? 0 : 5} y2="17"
          stroke="currentColor"
          strokeWidth={litSet.has(d) ? 3 : d === 0 ? 1.5 : 1}
        />
      ))}
    </svg>
  );
}

// ─── Every degree ────────────────────────────────────────────────────────────
function Degrees({ loaded, mapping, lit, onRow }: {
  loaded: Loaded;
  mapping: Mapping;
  lit: Set<number>;
  onRow: (index: number | null, down: boolean) => void; // null: none hovered
}) {
  const [tab, setTab] = useState<'degrees' | 'file'>('degrees');
  const { scale, lines } = loaded;
  const scroller = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const written = [
      { token: '1/1', rest: 'implicit', cents: 0, ratio: [1, 1] as [number, number], exact: true, line: -1 },
      ...scale.pitches.map(p => {
        const [, , token = '', rest = ''] = /^(\s*)(\S+)(.*)$/.exec(lines[p.line]) ?? [];
        return { token, rest: rest.trim().replace(/^!\s*/, ''), cents: p.cents, ratio: p.ratio ?? simplestRatio(p.cents), exact: !!p.ratio, line: p.line };
      }),
    ];
    return written.map((r, i) => ({ ...r, step: i ? r.cents - written[i - 1].cents : null }));
  }, [scale, lines]);

  // Follow what is being played.
  const litLines = new Set(Array.from(lit).map(i => rows[i]?.line).filter(l => l !== undefined && l >= 0));
  const lastLit = Math.max(-1, ...Array.from(lit));
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-row="${tab === 'degrees' ? lastLit : rows[lastLit]?.line}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [lastLit, tab, rows]);

  return (
    <>
      <nav className="flex gap-4 border-b border-(--ink)/25 px-4 py-2">
        {(['degrees', 'file'] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`cursor-pointer ${tab === t ? 'underline underline-offset-4' : 'text-(--ink)/55 hover:text-(--ink)'}`}
          >
            {t}
          </button>
        ))}
        <span className="ml-auto text-(--ink)/55">{tab === 'degrees' ? 'press a row to hear it' : `${lines.length} lines`}</span>
      </nav>

      <div ref={scroller} className="min-h-0 flex-1 overflow-auto max-lg:max-h-[60dvh]">
        {tab === 'degrees' ? (
          <table className="w-full border-collapse whitespace-nowrap tabular-nums">
            <thead className="sticky top-0 bg-(--paper) text-left text-(--ink)/55">
              <tr>
                {['#', 'written', 'cents', 'step', 'ratio', '12-TET', 'Hz', ''].map((h, i) => (
                  <th key={i} className={`px-2 py-1 font-normal ${[2, 3, 6].includes(i) ? 'text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const hz = mapping.baseHz * Math.pow(2, r.cents / 1200);
                const tet = nearestTet(hz);
                const off = r.exact ? 0 : r.cents - ratioCents(r.ratio[0], r.ratio[1]);
                return (
                  <tr
                    key={i}
                    data-row={i}
                    className={`cursor-pointer ${lit.has(i) ? 'bg-(--ink) text-(--paper)' : 'hover:bg-(--ink)/10'}`}
                    onPointerDown={() => onRow(i, true)}
                    onPointerUp={() => onRow(i, false)}
                    onPointerEnter={() => onRow(i, false)}
                    onPointerLeave={() => onRow(null, false)}
                  >
                    <td className="px-2 opacity-60">{i}</td>
                    <td className="px-2">{r.token}</td>
                    <td className="px-2 text-right">{fmt(r.cents, 3)}</td>
                    <td className="px-2 text-right opacity-70">{r.step === null ? '' : fmt(r.step)}</td>
                    <td className="px-2">
                      {r.exact ? `${r.ratio[0]}/${r.ratio[1]}` : <span className="opacity-60">≈{r.ratio[0]}/{r.ratio[1]} {signed(off)}</span>}
                    </td>
                    <td className="px-2">{tet.name} <span className="opacity-60">{signed(tet.offset)}</span></td>
                    <td className="px-2 text-right">{hz.toFixed(2)}</td>
                    <td className="max-w-[16rem] truncate px-2 opacity-60">{r.rest}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <pre className="m-0 whitespace-pre-wrap px-4 py-2 [overflow-wrap:anywhere]">
            {lines.map((text, l) => (
              <span key={l} data-row={l} className={`block ${litLines.has(l) ? 'bg-(--ink) text-(--paper)' : ''}`}>{text || ' '}</span>
            ))}
          </pre>
        )}
      </div>
    </>
  );
}

// ─── Keyboard controls ───────────────────────────────────────────────────────
function Controls({ mapping, setMapping, midi, connectMidi, shiftBase }: {
  mapping: Mapping;
  setMapping: (m: Mapping) => void;
  midi: 'off' | 'waiting' | 'unsupported' | 'denied' | number;
  connectMidi: () => void;
  shiftBase: number;
}) {
  const btn = 'cursor-pointer border border-(--ink)/40 px-1.5 hover:border-(--ink)';
  const setBase = (base: number) => {
    const clamped = Math.min(127, Math.max(0, base));
    setMapping({ ...mapping, base: clamped, baseHz: tetHz(clamped) });
  };
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <span className="flex gap-1">
        {(['linear', 'nearest'] as const).map(m => (
          <button
            key={m}
            type="button"
            title={m === 'linear' ? 'one degree per key, as Scala maps it' : 'each key plays the scale pitch nearest its 12-TET pitch'}
            onClick={() => setMapping({ ...mapping, mode: m })}
            className={`${btn} ${mapping.mode === m ? 'bg-(--ink) text-(--paper)' : ''}`}
          >
            {m}
          </button>
        ))}
      </span>
      <span className="flex items-center gap-1">
        <span className="text-(--ink)/55">1/1 on</span>
        <button type="button" className={btn} onClick={() => setBase(mapping.base - 1)} aria-label="lower">‹</button>
        <span className="w-[6ch] text-center">{keyName(mapping.base)}</span>
        <button type="button" className={btn} onClick={() => setBase(mapping.base + 1)} aria-label="higher">›</button>
        <span className="text-(--ink)/55">at</span>
        <input
          type="number"
          step="0.01"
          min="1"
          value={+mapping.baseHz.toFixed(3)}
          onChange={e => {
            const hz = Number(e.target.value);
            if (hz > 0) setMapping({ ...mapping, baseHz: hz });
          }}
          className="w-[9ch] border border-(--ink)/40 bg-transparent px-1 text-right outline-none focus:border-(--ink)"
        />
        <span className="text-(--ink)/55">Hz</span>
      </span>
      <span className="flex items-center gap-2">
        <button type="button" className={btn} onClick={connectMidi} disabled={midi === 'waiting'}>MIDI</button>
        <span className="text-(--ink)/55">
          {midi === 'off' ? 'connect a controller'
            : midi === 'waiting' ? 'asking…'
            : midi === 'unsupported' ? 'not supported in this browser'
            : midi === 'denied' ? 'not allowed'
            : `${midi} input${midi === 1 ? '' : 's'}`}
        </span>
      </span>
      <span className="text-(--ink)/55 max-lg:hidden">
        keys a w s e d f t g… from {keyName(shiftBase)} · z x shift
      </span>
    </div>
  );
}

function Readout({ pitch, scale }: { pitch: KeyPitch | null; scale: Scale }) {
  if (!pitch) return <p className="m-0 mt-2 text-(--ink)/55">hover or play a key</p>;
  const p = pitch.degree === 0 ? null : scale.pitches[pitch.degree - 1];
  const written = p ? (p.ratio ? `${p.ratio[0]}/${p.ratio[1]}` : `${fmt(p.cents, 3)}¢`) : '1/1';
  const tet = nearestTet(pitch.hz);
  return (
    <p className="m-0 mt-2 tabular-nums">
      {keyName(pitch.key)} <span className="text-(--ink)/55">key {pitch.key}</span>
      {' · '}degree {pitch.degree} <span className="text-(--ink)/55">({written})</span>
      {pitch.period !== 0 && <span className="text-(--ink)/55"> {signed(pitch.period, 0)} period{Math.abs(pitch.period) > 1 ? 's' : ''}</span>}
      {' · '}{fmt(pitch.cents)}¢
      {' · '}{pitch.hz.toFixed(2)} Hz
      {' · '}≈ {tet.name} <span className="text-(--ink)/55">{signed(tet.offset)}¢</span>
    </p>
  );
}
