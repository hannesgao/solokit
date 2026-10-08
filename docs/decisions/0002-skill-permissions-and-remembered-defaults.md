---
id: "0002"
date: 2026-10-08
status: accepted
---

# Skills run kit scripts under allowed-tools and pass the data directory as an argument

## Context

Skills need to run kit scripts and store remembered answers (Configuration and state, CORE-2) without permission prompts. They also need to work when nobody can answer a question (CORE-3). PRD 0.3.0 assumed four things, pending spike E1 (#1). Evidence: `spikes/e1-handoff/results/README.md`, Claude Code 2.1.294.

| Assumption | Result |
| --- | --- |
| A skill's `allowed-tools` grant `Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/*)` covers the kit's scripts | Holds in interactive Manual mode and in `-p`. The same grant also lets a `` !`node …` `` injection in the skill text run while the skill loads |
| The grant survives answering AskUserQuestion in the same turn | Holds: the script call after the answer was allowed by `config`, with no prompt |
| A Write to `${CLAUDE_PLUGIN_DATA}` asks for permission | Holds interactively. In `-p` it is denied as a sensitive path |
| Scripts read `CLAUDE_PLUGIN_DATA` from the environment | **Fails**: a Bash command started by a skill has neither `CLAUDE_PLUGIN_DATA` nor `CLAUDE_PLUGIN_ROOT` set |
| AskUserQuestion is usable in a plain `-p` run and only removed by `--permission-prompts none` or denied by `dontAsk` | **Fails**: without a permission host it is removed from every `-p` run (plain, `none`, `host`, `dontAsk`, `manual`) and never appears in `permission_denials` |

The docs add one rule: the grant clears when the user sends their next message, and invoking the skill again re-applies it.

## Decision

1. Every solokit skill declares `allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/*)`, plus the read-only commands it needs, and calls scripts only in the form `node ${CLAUDE_PLUGIN_ROOT}/scripts/<name>.mjs …`.
2. Scripts that touch plugin data take its location as an explicit argument, `--data ${CLAUDE_PLUGIN_DATA}`, substituted in the skill text. They never rely on the environment for it. Settings hooks and the mod keep using what their own runtime provides.
3. Remembered answers are read and written only through `scripts/defaults.mjs --data ${CLAUDE_PLUGIN_DATA} get|set …`. Skills never use Write or Edit on the data directory.
4. Each skill collects its inputs with AskUserQuestion inside the turn that invoked it, so the grant still applies to the script calls that follow. If a skill needs free-text input from a later message, it re-invokes itself or asks the user to run the command again rather than relying on the grant.
5. CORE-3 fallback: a skill checks whether AskUserQuestion is available. In any `-p` run without a host it is not. Then the skill uses flags first, remembered defaults second, and the recommended option for an ordinary step. At a gate it stops and lists what it needs. It never treats the missing tool as an answer.
6. Deterministic state reads at the start of a skill (CORE-1) may use `` !`node ${CLAUDE_PLUGIN_ROOT}/scripts/… --data ${CLAUDE_PLUGIN_DATA}` `` injection under the same grant, so the model receives the state as data.

## Consequences

- No permission prompts for kit scripts in any mode, and remembered defaults work in `-p` too.
- Every script that reads or writes plugin data has a `--data` flag. Tests pass a temporary directory.
- Unquoted substitution breaks on paths that contain spaces, which is common on Windows (`C:\Users\First Last\…`). Whether a quoted argument still matches the `allowed-tools` prefix rule has not been tested; the Windows test layer must cover it, and M1 settles the quoting rule.
- A skill can no longer assume it will receive answers in `-p`. Eval cases for CORE-3 run in `-p` and assert the "stop and list what is needed" output at gates.

## Alternatives considered

- **Write tool on `${CLAUDE_PLUGIN_DATA}`**: prompts interactively and is denied in `-p`.
- **A permanent allow rule in the user's settings**: works across turns, but changes the user's global settings for one plugin, and `allowed-tools` already covers the need.
- **Reading `CLAUDE_PLUGIN_DATA` from the environment in scripts**: the variable is not set for skill-started commands.
- **Keeping remembered defaults in `.project/`**: they are per machine and span projects (owner, stack), so they belong in plugin data.
