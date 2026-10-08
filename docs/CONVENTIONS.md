# solo-agent-coding-kit — Conventions v0.2

Oct 8, 2026 · @Yunhan Gao

## Principles

These conventions define how every project made with the kit is laid out and run; ideas studied in other plugins are re-implemented from scratch to fit them, never the reverse. Status: draft for review, decisions marked in the last section.

1. **The repo is the source of truth.** PRD, decisions, change requests and project state live as Markdown and JSON in the repo. GitHub Issues, milestones and any external doc are sync targets, rebuilt from the repo when in doubt.
2. **State lives in files, so every phase can resume.** Each phase reads what earlier phases wrote and records what it did. Re-running a phase is safe: it detects finished work and skips it.
3. **Deterministic work is code, judgement is a skill, rules are hooks and rulesets.** Repo creation and settings run as idempotent scripts; PRD writing and change analysis run as skills; ongoing discipline is enforced locally by hooks and remotely by GitHub rulesets, not by prose alone.
4. **Three human gates, no others.** PRD approval, applying remote repo settings, and merging a PR. Everything between gates runs without asking.
5. **No code without an issue, no scope change without a PRD change.** Ideas are welcome at any time, but they enter through the change flow.
6. **Solo defaults.** No setting may require a second human, such as a required PR approval.
7. **Small, readable, versioned.** The kit is one plugin with a version; projects record which kit version created them.
8. **Self-contained, built from scratch.** The kit depends on no other Claude Code plugin. Every skill, hook, agent and script is written for these conventions; other plugins may be read for ideas but are never installed as dependencies. The only external requirements are Node.js (built-in modules only, no npm packages) and the command-line tools `git` and `gh`.

## Lifecycle

A project moves through seven phases with three human gates; ideas that arrive mid-build re-enter through the change flow instead of going straight into code.

&#91;embedded content: project lifecycle · 7 phases, 3 gates, 1 change loop\]

The build loop repeats per issue until the milestone closes; release and retro run per milestone, and the retro's proposed kit edits are how this document evolves.

Two shortcuts join the flow later: `/solokit:prd import` brings in a PRD already written elsewhere (for example in Claude chat or Docs) and skips the kickoff, and `/solokit:bootstrap --repo owner/name` adopts an empty repo you created on GitHub instead of creating one.

## Repository layout

Every project gets the same skeleton: product documents under `docs/`, kit state under `.project/`, agent setup under `.claude/` and GitHub setup under `.github/`.

```text
<project>/
├── CLAUDE.md                      # local and gitignored; generated from the kit template; points to docs/ and states the rules
├── .gitignore                     # lists /CLAUDE.md and .project/local/
├── README.md
├── docs/
│   ├── kickoff.md                 # one-page project card (derived when a PRD is imported)
│   ├── PRD.md                     # the living PRD, with frontmatter and changelog
│   ├── ideas.md                   # parked ideas, one line each, not yet a change
│   ├── decisions/                 # ADRs: 0001-short-title.md
│   ├── changes/                   # change requests: CR-0001-short-title.md
│   ├── plans/                     # optional per-milestone plans
│   ├── retro/                     # retros: YYYY-MM-DD-milestone.md
│   └── archive/                   # untouched originals, e.g. prd-import-YYYY-MM-DD.md
├── .project/
│   ├── state.json                 # phase, gates, versions (committed)
│   └── local/                     # per-machine runtime state (gitignored)
├── .claude/
│   ├── settings.json              # permissions and hooks for this repo
│   └── agents/                    # project-specific subagents, if any
└── .github/
    ├── pull_request_template.md
    ├── ISSUE_TEMPLATE/            # feature.yml, bug.yml, change.yml
    ├── rulesets/main.json         # the applied ruleset, kept as code
    ├── dependabot.yml
    └── workflows/ci.yml           # the required status check
```

Rules for the layout:

- Only `docs/PRD.md` describes what the product should be. Other documents explain why it changed or what is next.
- `.project/state.json` is committed so a second machine or a cloud session can resume; anything machine-specific goes to `.project/local/`.
- Paths are fixed. Skills refer to them by these names, so a project never renames them.
- `CLAUDE.md` is per machine: bootstrap generates it from the kit's template, `/solokit:go` regenerates it when it is missing (a fresh clone, another machine), and `.gitignore` keeps it out of the repo. With the `hide_ai_attribution` option off, it is committed like any other file ([ADR 0004](decisions/0004-no-ai-attribution.md)).

## Project state file

`.project/state.json` records which phase the project is in, which gates have passed and which versions created it; every kit command reads it first and writes it last.

```json
{
  "schema": 1,
  "kit": { "name": "solo-agent-coding-kit", "version": "0.1.0" },
  "project": {
    "name": "pixel-pal",
    "repo": "owner/pixel-pal",
    "repo_source": "created",
    "visibility": "public",
    "language": "en",
    "stack": "flutter"
  },
  "phase": "build",
  "gates": {
    "prd_approved": { "at": "2026-10-08T12:00:00Z", "prd_version": "1.0.0" },
    "remote_applied": { "at": "2026-10-08T12:30:00Z", "ruleset_sha": "sha256:9e3f6f927eaff9c550bdb676fb5e35d9d23c001a4f2a2705b50a702b848e6b60" }
  },
  "prd": { "version": "1.1.0", "status": "approved", "source": "imported" },
  "counters": { "adr": 3, "cr": 2 },
  "steps": {
    "bootstrap.remote": "done",
    "bootstrap.local": "done",
    "plan.issues": "done"
  }
}
```

`repo_source` is `created` or `existing`; `prd.source` is `drafted` or `imported`. Both only record history; later phases behave the same either way.

**Rules**

- `phase` is one of `kickoff`, `prd`, `bootstrap`, `plan`, `build`, `release`, `retro`. The change flow does not change the phase; it runs alongside.
- A command refuses to start a phase whose gate has not passed, and says which gate is missing.
- Every step in `steps` is idempotent. A command checks reality first (does the repo exist, is the ruleset applied) and only then trusts `steps`.
- A step that fails is `"failed"` in `steps`, and `failures.<step>` holds its `reason`, the `recovery` to print and the time `at`. The rest of the file stays as it was before the step, and the entry is removed when the step later succeeds. The file is always written whole (temp file, then rename).
- `counters` hand out the next ADR and CR numbers, so numbers never collide.
- `.project/local/` holds per-machine data such as the active issue or a session note, and is gitignored.

## Documents

Five document types, each with a fixed home, a frontmatter block and a short required skeleton.

| Document | Path | Frontmatter | Required sections |
| --- | --- | --- | --- |
| Kickoff card | `docs/kickoff.md` | `date`, `status` | Problem, who it is for, what done looks like, constraints, first guess at scope, open questions |
| PRD | `docs/PRD.md` | `version`, `status` (`draft`, `approved`, `superseded`), `updated` | Summary, Goals and non-goals, Users, Core experience, Requirements (IDs and priority), Technical architecture, Testing, Milestones, Risks, Open questions, Changelog |
| ADR | `docs/decisions/NNNN-title.md` | `id`, `date`, `status` (`proposed`, `accepted`, `superseded by NNNN`) | Context, Decision, Consequences, Alternatives considered |
| Change request | `docs/changes/CR-NNNN-title.md` | `id`, `date`, `class`, `status` (`proposed`, `accepted`, `parked`, `rejected`, `done`), `prd_from`, `prd_to` | Idea, Class, Impact (PRD sections, architecture, milestones, tests, compliance), Decision, Follow-ups (issues, ADRs) |
| Retro | `docs/retro/YYYY-MM-DD-milestone.md` | `date`, `milestone` | What went well, what hurt, prompts typed by hand, changes to make in the kit |

**PRD rules**

- Requirement IDs are stable (`FR-12`, `DUO-3`). A removed requirement keeps its ID, marked removed, so issues and commits that cite it still resolve.
- Every change to an approved PRD bumps `version` and adds one Changelog line: date, version, what changed, and the CR or ADR that caused it.
- Long research and background live in the PRD's appendix or in ADRs, so the main body stays readable for Claude at the start of every session.

**Importing an existing PRD** (`/solokit:prd import`)

- Accepted sources: a Markdown file anywhere on disk, text pasted into the chat, or an export from Claude Docs or another tool. Markdown is preferred; other formats are converted to Markdown first.
- The original is kept unchanged in `docs/archive/prd-import-YYYY-MM-DD.md`, so you can always see what was imported.
- `docs/PRD.md` is the normalised copy: frontmatter added, sections mapped onto the required skeleton, existing requirement IDs kept and missing ones assigned. Nothing is invented: a required section with no content becomes an entry under Open questions.
- `docs/kickoff.md` is derived from the PRD summary and marked as derived.
- The imported PRD starts as `draft`; the PRD approval gate still applies, and approval sets version `1.0.0` unless the source already carries a version.

**ideas.md**: one line per idea with a date, no analysis. Turning an idea into a change request is a deliberate step.

**Language**: repo documents are written in one language per project, recorded in `state.json` (`language`). Default English; conversation with Claude can stay in any language.

## IDs, naming, labels, branches and commits

One naming scheme ties a commit back to its issue, its requirement and the PRD version.

| Thing | Convention | Example |
| --- | --- | --- |
| ADR | `NNNN`, 4 digits, from `counters.adr` | `0003-use-raster-for-sprites.md` |
| Change request | `CR-NNNN`, from `counters.cr` | `CR-0002-duo-pal-mode.md` |
| Requirement | Prefix + number, stable forever | `FR-7`, `DUO-5` |
| Milestone | `M<n> <name>` matching the PRD roadmap | `M1 MVP` |
| Branch | `<type>/<issue>-<slug>`, type is `feat`, `fix`, `chore`, `docs`, `refactor`, `test` | `feat/42-mood-rules-de` |
| Commit | Conventional Commits; body cites the requirement | `feat(mood): add German frustration rules` / `Refs: FR-11` |
| PR title | Same as the squash commit | `feat(mood): add German frustration rules (#42)` |
| PR body | Template: summary, requirement IDs, `Closes #42`, one line of verification result. It becomes the squash commit message, so the full test output and the review findings go in PR comments |  |
| Release tag | `vMAJOR.MINOR.PATCH` | `v0.3.0` |

**Labels** (created by bootstrap)

- `type:feature`, `type:bug`, `type:chore`, `type:docs`
- `priority:p0`, `priority:p1`, `priority:p2`
- `status:blocked`, `status:needs-decision`
- `review:waived` for PRs merged with a waived blocking review finding (never for security findings)
- `change` for issues born from a change request, plus `cr:CR-0002` per request

## GitHub defaults for a solo developer

The bootstrap script applies these with `gh` and keeps the ruleset as code in `.github/rulesets/main.json`; nothing here needs a second person. Spike E2 verified them on fresh public repos ([ADR 0003](decisions/0003-bootstrap-order-required-check-and-ci-template.md)).

**Order** (required): push the initial commit with `ci.yml` while no ruleset exists, wait for that push's `ci` run to pass, then apply the ruleset, merge options, labels and security settings. A ruleset that is active before the first push rejects that push.

**Ruleset on the default branch (`main`)**

| Rule | Setting | Why |
| --- | --- | --- |
| Require a pull request | On, **0 required approvals** | Every change has a PR and a record; GitHub does not let you approve your own PR, so any approval count locks you out |
| Required status checks | `ci` from GitHub Actions (`integration_id` 15368) must pass. Branch need not be up to date. Added only after the first `ci` run on `main` has passed. `ci.yml` never filters `pull_request` by path or branch, so the check always reports | The test suite is the reviewer that never gets tired. "Up to date" stays off: pushes to `main` run `ci` too, a release requires a green `main`, and Dependabot PRs would otherwise wait on a manual update after every merge |
| Block force pushes | On | History cannot be rewritten |
| Restrict deletions | On | `main` cannot be deleted |
| Linear history | On | Pairs with squash merge |
| Bypass list | Empty | The rule applies to you too; a hotfix still goes through a PR |

**Repository settings**

- Merge methods: squash only; the PR title becomes the commit title and the PR body the commit message.
- Delete branch on merge: on. Auto-merge: on, so a green PR can merge itself after you approve it in chat.
- Wiki and Projects: off unless asked.
- Default visibility: public; a project can opt into private at bootstrap.

**Security**

- Dependabot alerts and security updates: on, with `.github/dependabot.yml` for the project's ecosystems. Every ecosystem sets `commit-message: prefix: "chore(deps)"`, so Dependabot's PR titles pass the title check, and none uses `groups`, whose PR titles ignore the prefix.
- Secret scanning and push protection: on (free for public repositories, and already on for a new public repository).
- Private vulnerability reporting: on, so a security issue can be reported privately instead of in a public issue.
- CodeQL default setup: on. It needs one supported language; the workflow file alone counts as `actions`. Its checks are not required.

**CI workflow** (`.github/workflows/ci.yml`): triggers on `pull_request` (types `opened`, `synchronize`, `reopened`, `edited`) with no `paths` or `branches` filter, and on `push` to `main`. One job named `ci` checks out with full history, checks the PR title on pull requests, detects whether anything outside `docs/` changed, and guards install, lint, test and build with step-level `if:` on that result. A skipped workflow never reports `ci` and blocks the PR, so nothing is skipped above the step level.

**Private projects (opt-in)**: on a free personal account, rulesets and some security features may not be enforced for private repositories. If a project opts into private, the script reads what GitHub actually applied and reports any gap; the local hooks still block pushes to `main` either way.

**Using a repo you already created** (`/solokit:bootstrap --repo owner/name`)

- The kit checks that the repo exists, that you have admin rights, and that it has no history beyond what GitHub's creation form adds (README, LICENSE, `.gitignore`); those files are kept and merged into the skeleton.
- Visibility, description and other settings you chose are left as they are. The kit reports where they differ from the defaults above and changes them only if you say so.
- Everything else runs as for a new repo, behind the same remote gate: ruleset, labels, security settings, local skeleton.
- A repo that already contains a codebase is refused with an explanation; adopting existing code is a later feature.

## Claude Code setup

CLAUDE.md states the rules in a few lines; hooks and permissions enforce the ones that matter, so the rules hold even when the instructions are forgotten.

**CLAUDE.md skeleton** (under 60 lines; details live in `docs/`). The file is generated locally from this template and gitignored, so every machine regenerates it rather than sharing a copy.

```markdown
# <project>

<one-paragraph summary from the PRD>

## Read first
- docs/PRD.md (product, requirement IDs)
- .project/state.json (current phase)
- docs/decisions/ (why things are the way they are)

## Rules
- Work only on an issue branch: <type>/<issue>-<slug>. Never commit to main.
- No code without an issue. New idea? Add it to docs/ideas.md or run the change flow.
- Changing what the product does means changing docs/PRD.md first.
- Conventional Commits; cite requirement IDs (Refs: FR-12).
- Run the tests before opening a PR; one result line in the PR body, the full output as a PR comment.
- No AI attribution in commit messages, PR and issue titles, bodies and comments, or branch names: no Co-Authored-By trailers for an AI, no "Generated with" lines, no statements that the work was generated or assisted by AI or Claude. Technical names such as CLAUDE.md, .claude/, CLAUDE_* variables and claude commands are fine.

## Commands
<build, test, lint, run commands for this stack>
```

**Permissions baseline** (`.claude/settings.json`)

- Allow without asking: reading the repo, running the project's test, lint and build commands, `git status`, `git diff`, `git log`, `gh issue view`, `gh pr view`.
- Ask: `git push`, `gh pr create`, `gh pr merge`, package installs.
- Deny: force pushes, pushes to `main`, `rm -rf` outside the repo, reading `.env*` files.
- Attribution: `"attribution": { "commit": "", "pr": "", "sessionUrl": false }`, so Claude Code adds no commit trailer, pull request line or session link. The object form also works on versions older than v2.1.281, which reject `"attribution": false` and skip the whole file.

**Hooks shipped by the kit**

| Hook | Event | Does |
| --- | --- | --- |
| `guard-main` | `PreToolUse` on Bash | Blocks commits and pushes on `main`, and any force push |
| `issue-required` | `PreToolUse` on Edit and Write of source files | Warns when no issue branch is active |
| `prd-drift` | `Stop` | If the turn changed behaviour-facing code and `docs/PRD.md` did not change, reminds to check the change flow |
| `state-sync` | `SessionStart` | Prints the current phase, open gates and the active issue, so a new session starts oriented; says when `CLAUDE.md` is missing |
| `no-ai-attribution` | `PreToolUse` on Bash | Blocks AI attribution in commit messages, PR and issue texts (including `--body-file` files) and branch-name segments `claude`, `anthropic`, `ai` |

**Build-phase skills and agents** (all written in-house; no third-party plugin)

| Name | Kind | Does |
| --- | --- | --- |
| `issue-plan` | Skill, run by `/solokit:next` | Before any code, writes a short plan into the issue: files to touch, tests to add, requirement IDs. Asks only when the issue is ambiguous |
| `test-first` | Skill | Adds or updates a failing test for the requirement, then implements until it passes; skipped for `docs` and `chore` work |
| `verify` | Skill, run by `/solokit:verify` | Runs the project's test, lint and build commands; never reports work as done without that output, and saves it as evidence for the PR |
| `reviewer` | Subagent | Reviews the diff in a fresh context against the PRD and the issue: requirement coverage, tests, risks, findings by severity |
| `pr` | Skill, run by `/solokit:pr` | Opens the PR from the template with `Closes #n`, requirement IDs and a one-line verification result, then posts the full evidence and the review as PR comments; turns on auto-merge only after your OK |

## Change request flow

Any new idea is first classified; the class decides how much paperwork it needs, so a typo fix stays cheap and a pivot cannot slip in quietly.

| Class | Test | Artifacts | PRD | Who decides |
| --- | --- | --- | --- | --- |
| Bug | The product does not do what the PRD says | Issue (`type:bug`) | No change | Claude may start right away |
| Tweak | Same requirement, different detail (copy, threshold, layout) | Issue + one Changelog line | Patch bump | Claude proposes, you confirm in chat |
| Feature | A new or removed requirement, same product direction | `CR-NNNN` + new requirement IDs + issues in a milestone | Minor bump | You, at the CR decision |
| Pivot | Changes goals, users, architecture or compliance position | `CR-NNNN` + ADR + re-plan of milestones | Major bump | You, at the CR decision |
| Parked | Interesting, not now | One line in `docs/ideas.md` | No change | Anyone; no gate |

**Steps for a feature or pivot**

1. Capture the idea in the user's words in a new `CR-NNNN` with status `proposed`.
2. Impact analysis: which PRD sections and requirement IDs, which milestones, which tests, any compliance or cost change.
3. Decision by you: `accepted`, `parked` or `rejected`, with one sentence of reasoning.
4. If accepted: update `docs/PRD.md`, bump its version, add the Changelog line citing the CR; write an ADR for a pivot; create the issues with label `cr:CR-NNNN`.
5. Set the CR to `done` when its issues close.

Work in progress is not interrupted: the current issue finishes or is paused with a note before the change starts.

## Versioning

Three independent version numbers, each with one owner.

| What | Format | Bumped when |
| --- | --- | --- |
| PRD (`docs/PRD.md` frontmatter) | `MAJOR.MINOR.PATCH` | Patch: tweak or wording. Minor: feature added or removed. Major: pivot. First approved PRD is `1.0.0`; drafts are `0.x` |
| Product (tags, release notes) | SemVer `vX.Y.Z`, starting at `v0.1.0` | At release; minor per milestone before `v1.0.0` |
| Kit (`plugin.json`) | SemVer | Every kit change; projects record the kit version in `state.json` |

When a newer kit meets an older project, the kit reads `state.json.schema` and migrates the state file before doing anything else.

## Kit command surface

One command per phase plus helpers; each is a skill that reads `state.json` first. Commands are namespaced by the plugin's short name `solokit`, so they appear as `/solokit:<command>`.

| Command | Phase | Reads | Writes | Gate |
| --- | --- | --- | --- | --- |
| `/solokit:go` (bare `/solokit` via the action band) | any | `state.json`, open issues | Nothing; offers the 2–4 most likely next actions and runs the one you pick | Whatever the picked action needs |
| `/solokit:kickoff` | kickoff | Conversation | `docs/kickoff.md`, `state.json` | None |
| `/solokit:prd` | prd | `docs/kickoff.md` | `docs/PRD.md` (draft) | Ends at **PRD approval** |
| `/solokit:prd import <path>` | prd | An existing PRD: a file path or text pasted in chat | `docs/PRD.md` (normalised draft), `docs/archive/prd-import-…md`, derived `docs/kickoff.md` | Ends at **PRD approval** |
| `/solokit:bootstrap` | bootstrap | `state.json`, PRD summary | New remote repo under the chosen owner, ruleset, labels, local skeleton, CLAUDE.md, `.claude/`, `.github/` | Pauses before applying remote settings (**remote gate**) |
| `/solokit:bootstrap --repo owner/name` | bootstrap | An empty repo you created | Same as above, without creating the repo | **Remote gate** |
| `/solokit:plan` | plan | PRD requirements and milestones | Milestones and issues on GitHub, optional `docs/plans/` | None |
| `/solokit:next` | build | Open issues, `state.json` | Branch for the next issue, plan in the issue, `.project/local/active.json` | None |
| `/solokit:verify` | build | Changed files, project commands | Test, lint and build evidence in `.project/local/` | None |
| `/solokit:pr` | build | Active issue, verify evidence | PR on GitHub, reviewer findings | **Merge** stays yours |
| `/solokit:change` | any | Idea text, PRD | `ideas.md`, or a CR, PRD bump, ADR, issues | **CR decision** for feature and pivot |
| `/solokit:release` | release | Closed milestone | Tag, release notes, PRD milestone status | None |
| `/solokit:retro` | retro | Milestone history, retro notes | `docs/retro/…`, proposed edits to the kit itself | None |
| `/solokit:status` | any | Everything | Nothing | None |

`/solokit:status` prints phase, gates, PRD version, open CRs, the active issue and the next suggested command.

## Interaction model

Commands are the underlying interface; three interaction layers sit on top so that day-to-day use needs almost no typing, while scripted and unattended runs keep working through the commands.

| Layer | What it is | Ships in |
| --- | --- | --- |
| 1. Commands that ask | Every command asks for what it needs with Claude Code's multiple-choice question UI instead of requiring flags. Flags such as `--repo` and `import` remain as shortcuts | v1 |
| 2. One entry point | `/solokit:go` reads `state.json` and offers the 2–4 most likely next actions, recommended one first; in most moments the whole interaction is `/solokit:go` and Enter | v1 |
| 3. Action band | An optional mod in the same plugin draws a band above the prompt with the phase, the active issue and numbered actions. A digit typed alone into the empty prompt presses the matching button, which runs the command directly; an Idea button opens a text field that feeds the change flow ([ADR 0001](decisions/0001-band-and-alias-hand-off.md)) | After the core flow works; needs Claude Code v2.1.287+ |

Examples of what layer 1 asks:

- `/solokit:bootstrap`: new repo or an existing empty one; owner (last answer preselected); stack for the CI template; visibility (public preselected).
- `/solokit:prd`: draft from the kickoff, or import an existing PRD (path or paste).
- `/solokit:change`: the idea in one sentence, then the class the kit proposes, for you to confirm.

Layer 3, as it would look in the build phase:

```text
build · #42 mood-rules-de · PRD 1.1.0      [1] Next  [2] Verify  [3] PR  [4] Idea
```

Plain language also works without any command: each skill's description lets Claude Code start it when you say, for example, "I have a new idea for an export feature".

**Which option comes first** (CORE-2). The first option is the one a question preselects, so it is chosen by a fixed precedence and names its source:

1. a command-line flag;
2. evidence in the project itself, such as a stack detected from the PRD or the folder name as repo name;
3. a value set in `userConfig`;
4. the last answer used, marked "(last used)";
5. the built-in default.

Only preference questions remember answers: owner, visibility, language, and stack (only when none is detected). Judgement questions (change class, next action, version, release confirmation) are never remembered and put the computed recommendation first. Gate confirmations (PRD approval, remote gate, merge, CR decision) are never remembered, so no earlier answer stands in for the current decision. When the kit's checks have passed, the option that passes the gate may come first, marked "(Recommended)", as release does (REL-2). What protects a gate is the full preview shown before the question, stopping when the question goes unanswered, and never remembering its answer. When a question auto-continues unanswered, an ordinary question takes its first option and a gate stops (CORE-3).

**Two rules the interaction layers never break**

1. **Gates stay explicit.** Before PRD approval, applying remote settings or merging, the kit shows exactly what will happen (for example the ruleset diff) and waits for a confirmation. A hotkey, a remembered answer or an unanswered question never passes a gate on its own; only the user's answer to the question after the preview does.
2. **Unattended runs fall back.** When nobody can answer (`claude -p`, scheduled tasks), the multiple-choice tool is absent; a command uses its flags or the remembered defaults, or stops and states what it needs. It never guesses past a gate.

## Decisions

All ten choices were decided on 8 Oct 2026. Status shows whether the recommended default was accepted or changed.

| # | Question | Decision | Status |
| --- | --- | --- | --- |
| 1 | Short plugin name | `solokit`; commands appear as `/solokit:<command>`, `displayName` "solo-agent-coding-kit" | Accept default |
| 2 | Language of repo documents | English, overridable per project | Accept default |
| 3 | Default repo visibility | Public; a project can opt into private at bootstrap | Changed |
| 4 | Where the remote repo comes from | Two modes. New repo: ask for the owner at bootstrap and remember the last answer as default. Existing empty repo: `--repo owner/name`; the kit checks it is empty and only configures it | Changed |
| 5 | Build-phase discipline (plans, TDD, verification) | Built from scratch as kit skills (`issue-plan`, `test-first`, `verify`, `reviewer`, `pr`); no plugin dependencies | Changed |
| 6 | Where tasks live | GitHub Issues and milestones only; no extra tracker | Accept default |
| 7 | Where the PRD comes from | Two modes. Draft with `/solokit:prd` directly in `docs/PRD.md`, or import a PRD written elsewhere (file or paste) with `/solokit:prd import`. Either way the repo copy is the only source of truth | Changed |
| 8 | CI templates shipped first | Flutter, Node/TypeScript, Python, PHP; stack chosen at bootstrap | Accept default |
| 9 | Rulesets on plans that cannot enforce them | Not an issue by default because repos are public; for an opt-in private repo, continue with local hooks and report the gap | Changed |
| 10 | Conventional Commits enforcement | A CI check on the PR title only, written as a few lines of shell (squash makes the title the commit) | Accept default |
