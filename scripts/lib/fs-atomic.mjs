// Atomic file writes (CORE-7): a reader sees the old file or the new one,
// never half of the new one.
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

// Writes `text` to a temp file beside `path`, flushes it and renames it over
// `path`. On any failure the temp file is removed and `path` is untouched.
// `options.beforeRename` is a test seam that runs between flush and rename.
export function writeFileAtomic(path, text, options = {}) {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const temp = join(dir, `.${basename(path)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    const fd = openSync(temp, 'wx');
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    options.beforeRename?.();
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}
