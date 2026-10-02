// Vite plugin: `virtual:scale-index` — every file in public/scales with its
// description and size, for the explorer's list.
//
// This parses the whole archive (~5k files, ~0.6 s), once, when the dev server
// starts or the app is built. The browser gets the index in the bundle and
// fetches only the file it shows from /scales/<file>.

import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { parseScl } from './src/lib/scala/scl.ts';
import type { ScaleEntry } from './src/lib/scala/entry.ts';

const SCALES_DIR = path.join(import.meta.dirname, 'public', 'scales');
const ID = 'virtual:scale-index';

function buildIndex(): ScaleEntry[] {
  const files = fs.readdirSync(SCALES_DIR).filter(f => f.toLowerCase().endsWith('.scl')).sort();
  return files.flatMap(file => {
    try {
      // The archive is ASCII plus a few Latin-1 files; Latin-1 decodes both.
      const text = fs.readFileSync(path.join(SCALES_DIR, file), 'latin1');
      const scale = parseScl(text, path.basename(file, path.extname(file)));
      return [[file, scale.description, scale.pitches.length] as ScaleEntry];
    } catch (err) {
      console.warn(`[scales] skipping ${file}: ${(err as Error).message}`);
      return [];
    }
  });
}

export function scaleIndex(): Plugin {
  return {
    name: 'scale-index',
    resolveId: id => (id === ID ? '\0' + ID : null),
    load: id => (id === '\0' + ID ? `export default ${JSON.stringify(buildIndex())};` : null),
  };
}
