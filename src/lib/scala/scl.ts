// Scala .scl parser — https://www.huygens-fokker.org/scala/scl_format.html
//
// Lines starting with "!" are comments. The first non-comment line is the
// description (it may be empty), the second is the note count, then one pitch
// per line. A pitch containing "." is cents; anything else is a ratio "n/d" or
// a bare integer. Only the first token of a pitch line counts. The 1/1 is
// implicit, and the last pitch is the period (the "formal octave").

export interface Pitch {
  cents: number;
  ratio?: [number, number]; // only when the file spelled a ratio
  line: number;              // 0-based index of its line in the file
}

export interface Scale {
  name: string;        // file stem, e.g. "partch-43"
  description: string;
  pitches: Pitch[];    // excludes the implicit 1/1; last entry is the period
}

export const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

export const ratioCents = (n: number, d: number) => 1200 * Math.log2(n / d);

function parsePitch(token: string, line: number): Omit<Pitch, 'line'> {
  if (token.includes('.')) {
    const cents = Number(token);
    if (!Number.isFinite(cents)) throw new Error(`line ${line}: bad cents "${token}"`);
    return { cents };
  }
  const [ns, ds = '1'] = token.split('/');
  const n = Number(ns);
  const d = Number(ds);
  if (!Number.isInteger(n) || !Number.isInteger(d) || n <= 0 || d <= 0) {
    throw new Error(`line ${line}: bad ratio "${token}"`);
  }
  const g = gcd(n, d);
  return { cents: ratioCents(n, d), ratio: [n / g, d / g] };
}

export function parseScl(text: string, name: string): Scale {
  const lines = text.split(/\r?\n/);
  let description: string | undefined;
  let count: number | undefined;
  const pitches: Pitch[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.startsWith('!')) continue;

    if (description === undefined) {
      description = raw.trim();
      continue;
    }

    const token = raw.trim().split(/\s+/)[0];
    if (count === undefined) {
      if (!token) continue;
      count = Number(token);
      if (!Number.isInteger(count) || count < 0) throw new Error(`${name}: bad note count "${token}"`);
      continue;
    }

    if (pitches.length === count) break;
    if (!token) continue;
    pitches.push({ ...parsePitch(token, i + 1), line: i });
  }

  if (count === undefined) throw new Error(`${name}: missing note count`);
  if (pitches.length !== count) throw new Error(`${name}: expected ${count} pitches, found ${pitches.length}`);

  return { name, description: description ?? '', pitches };
}
