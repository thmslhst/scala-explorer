import { useEffect, useRef } from 'react';
import { isBlack, keyName, type KeyPitch } from '@/lib/scala/mapping';

// A piano keyboard showing which scale degree each key plays. Pure display
// plus pointer input: what a key sounds like is the caller's business.
//
// Each key is labelled with its degree; the 1/1s are underlined. Pointers can
// slide across keys (glissando), including several fingers on a touch screen.

export interface KeyboardProps {
  from: number;                    // lowest MIDI key shown (a C reads best)
  to: number;                      // highest, inclusive
  pitchOf: (key: number) => KeyPitch | null;
  active: Set<number>;             // keys sounding
  onPress: (source: string, key: number) => void;
  onRelease: (source: string) => void;
  onHover: (key: number | null) => void;
}

export default function ScalaKeyboard({ from, to, pitchOf, active, onPress, onRelease, onHover }: KeyboardProps) {
  const keys = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const whites = keys.filter(k => !isBlack(k));
  const w = 100 / whites.length; // % per white key

  // Which key each pointer is holding down.
  const held = useRef(new Map<number, number>());
  useEffect(() => {
    const up = (e: PointerEvent) => {
      if (!held.current.has(e.pointerId)) return;
      held.current.delete(e.pointerId);
      onRelease(`p${e.pointerId}`);
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [onRelease]);

  const press = (pointer: number, key: number) => {
    if (held.current.get(pointer) === key) return;
    held.current.set(pointer, key);
    onPress(`p${pointer}`, key);
  };

  let white = 0;
  return (
    <div className="relative h-full touch-none select-none" onPointerLeave={() => onHover(null)}>
      {keys.map(key => {
        const black = isBlack(key);
        const left = black ? white * w - w * 0.3 : white++ * w;
        const p = pitchOf(key);
        const on = active.has(key);
        const tone = black
          ? on ? 'bg-(--paper) text-(--ink) border border-(--ink)' : 'bg-(--ink) text-(--paper) hover:bg-(--ink)/80'
          : on ? 'bg-(--ink) text-(--paper)' : 'hover:bg-(--ink)/10';
        return (
          <div
            key={key}
            role="button"
            aria-label={`${keyName(key)}${p ? `, degree ${p.degree}` : ''}`}
            title={keyName(key)}
            className={`absolute top-0 flex flex-col items-center justify-end pb-1 leading-none ${
              black ? 'z-10 h-[60%] rounded-b-[2px]' : 'h-full border-r border-(--ink)/40'
            } ${tone}`}
            style={{ left: `${left}%`, width: `${black ? w * 0.6 : w}%` }}
            onPointerDown={e => {
              // Let the pointer slide on to other keys (touch captures it otherwise).
              (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
              press(e.pointerId, key);
            }}
            onPointerEnter={e => {
              onHover(key);
              if (held.current.has(e.pointerId)) press(e.pointerId, key);
            }}
          >
            {p && (
              <span className={`text-[9px] tabular-nums ${p.degree === 0 ? 'underline underline-offset-2' : ''}`}>
                {p.degree}
              </span>
            )}
            {!black && key % 12 === 0 && <span className="mt-1 text-[8px] opacity-50">{keyName(key)}</span>}
          </div>
        );
      })}
      <div className="pointer-events-none absolute inset-0 border border-(--ink)/40" />
    </div>
  );
}
