---
id: "0004"
date: 2026-10-08
status: accepted
---

# No AI attribution in published project history by default

## Context

The owner publishes projects under their own name. Claude Code adds attribution by default: a `Co-Authored-By` trailer on commits, a "Generated with Claude Code" line in PR descriptions, and a session link from cloud sessions (settings reference, `attribution`). A rule in `CLAUDE.md` takes precedence over these lines, but it is a soft rule, and a committed `CLAUDE.md` shows how the project is built. The owner wants no AI attribution in commit messages, PR and issue texts or branch names. This repo's history was checked on 8 Oct 2026, and no commit, PR, issue or comment carried such attribution.

These projects are about Claude Code itself, so technical names (`CLAUDE.md`, `.claude/`, `CLAUDE_*` variables, `claude` commands) appear in normal text. A word ban would block ordinary work, so the target is attribution, not names.

## Decision

Under the plugin option `hide_ai_attribution` (default on), three layers apply:

1. **Instructions**: `CLAUDE.md` is generated from the kit template, carries a rule against AI attribution that names the allowed technical terms, and is gitignored. `/solokit:go` regenerates it when it is missing (BST-12, ENT-5).
2. **Settings**: the project's `.claude/settings.json` sets `"attribution": { "commit": "", "pr": "", "sessionUrl": false }` (BST-13). The settings reference says: "To hide all attribution, set `attribution` to `false`. In a settings file that earlier versions also read, set `commit` and `pr` to empty strings and `sessionUrl` to `false` instead." It also says `false` "requires Claude Code v2.1.281 or later; earlier versions reject it and skip the whole user, project, or local settings file that holds it". A project file is read by whatever version a machine runs, so the object form is used.
3. **Hook**: `no-ai-attribution` (HOOK-6) blocks attribution in `git commit` messages, `gh pr` and `gh issue` texts (including body files), and branch names whose `/ - _ .` segments equal `claude`, `anthropic` or `ai`.

With the option off, none of the three applies, and `CLAUDE.md` is committed as before.

## Consequences

- A fresh clone, another machine or a cloud session starts without `CLAUDE.md` until `/solokit:go` regenerates it. `state-sync` says so, and hooks and settings keep enforcing the important rules meanwhile.
- `CLAUDE.md` can no longer carry project-specific edits that travel with the repo. Project facts it needs (stack, language) live in `state.json`, and the rest comes from the PRD and the template.
- The hook matches patterns, not intent, so a statement phrased in an unforeseen way can pass. The settings layer covers the automatic lines, which are the common case.

## Alternatives considered

- **`"attribution": false`**: shorter, but older Claude Code versions skip the whole settings file, deny rules included.
- **A ban on the words Claude, Claude Code and Anthropic**: blocks normal technical text in a Claude Code plugin project.
- **Branch-name substring matching**: would block `maintain`, `email` and `detail`.
- **Committing `CLAUDE.md` with the rule**: simpler, but publishes how the project is built, which is what the owner wants to avoid.
