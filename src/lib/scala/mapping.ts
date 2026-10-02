// A scale laid onto MIDI keys.
//
// "linear" is Scala's default keyboard mapping: consecutive keys play
// consecutive degrees, the 1/1 on the base key, and every `count` keys the
// period repeats — so a 22-note scale spans 22 keys per period, whatever the
// black and white keys say. "nearest" keeps the piano's layout instead: each
// key plays the scale pitch closest to its own 12-TET pitch (degrees can repeat
// or go missing).
//
// Degree 0 is the implicit 1/1; degree i (1..count-1) is the file's i-th pitch.
// The last pitch, the period, is degree 0 one period up.

import type { Scale } from './scl';

export type MappingMode = 'linear' | 'nearest';

export interface Mapping {
  mode: MappingMode;
  base: number;    // MIDI key of the 1/1
  baseHz: number;  // its frequency
}

export interface KeyPitch {
  key: number;     // MIDI key
  degree: number;  // 0..count-1
  period: number;  // periods above (or below) the base
  cents: number;   // above the base key's 1/1
  hz: number;
}

export const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export const keyName = (key: number) => `${NOTE_NAMES[((key % 12) + 12) % 12]}${Math.floor(key / 12) - 1}`;
export const isBlack = (key: number) => [1, 3, 6, 8, 10].includes(((key % 12) + 12) % 12);
export const tetHz = (key: number) => 440 * Math.pow(2, (key - 69) / 12);

export const DEFAULT_MAPPING: Mapping = { mode: 'linear', base: 60, baseHz: tetHz(60) };

/** Cents of each degree above the 1/1, in file order, and the period. */
export function degreeCents(scale: Scale): { degrees: number[]; period: number } {
  const last = scale.pitches[scale.pitches.length - 1];
  const period = last && last.cents > 0 ? last.cents : 1200;
  return { degrees: [0, ...scale.pitches.slice(0, -1).map(p => p.cents)], period };
}

/** key → pitch under this mapping; null for a scale with no pitches. */
export function keyMapper(scale: Scale, mapping: Mapping): (key: number) => KeyPitch | null {
  if (!scale.pitches.length) return () => null;
  const { degrees, period } = degreeCents(scale);
  const n = degrees.length;

  return key => {
    let degree = 0;
    let periods = 0;
    if (mapping.mode === 'linear') {
      const offset = key - mapping.base;
      degree = ((offset % n) + n) % n;
      periods = Math.floor(offset / n);
    } else {
      const target = (key - mapping.base) * 100;
      let best = Infinity;
      degrees.forEach((c, d) => {
        const k = Math.round((target - c) / period);
        const err = Math.abs(c + k * period - target);
        if (err < best - 1e-9) { best = err; degree = d; periods = k; }
      });
    }
    const cents = degrees[degree] + periods * period;
    return { key, degree, period: periods, cents, hz: mapping.baseHz * Math.pow(2, cents / 1200) };
  };
}

/** The nearest 12-TET note (A4 = 440 Hz) to a frequency, and how many cents off it is. */
export function nearestTet(hz: number): { key: number; name: string; offset: number } {
  const exact = 69 + 12 * Math.log2(hz / 440);
  const key = Math.round(exact);
  return { key, name: keyName(key), offset: (exact - key) * 100 };
}
