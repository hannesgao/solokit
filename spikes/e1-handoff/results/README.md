# Spike E1 results: mod hand-off and skill permissions

Issue #1. Claude Code 2.1.294, Node 24.21.0, Linux (WSL2), 8 Oct 2026.
Decisions drawn from these results: [ADR 0001](../../../docs/decisions/0001-band-and-alias-hand-off.md), [ADR 0002](../../../docs/decisions/0002-skill-permissions-and-remembered-defaults.md).

## How to re-run

| Check | Command (from the repo root) | Output |
| --- | --- | --- |
| Type declarations | `claude -p "hi" --plugin-dir spikes/e1-handoff` once, then `node spikes/e1-handoff/extract-types.mjs` | `types.md` |
| Skills in `-p` | `node spikes/e1-handoff/run-p.mjs [case ...]` | `p-<case>.json`, `p-summary-*.md` |
| Tools offered in `-p` | `node spikes/e1-handoff/run-tools.mjs` | `p-tools.json`, `p-tools.md` |
| Interactive hand-off | `claude --plugin-dir spikes/e1-handoff --permission-mode manual`, then the checklist below | `interactive-1/`, `interactive-2/` |

The plugin writes markers to `.spike/` (gitignored) and `probe.json` to its data directory (`~/.claude/plugins/data/solokit-e1-inline/` for a `--plugin-dir` load); the archived copies are in the result folders.

Interactive checklist: press band buttons 1–3; type `1`, `2`, `3` alone into the empty prompt; run `/solokit 1` … `/solokit 4` and bare `/solokit`; run `/solokit-e1:perm` and answer its question.

## Findings

| # | Question | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Declarations | `$.command.run` "runs a slash command as if the person typed `/command args`… Rejects an unknown name, and inside a hook the turn is waiting on." `$.prompt.submit` takes `asUser`; `$.prompt.fill` resolves `{ isFilled, refusal? }`. Button `hotkey`: "never the composer, save that a bare digit in an empty one answers a band Button". | `types.md` |
| 2 | Plugin skill in `-p` | `/solokit-e1:go hello` expands, `$ARGUMENTS` = `hello`, the `` !`…` `` injection runs under `allowed-tools` | `p-go-hello.json`, `p-artifacts/` |
| 3 | AskUserQuestion in `-p` | **Removed** in every `-p` run without a permission host: not in the init tool list for plain, `--permission-prompts none`, `--permission-prompts host`, `--permission-mode dontAsk` and `manual`. It never shows up in `permission_denials`; the model reports the tool as unavailable. | `p-tools.md`, `p-ask-*.json` |
| 4 | Band button → `$.prompt.submit({ text: "/…", asUser: true })` | **Refused by the host**: "a text beginning with / would run a command as the user; run one with $.command.run({ command }) (host check)" | `interactive-1/e1-mod-log.json` |
| 5 | Band button → `$.command.run({ command: "solokit-e1:go", args })` | **Works**: skill expands, a turn starts by itself, args arrive; prompt origin `{ kind: "plugin", name: "solokit-e1" }` | `interactive-1/` markers, transcript |
| 6 | Band button → `$.prompt.fill({ text: "/solokit-e1:go …" })` | **Works with one Enter**: `isFilled: true`; on Enter the skill expands with args; origin `human` | same |
| 7 | Digit typed alone into the empty prompt | Presses the band Button with that `hotkey` (1 → submit, refused as in 4; 2 → run; 3 → fill) | same |
| 8 | `/solokit 1` and `/solokit 2` (call inside the mod's `command.run` hook) | **Refused**: "called from a command.run hook, it would wait on the turn this hook is holding; answer { text } instead, or run it from a later event (turn.complete)" | `interactive-1/e1-mod-log.json` |
| 9 | `/solokit 3` (fill inside the hook) | Works: `isFilled: true`, Enter still needed | same |
| 10 | `/solokit 4`: hook answers `{ text }`, then `$.clock.after(50, () => $.command.run(…))` | **Works**: skill expands, a turn starts by itself, args arrive | `interactive-2/` |
| 11 | Mod hand-off in `-p` | `$.command.run` "is not available in this mode: no session is bound in this process"; the in-hook call is refused as in 8 | `p-artifacts-mod/e1-mod-log.json` |
| 12 | `allowed-tools` grant after answering AskUserQuestion in the same turn | **Survives**: `probe.mjs write 2` ran 2 s after the answer with `permissionDecision.source: "config"`, the same as write 1 | `interactive-1/transcript-excerpt.json`, `probe.json` |
| 13 | Write tool to `${CLAUDE_PLUGIN_DATA}` | Interactive: **asks** (`permissionDecision.source: "user_temporary"`, 48 s wait). `-p`: **denied** (`permission_denials: [Write]`, treated as a sensitive file) | same, `p-perm-plain.json` |
| 14 | Environment of a Bash command a skill runs | `CLAUDE_PLUGIN_DATA` and `CLAUDE_PLUGIN_ROOT` are **not set**; the data directory reaches a script only as an argument substituted into the skill text | `probe.json` (`envDir: null`, `envPluginRoot: null`) |
| 15 | `$.command.list()` right after `$.command.register` in `session.start` | Lists the plugin's skills, not the just-registered `solokit` command | `p-artifacts/e1-mod-log.json` |

Note on 12 and 13: the person running the checklist remembered the prompt on step 3 rather than step 4; the transcript's per-call `permissionDecision` and timings show the prompt was on the Write call (step 4).
