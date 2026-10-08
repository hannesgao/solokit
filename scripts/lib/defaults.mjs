// Remembered answers (CORE-2, Configuration and state): `<data>/defaults.json`,
// read and written only through this module and scripts/defaults.mjs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { writeFileAtomic } from './fs-atomic.mjs';

export class DefaultsError extends Error {
  constructor(message) {
    super(message);
    this.recovery = 'Fix or delete defaults.json in the plugin data directory; it only holds remembered answers.';
  }
}

// Only preference questions remember answers; judgement and gate answers are
// never stored, so they cannot stand in for a later decision (CORE-2). Each
// key has the shape its answers must have. A stack is remembered for when
// none can be detected; the skill that asks decides that (CONVENTIONS,
// "Which option comes first").
export const PREFERENCES = {
  owner: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/,
  visibility: /^(?:public|private)$/,
  language: /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/,
  stack: /^(?:flutter|node|python|php|generic)$/,
};
export const PREFERENCE_KEYS = Object.keys(PREFERENCES);

export const isValidPreference = (key, value) =>
  Object.hasOwn(PREFERENCES, key) && typeof value === 'string' && PREFERENCES[key].test(value);

const file = dataDir => join(dataDir, 'defaults.json');

// The remembered answers, limited to valid preference values. A file that is
// not a JSON object is a DefaultsError; a missing file is no answers.
export function readDefaults(dataDir) {
  let text;
  try {
    text = readFileSync(file(dataDir), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new DefaultsError(`defaults.json is not valid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new DefaultsError('defaults.json must be a JSON object');
  return Object.fromEntries(Object.entries(parsed).filter(([key, value]) => isValidPreference(key, value)));
}

export function writeDefaults(dataDir, defaults) {
  writeFileAtomic(file(dataDir), `${JSON.stringify(defaults, null, 2)}\n`);
}
