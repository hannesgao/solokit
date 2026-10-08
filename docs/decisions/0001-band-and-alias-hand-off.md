---
id: "0001"
date: 2026-10-08
status: proposed
---

# Band and bare /solokit hand off with $.command.run

## Context

The action band (BAND-3, BAND-4) and the bare `/solokit` alias (ENT-4) are parts of a hooks module (mod). Both must start a plugin skill such as `/solokit:go` exactly as if the user had typed it. PRD 0.3.0 preferred `$.prompt.submit({ text, asUser: true })` and fell back to `$.prompt.fill` plus Enter, pending spike E1 (#1). Evidence: `spikes/e1-handoff/results/README.md`, Claude Code 2.1.294.

What the spike showed:

- `$.prompt.submit` with a text that starts with `/` is refused by the host, with or without `asUser`: "a text beginning with / would run a command as the user; run one with $.command.run({ command })".
- `$.command.run({ command: "<plugin>:<skill>", args })` from a Button's `onPress` expands the skill, passes `args` as `$ARGUMENTS` and starts the turn by itself.
- `$.prompt.fill` puts the command in the prompt; one Enter runs it with its arguments.
- A digit typed alone into the empty prompt presses the band Button whose `hotkey` is that digit (BAND-2 holds).
- Inside a mod command's own `command.run` hook, both `$.command.run` and `$.prompt.submit` are refused ("it would wait on the turn this hook is holding"). Scheduling the call with `$.clock.after` so that it runs after the hook has answered `{ text }` works: the skill expands and the turn starts.
- In a `-p` run no session is bound for the mod, and `$.command.run` is unavailable.

## Decision

1. A band action calls `$.command.run({ command: "solokit:<name>", args })` from the Button's `onPress`, without awaiting it. The Idea action does the same with `solokit:change` and the entered text as `args`.
2. The bare `/solokit` command answers its `command.run` hook with a one-line `{ text }`. It then hands off to `solokit:go`, passing its own arguments, through `$.clock.after(0–50 ms, …)` and `$.command.run`.
3. If `$.command.run` rejects, the mod falls back to `$.prompt.fill({ text: "/solokit:<name> <args>" })` and shows a toast saying that Enter runs it.
4. `$.prompt.submit` is never used for slash commands.
5. The band and the alias are interactive conveniences. Scripted and `-p` use goes through `/solokit:<command>` directly.

## Consequences

- One keypress (a click or a digit) runs the next command with no extra Enter. Gates are unaffected, because the command itself shows its preview and asks (CONVENTIONS, interaction rule 1).
- A turn started this way carries the prompt origin `{ kind: "plugin", name: "solokit" }`, not `human`. Nothing in solokit depends on the origin, and gates ask inside the skill regardless.
- The deferred hand-off depends on the host check staying as it is in 2.1.294. The `claude plugin test` cases for the band (M7) must cover the hand-off call and its fill fallback, so a platform change shows up in CI.
- BAND-4's text field (`Input` `onSubmit`) was not exercised in the spike. Its hand-off uses the same call and is verified in M7.

## Alternatives considered

- **`$.prompt.submit` with `asUser: true`**, as the PRD preferred: refused by the host for slash commands.
- **`$.prompt.fill` only**: works everywhere a prompt box exists, but costs an extra Enter on every action. Kept as the fallback.
- **Calling `$.command.run` directly inside the alias's `command.run` hook**: refused by the host.
- **Handing off from `turn.complete`**, as the host message suggests: a local command starts no turn, so there is no event to wait for. `$.clock.after` gives the same "after this dispatch" ordering.
