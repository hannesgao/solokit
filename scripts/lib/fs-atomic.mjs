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
    renameWithRetry(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
  syncDir(dir);
}

// On Windows a rename over a file another process has open (an editor, a
// virus scanner) fails for a moment with EPERM, EBUSY or EACCES; retry briefly.
function renameWithRetry(from, to) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * attempt);
    }
  }
}

// Flushes the directory entry of the rename where the platform allows it
// (POSIX); Windows cannot open a directory this way, which is fine there.
function syncDir(dir) {
  let fd;
  try {
    fd = openSync(dir, 'r');
    fsyncSync(fd);
  } catch {
    // best effort
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
