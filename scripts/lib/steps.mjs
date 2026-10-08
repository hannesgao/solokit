// Idempotent steps (CORE-4): every step checks the real state first, so a
// finished step is reported as done and skipped, whatever state.json says.
import { failStep, readState, withState } from './state.mjs';

const genericRecovery = name => `Fix the cause, then run the command again; it resumes at step "${name}".`;

// Runs `steps` in order. Each step is `{ name, check(ctx), run(ctx) }`:
// `check` answers whether the step's outcome already exists (files, git,
// GitHub) and must not change anything; `run` produces the outcome.
//
// Returns `{ ok, steps: [{ name, status, skipped?, note? }], failed? }`, where
// status is `done`, `would run` (dry run), `failed` or `not run`. The first
// failure stops the run; `failed` carries its error and recovery (CORE-7).
// Bookkeeping in state.json starts once the file exists, so the steps that
// create it (kickoff) run through the same runner.
export async function runSteps(root, steps, { dryRun = false } = {}) {
  for (const step of steps) {
    if (typeof step.check !== 'function' || typeof step.run !== 'function') {
      throw new TypeError(`step "${step.name}" needs check and run`);
    }
  }
  const report = { ok: true, steps: [] };
  const ctx = { root, dryRun };

  for (const [index, step] of steps.entries()) {
    const { state } = readState(root, { write: !dryRun });
    const recorded = state?.steps?.[step.name];
    try {
      if (await step.check(ctx)) {
        if (state && recorded !== 'done' && !dryRun) await withState(root, step.name, s => s);
        report.steps.push({ name: step.name, status: 'done', skipped: true });
        continue;
      }
    } catch (error) {
      error.recovery ??= genericRecovery(step.name);
      return stop(report, steps, index, error, state && !dryRun ? () => failStep(root, step.name, `check failed: ${error.message}`, error.recovery) : null);
    }

    const note = recorded === 'done' ? 'state said done, but the outcome is missing; running it again' : undefined;
    if (dryRun) {
      report.steps.push({ name: step.name, status: 'would run', ...(note ? { note } : {}) });
      continue;
    }
    try {
      if (state) {
        await withState(root, step.name, async s => {
          await step.run(ctx);
          // The step may have changed state.json itself; keep its version.
          return readState(root).state ?? s;
        });
      } else {
        await step.run(ctx);
        if (readState(root).state) await withState(root, step.name, s => s);
      }
      report.steps.push({ name: step.name, status: 'done', ...(note ? { note } : {}) });
    } catch (error) {
      error.recovery ??= genericRecovery(step.name);
      return stop(report, steps, index, error, null);
    }
  }
  return report;
}

// Ends the run at `steps[index]`: that step failed, the rest did not run.
function stop(report, steps, index, error, record) {
  if (record) {
    try {
      record();
    } catch {
      // the report still says what failed
    }
  }
  report.ok = false;
  report.steps.push({ name: steps[index].name, status: 'failed' });
  for (const later of steps.slice(index + 1)) report.steps.push({ name: later.name, status: 'not run' });
  report.failed = { name: steps[index].name, error: error.message, recovery: error.recovery };
  return report;
}
