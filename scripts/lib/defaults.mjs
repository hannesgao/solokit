// Remembered answers (CORE-2, Configuration and state): `<data>/defaults.json`,
// read and written only through this module and scripts/defaults.mjs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { writeFileAtomic } from './fs-atomic.mjs';

// Only preference questions remember answers; judgement and gate answers are
// never stored, so they cannot stand in for a later decision (CORE-2).
export const PREFERENCE_KEYS = ['owner', 'visibility', 'language', 'stack'];

const file = dataDir => join(dataDir, 'defaults.json');

export function readDefaults(dataDir) {
  try {
    const parsed = JSON.parse(readFileSync(file(dataDir), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return {};
    throw error;
  }
}

export function writeDefaults(dataDir, defaults) {
  writeFileAtomic(file(dataDir), `${JSON.stringify(defaults, null, 2)}\n`);
}
