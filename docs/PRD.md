---
version: 0.5.0
status: draft
updated: 2026-10-08
---

# solokit — PRD

Oct 8, 2026 · @Yunhan Gao

## Summary

solokit is a self-built Claude Code plugin that runs a solo agent-coding project from idea to release: kickoff, PRD, GitHub repo and rules, issue-driven building, mid-project changes, release and retro. It replaces the setup prompts typed by hand at the start of every project with interactive commands that follow one set of conventions.

- **Version** 0.5.0, **status** draft. The whole command set ships together as 1.0; nothing is deferred to a later version.
- **Conventions** are defined in solo-agent-coding-kit — Conventions v0.2; this PRD specifies the plugin that implements them and does not repeat them.
- **Scope**: personal use, built from scratch, no dependency on any other Claude Code plugin. External requirements: Node.js (built-in modules only, no npm packages), `git` and `gh`.
- **Display name** solo-agent-coding-kit; **plugin name** `solokit`; commands appear as `/solokit:<command>`.

## Goals and non-goals

**Goals**

1. Start a new project, from kickoff to a configured repo with issues, in one session and without typing setup prompts.
2. Make the right next step obvious at any moment: one entry point that knows the project's phase.
3. Keep PRD, issues and code aligned when ideas arrive mid-project, through a change flow that is cheap for small tweaks and strict for pivots.
4. Enforce the important rules by tooling (hooks, rulesets, CI), not by memory.
5. Improve itself: every retro produces concrete edits to the kit.

**Non-goals**

- Supporting teams, multiple reviewers or approval workflows that need a second person.
- Adopting existing codebases (brownfield). The kit only starts new projects or empty repos.
- Trackers other than GitHub Issues; hosts other than GitHub.
- Agents other than Claude Code.
- Publishing to any marketplace or directory; the kit is for personal use.

## User and scenarios

The only user is the author: a solo developer who builds side projects with Claude Code, across stacks such as Flutter, Node/TypeScript, Python and PHP, and who usually shapes ideas and PRDs in Claude chat before coding.

| # | Scenario | Starts with |
| --- | --- | --- |
| S1 | Fresh idea, nothing written yet | `/solokit:go` in an empty folder, then kickoff and PRD drafting |
| S2 | PRD already written in Claude chat or Docs | `/solokit:prd import` with a file or pasted text |
| S3 | Empty repo already created on GitHub | `/solokit:bootstrap --repo owner/name` |
| S4 | Daily work on an existing solokit project | `/solokit:go`, or a digit on the action band |
| S5 | A new idea in the middle of a milestone | "I have an idea…" in plain language, or `/solokit:change` |
| S6 | Milestone done | `/solokit:release`, then `/solokit:retro` |
| S7 | Coming back after two weeks, or on another machine | `/solokit:status` |

## Core experience

A typical project, start to first release, takes a handful of choices and three confirmations from the user; everything else is the kit's job.

1. **Kickoff.** In an empty folder the user runs `/solokit:go`. The kit sees no project, asks whether to start from an idea or import a PRD, and for an idea runs a short interview that ends in `docs/kickoff.md`.
2. **PRD.** The kit drafts `docs/PRD.md` from the kickoff, section by section, asking only where the kickoff is silent. The user iterates in conversation, then approves: **gate 1**.
3. **Bootstrap.** The kit asks new or existing repo, owner and stack, then shows everything it will create and configure: repo, ruleset, labels, security settings, files. The user confirms: **gate 2**. The kit creates the repo, pushes the skeleton and reads back what GitHub applied.
4. **Plan.** The kit turns the PRD's milestones and requirements into GitHub milestones and issues, shows the list, and creates them.
5. **Build loop.** `/solokit:go` suggests the next issue; the kit branches, writes a short plan into the issue, implements test-first, verifies, gets a fresh-context review and opens the PR. The user merges: **gate 3**. Repeat.
6. **Change.** Mid-loop the user says "what if it also exported to CSV". The kit classifies it, analyses impact, and for a feature asks the user to accept, park or reject, then updates the PRD, adds issues and returns to the loop.
7. **Release and retro.** When the milestone's issues are closed the kit tags a release with notes built from the merged PR titles, then runs a retro that ends in proposed edits to solokit itself.

## Requirements: shared behaviour, entry point and status

Every requirement in this PRD ships in 1.0. IDs are stable; the prefix names the area. Priority orders work inside a milestone: **p0** is the main path to the milestone's done criterion, **p1** guards and robustness (drift warnings, `--dry-run`, migrations, Windows), **p2** conveniences.

**Shared behaviour (all commands)**

| ID | Priority | Requirement |
| --- | --- | --- |
| CORE-1 | p0 | Read `.project/state.json` first and write it last. If its `schema` is older than the kit's, migrate it before anything else and report the migration. |
| CORE-2 | p0 | Ask for missing inputs with Claude Code's multiple-choice questions (AskUserQuestion): at most one round per step of one to four questions, each with two to four options plus the automatic Other; the recommended option first, remembered answers preselected. A choice with more than four options shows the four most likely and takes the rest through Other, or is split into two steps. Every question has a flag that supplies the same input. Questions are asked inside the turn that invoked the command, so the skill's pre-approved script calls stay approved after the answer (ADR 0002). |
| CORE-3 | p1 | Every command can run to completion from arguments, flags and remembered defaults alone, because multiple-choice questions are unavailable in some runs: AskUserQuestion is absent from every `claude -p` run without a permission host, whatever the permission mode or `--permission-prompts` value (ADR 0002). When the tool is absent, take flags first, then remembered defaults; an ordinary step with neither takes the recommended option, and a gate stops and lists exactly what is needed. A question that auto-continues unanswered (`askUserQuestionTimeout`) counts as no answer in the same way. Never pass a gate unattended. |
| CORE-4 | p0 | Be idempotent: check the real state (files, git, GitHub) before each step; a finished step is reported as done and skipped. |
| CORE-5 | p0 | Gate protocol: show a concrete preview of what will happen (files, API calls, diffs), wait for an explicit yes, and record the gate with a timestamp in `state.json`. |
| CORE-6 | p2 | End with a one-line result and the suggested next command. |
| CORE-7 | p0 | On failure, never leave half-written files or state: mark the step `failed` with the reason and print how to recover. |
| CORE-8 | p2 | Write repo documents in the project language (`state.json`, default English); talk to the user in the user's language. |

**Entry point `/solokit:go`**

| ID | Priority | Requirement |
| --- | --- | --- |
| ENT-1 | p0 | Outside a solokit project, offer: start from an idea (kickoff), or import an existing PRD. |
| ENT-2 | p0 | Inside a project, offer two to four next actions chosen from the phase, recommended one first, and run the chosen command. |
| ENT-3 | p0 | Choose the recommendation from state, for example: uncommitted changes on an issue branch suggest verify; verified changes suggest PR; no active issue suggests next; all milestone issues closed suggests release. |
| ENT-4 | p2 | The action band mod also registers a bare `/solokit` command, because plugin skills are always namespaced. Its hook answers with one line and then, once the hook has returned (`$.clock.after`), runs `$.command.run({ command: "solokit:go", args })` with its own arguments; if that call is refused it puts `/solokit:go <args>` in the prompt (`$.prompt.fill`) for one Enter (ADR 0001). Interactive sessions only; absent when the band is off or Claude Code is older than v2.1.287. |
| ENT-5 | p0 | When a bootstrapped project has no `CLAUDE.md` (a fresh clone, another machine, a cloud session), `state-sync` (HOOK-4) says so in one of its lines, and `/solokit:go` offers to regenerate it as the recommended action. It regenerates from `templates/project/CLAUDE.md`, the project facts and `stack` in `state.json` and the PRD summary, checks that `.gitignore` lists it, and writes nothing else. This keeps S7 working on a new machine. Applies only while `hide_ai_attribution` is on (BST-12). |

**Status `/solokit:status`**

| ID | Priority | Requirement |
| --- | --- | --- |
| STA-1 | p0 | Print phase, gates passed and pending, PRD version and status, open change requests, milestone progress (closed of total issues), active issue and branch, and the kit version that created the project versus the installed one. |
| STA-2 | p1 | Warn about drift: GitHub's applied ruleset differs from `.github/rulesets/main.json` (compared as the intent view of BST-8), an issue in `state.json` no longer exists, PRD changed without a Changelog line. |
| STA-3 | p1 | Read-only. Without network, show local information and mark GitHub-derived parts as unavailable. |

## Requirements: kickoff and PRD

The PRD can be drafted from a kickoff interview or imported from elsewhere; both paths end at the same approval gate.

**Kickoff `/solokit:kickoff`**

| ID | Priority | Requirement |
| --- | --- | --- |
| KCK-1 | p0 | Run an interview of at most three question rounds covering problem, intended user, what done looks like, constraints (time, stack, budget, compliance) and a first guess at scope. Offer concrete suggestions as options; free text is always possible. |
| KCK-2 | p0 | Write `docs/kickoff.md` with frontmatter and the required sections; create `.project/state.json` with phase `prd`. |
| KCK-3 | p0 | If the folder is not a git repo, initialise one with default branch `main` and commit the kickoff, so documents are versioned before any remote exists. |

**Draft `/solokit:prd`**

| ID | Priority | Requirement |
| --- | --- | --- |
| PRD-1 | p0 | Draft `docs/PRD.md` from the kickoff, following the required PRD skeleton, section by section; ask only for facts the kickoff does not give. |
| PRD-2 | p0 | Give every requirement a stable ID with an area prefix and a priority, and assign it to a milestone. |
| PRD-3 | p0 | Require at least one milestone and a Testing section; `/solokit:plan` depends on both. |
| PRD-4 | p1 | `/solokit:prd check` validates the PRD: skeleton complete, IDs unique, every requirement in a milestone, Open questions listed. Approval runs it first. |
| PRD-5 | p0 | Approval (**gate 1**): show the check result and a one-screen summary; on yes set `status: approved` and version `1.0.0`, add the Changelog line, record the gate and commit `docs: approve PRD v1.0.0`. |
| PRD-6 | p1 | After approval, `docs/PRD.md` changes only through the change flow; direct edits trigger the drift warning. |

**Import `/solokit:prd import`**

| ID | Priority | Requirement |
| --- | --- | --- |
| IMP-1 | p0 | Accept a file path (Markdown or plain text; other formats are converted to Markdown first) or text pasted into the chat. |
| IMP-2 | p1 | Store the original unchanged in `docs/archive/prd-import-YYYY-MM-DD.md`. |
| IMP-3 | p0 | Normalise into `docs/PRD.md`: map headings to the skeleton by meaning, keep existing requirement IDs, assign missing ones, and turn empty required sections into Open questions. Never invent content. Show a mapping report (source heading to target section). |
| IMP-4 | p0 | Derive `docs/kickoff.md`, marked as derived; set `prd.source: imported`, phase `prd`, status `draft`. |
| IMP-5 | p2 | If the source language differs from the project language, ask whether to keep or translate; translation keeps IDs, and the original stays in the archive. |
| IMP-6 | p0 | Approval is the same gate as PRD-5; an imported PRD that already carries a version keeps it. |

## Requirements: bootstrap

`/solokit:bootstrap` turns an approved PRD into a configured GitHub repo and local skeleton, for a new repo or an empty one the user already created.

| ID | Priority | Requirement |
| --- | --- | --- |
| BST-1 | p1 | Preconditions: PRD approved, `git` installed, `gh` authenticated with rights to create and administer repos. Report each missing one with the command that fixes it. |
| BST-2 | p0 | Ask: new or existing empty repo; owner (last answer preselected); repo name (folder name preselected); visibility (public preselected); stack for CI (detected from the PRD's architecture section and preselected). Flags: `--repo`, `--owner`, `--name`, `--private`, `--stack`. |
| BST-3 | p0 | New repo: create it with `gh` using the PRD summary as description and the chosen visibility, without GitHub's auto-generated files. |
| BST-4 | p0 | Existing repo (`--repo owner/name`): verify it exists, the user has admin rights, and it holds nothing beyond GitHub's creation-form files (README, LICENSE, `.gitignore`); merge those into the skeleton. Report settings that differ from the defaults and change them only on a yes. Refuse a repo with existing code. |
| BST-5 | p0 | Build the local skeleton from the conventions: folders, `CLAUDE.md` (PRD summary, rules, stack commands; local, see BST-12), `README.md`, stack `.gitignore`, `.claude/settings.json`, `.github/` templates, `rulesets/main.json`, `dependabot.yml` for the detected ecosystems, `workflows/ci.yml`. |
| BST-6 | p0 | Remote gate (**gate 2**): preview the repo to create or adopt, every setting, the ruleset JSON, labels, security switches and the file list; apply only on a yes. |
| BST-7 | p0 | Apply in this order, which is required (ADR 0003): push the initial commit, including `.github/workflows/ci.yml`, to `main` while no ruleset exists; wait until that push's `ci` run passes, and stop with the step `failed` if it does not; create the ruleset that requires `ci` (without requiring an up-to-date branch); set merge options (squash only with the PR title and body as the commit, delete branch on merge, auto-merge allowed, wiki and projects off) in one repository update; create labels; enable Dependabot alerts and security updates, secret scanning with push protection, and CodeQL default setup. A ruleset that is active before the first push rejects that push (`Required status check "ci" is expected`), even though the API accepts a check that has never run. |
| BST-8 | p0 | Read back what GitHub applied (ruleset, merge options, each security setting) and compare it with the intent; report every gap. For the ruleset, compare the intent view: the top-level `name`, `target`, `enforcement`, `conditions` and `bypass_actors`, and for each rule type the intent sends only the parameter keys it sends, keys sorted and rules ordered by type. Keys GitHub adds (ids, links, timestamps, defaulted parameters such as `required_reviewers` and `require_extra_approval_for_unattributed_changes`) are listed as information, never as gaps. Store `sha256:` plus the hex digest of the view's canonical JSON as `gates.remote_applied.ruleset_sha` in `state.json` (ADR 0003). |
| BST-9 | p0 | CI templates for Flutter, Node/TypeScript, Python, PHP and a generic fallback. Each defines one job named `ci`: checkout with full history; a pull-request-only step that checks the PR title against Conventional Commits in a few lines of shell; a change-detection step that reports whether anything outside `docs/` changed; then install, lint, test and build steps guarded by step-level `if:` on that output. The workflow triggers on `pull_request` (types `opened`, `synchronize`, `reopened`, `edited`, so a fixed title is re-checked) with no `paths` or `branches` filter, and on `push` to `main`. A filtered-out workflow never reports `ci` and blocks the PR for good, so skipping happens only inside the job (ADR 0003). The required check is `ci` from GitHub Actions (`integration_id` 15368). |
| BST-10 | p0 | The skeleton's first CI run must pass (templates include a placeholder test), so the first real PR is not blocked. |
| BST-11 | p1 | `--dry-run` prints every command and file without executing or writing anything. |
| BST-12 | p0 | `CLAUDE.md` is a local file. BST-5 generates it from `templates/project/CLAUDE.md`, whose baseline includes the rule against AI attribution (ADR 0004), and adds `/CLAUDE.md` (the root file only, so templates named `CLAUDE.md` stay tracked) to the project's `.gitignore`, so it is never committed. With `hide_ai_attribution` off, the template leaves the rule out and `CLAUDE.md` is committed like any other file. |
| BST-13 | p0 | Write `"attribution": { "commit": "", "pr": "", "sessionUrl": false }` into the project's `.claude/settings.json`, so Claude Code adds no commit trailer, pull request line or session link. Use the object form rather than `"attribution": false`: Claude Code before v2.1.281 rejects `false` and skips the whole settings file that holds it, permission rules included (ADR 0004). Not written when `hide_ai_attribution` is off. |

## Requirements: plan and build loop

Planning turns the PRD into GitHub milestones and issues; the build loop takes one issue at a time from branch to an open PR.

**Plan `/solokit:plan`**

| ID | Priority | Requirement |
| --- | --- | --- |
| PLN-1 | p0 | Create one GitHub milestone per PRD milestone, titled `M<n> <name>`, with the PRD's description. |
| PLN-2 | p0 | Propose issues from requirements: one per requirement by default, small related requirements grouped. Each issue carries the requirement IDs, PRD version, acceptance criteria taken from the PRD, type and priority labels, and its milestone. |
| PLN-3 | p0 | Show the full list before creating anything; mark each created issue with a hidden marker (`<!-- solokit:req=FR-12 -->`) so a re-run never duplicates. |
| PLN-4 | p1 | After a PRD change, re-plan only the requirement IDs that changed: add issues for new ones, close issues for removed ones with a link to the change request. |

**Next `/solokit:next`**

| ID | Priority | Requirement |
| --- | --- | --- |
| NXT-1 | p0 | Pick the next issue: open, in the current milestone, not `status:blocked`, highest priority, then lowest number. Offer the top four to choose from. |
| NXT-2 | p1 | If the working tree has uncommitted changes, offer to commit them, stash them or stop. |
| NXT-3 | p0 | Create the branch `<type>/<number>-<slug>` from an up-to-date `main` and write `.project/local/active.json`. |
| NXT-4 | p0 | `issue-plan`: post a plan comment on the issue with files to touch, tests to add, requirement IDs and risks; ask the user only when the issue is ambiguous. |
| NXT-5 | p0 | `test-first`: for features and bugs, write or update a failing test, then implement until it passes; commit with Conventional Commits and `Refs:` lines. Docs and chore issues skip the test step. |

**Verify `/solokit:verify`**

| ID | Priority | Requirement |
| --- | --- | --- |
| VER-1 | p0 | Run the project's test, lint and build commands (from `CLAUDE.md`) and save the output with timestamp and commit hash to `.project/local/verify/<issue>.md`. |
| VER-2 | p0 | Never report work as done without passing output; on failure, summarise the first failure and propose a fix. |
| VER-3 | p0 | Evidence is valid only for the commit it was produced on; new commits require a new run. |

**Pull request `/solokit:pr`**

| ID | Priority | Requirement |
| --- | --- | --- |
| PR-1 | p0 | Require valid verify evidence for the current commit; run verify first if it is missing. |
| PR-2 | p0 | Run the `reviewer` agent and show findings by severity. Blocking findings are fixed, or waived with a reason that goes into the PR body together with the label review:waived. Security findings (secrets, injection, unsafe input handling) can never be waived. |
| PR-3 | p0 | Push the branch and open the PR from the template: a Conventional Commits title, and a body that holds only the summary, the requirement IDs, `Closes #n` and one line of verification result, because the body becomes the squash commit message. Then post the full verify output and the review summary as PR comments. |
| PR-4 | p0 | Merge (**gate 3**): ask whether to enable auto-merge; never merge or enable auto-merge without a yes. |
| PR-5 | p2 | After the merge: switch to `main`, pull, delete the local branch, clear `active.json` and suggest the next action. |

## Requirements: change flow

`/solokit:change` turns an idea into the right amount of paperwork for its class and never edits code itself.

| ID | Priority | Requirement |
| --- | --- | --- |
| CHG-1 | p0 | Start from the command, from plain language (the skill's description matches phrases such as "I have an idea", "what if", "let's also"), or from the action band's Idea button. |
| CHG-2 | p0 | Record the idea in the user's words, propose a class (bug, tweak, feature, pivot or parked) with a one-sentence reason, and let the user confirm or change it. |
| CHG-3 | p0 | Bug: create a `type:bug` issue in the current milestone; the PRD does not change. |
| CHG-4 | p0 | Tweak: create an issue, add one Changelog line and bump the PRD patch version after the user confirms the wording. |
| CHG-5 | p0 | Feature or pivot: create `CR-NNNN` with status `proposed` and an impact analysis covering affected requirement IDs and PRD sections, milestones, tests, and any cost or compliance change. A pivot also gets a draft ADR. |
| CHG-6 | p0 | CR decision (gate): accept, park or reject, each with one sentence of reasoning. Park adds a line to `docs/ideas.md`; reject closes the CR. |
| CHG-7 | p0 | Accept: update the PRD (new, changed or removed requirement IDs), bump minor or major, add the Changelog line citing the CR, and finalise the ADR for a pivot. After bootstrap these edits go through a `docs/change-CR-NNNN` branch and PR, because `main` is protected; before bootstrap they are committed locally. |
| CHG-8 | p0 | Then re-plan only the affected requirements (PLN-4) with label `cr:CR-NNNN`. The CR becomes `done` when all its issues are closed. |
| CHG-9 | p1 | Protect work in progress: with uncommitted changes on an issue branch, offer to commit or stash first. |
| CHG-10 | p2 | `/solokit:change --ideas` lists the parked ideas so they can be promoted, typically during a retro. |

## Requirements: release and retro

Each milestone ends with a tagged release and a retro whose output improves both the project and solokit itself.

**Release `/solokit:release`**

| ID | Priority | Requirement |
| --- | --- | --- |
| REL-1 | p1 | Preconditions: every issue in the milestone is closed, or the user confirms moving the rest to the next milestone; CI on `main` is green. |
| REL-2 | p0 | Propose the version from Conventional Commits since the last tag (breaking: major from 1.0 on, minor before; `feat`: minor; `fix`: patch) and ask a single question that shows the full release notes (REL-3) with four options: release with the proposed version (recommended), use another version, edit the notes first, or cancel. This question is the only release confirmation. |
| REL-3 | p0 | Generate release notes from merged PR titles grouped by type, with requirement IDs, change requests and a link to the milestone. |
| REL-4 | p0 | Create the tag and GitHub release on `main`, close the milestone, mark it done in the PRD through a docs PR, and set the phase to `retro`. |

**Retro `/solokit:retro`**

| ID | Priority | Requirement |
| --- | --- | --- |
| RET-1 | p0 | Collect the facts: milestone duration, issues and PRs, CI failures, change requests by class, and time from issue opened to PR merged, and reviewer waivers. |
| RET-2 | p0 | Ask at most two rounds of questions: what went well, what hurt, and which prompts had to be typed by hand. |
| RET-3 | p0 | Write `docs/retro/YYYY-MM-DD-<milestone>.md` with facts, answers and actions. |
| RET-4 | p0 | Propose concrete edits to solokit itself (skill text, templates, scripts, conventions), each with its reason; on the user's yes, open them as issues in the solokit repo. |
| RET-5 | p0 | Review parked ideas (CHG-10), then set the phase to `plan` or `build` for the next milestone. |

## Requirements: hooks, reviewer agent and action band

Hooks enforce the rules between commands, the reviewer checks work before it becomes a PR, and the action band puts the next step one keypress away.

**Hooks**

| ID | Priority | Requirement |
| --- | --- | --- |
| HOOK-1 | p1 | `guard-main` (`PreToolUse` on Bash): once the remote gate has passed, block commits and pushes on `main` and any force push, with a message that names the branch flow. Before bootstrap, local commits on `main` stay allowed (kickoff and PRD approval need them). |
| HOOK-2 | p1 | `issue-required` (`PreToolUse` on Edit and Write): warn, without blocking, when a source file outside `docs/`, `.project/`, `.claude/` and `.github/` is changed with no active issue; suggest `/solokit:next` or `/solokit:change`. |
| HOOK-3 | p1 | `prd-drift` (`Stop`): warn when an approved `docs/PRD.md` was edited outside a change-request branch. |
| HOOK-4 | p0 | `state-sync` (`SessionStart`): print at most five lines: phase, open gates, active issue, PRD version and the suggested next command. |
| HOOK-5 | p1 | Hooks are Node.js scripts using built-in modules, `git`, `gh` and nothing else, make no network calls, and finish within 200 ms. On an internal error they allow the action and print a warning. |
| HOOK-6 | p0 | `no-ai-attribution` (`PreToolUse` on Bash) blocks AI attribution in what gets published (ADR 0004). Text: before `git commit` and `gh pr` or `gh issue` `create`, `edit` and `comment`, it checks the message, title and body, including files named by `-F`, `--file` or `--body-file`. It blocks `Co-Authored-By` trailers naming Claude, Anthropic or an AI, `noreply@anthropic.com`, `Claude-Session` trailers, "Generated with …" lines, the robot emoji, and statements that the work was generated or assisted by AI or Claude. Branch names: before `git checkout -b`, `git switch -c`, `git branch <name>` and `git push` of a new branch, it splits the name on `/`, `-`, `_` and `.` and blocks when a whole segment is `claude`, `anthropic` or `ai`, so `maintain`, `email` and `detail` pass. Technical names (`CLAUDE.md`, `.claude/`, `CLAUDE_*` variables, `claude` commands) never match. The block message names what matched. Follows HOOK-5; inactive when `hide_ai_attribution` is off. |

**Reviewer agent**

| ID | Priority | Requirement |
| --- | --- | --- |
| AGT-1 | p0 | Review in a fresh context with the PRD sections for the referenced requirement IDs, the issue, the diff and the verify evidence. |
| AGT-2 | p0 | Report findings as blocking, major, minor or nit, each with file and line: requirement coverage, missing tests for changed behaviour, security (secrets, injection, unsafe input), conventions, and changes outside the issue's scope. |
| AGT-3 | p0 | Read-only: the agent can read files and run `git diff` and `git log`, nothing else. |

**Action band (mod)**

| ID | Priority | Requirement |
| --- | --- | --- |
| BAND-1 | p0 | Draw a band above the prompt with phase, active issue, PRD version and up to four numbered actions chosen as in ENT-2. |
| BAND-2 | p0 | Digit hotkeys: a digit typed alone into the empty prompt presses the matching action. |
| BAND-3 | p0 | An action hands over the same command a user would type by calling `$.command.run({ command: "solokit:<name>", args })` from the button, without awaiting it: the skill expands and its turn starts. If that call is refused, the action puts the command in the prompt (`$.prompt.fill`) for one Enter and says so in a toast. `$.prompt.submit` is never used for a slash command; the host refuses it (ADR 0001). An action never passes a gate on its own, because the command shows its preview and asks. |
| BAND-4 | p2 | The Idea action opens a text field; submitting hands over `solokit:change` with that text as its argument, by the same mechanism and fallback as BAND-3. |
| BAND-5 | p1 | Hidden outside solokit projects and collapsible; refreshes when `state.json` changes or a turn completes. |
| BAND-6 | p1 | Uses only text and button elements, so it works in both the terminal and the Desktop app's Code tab; requires Claude Code v2.1.287 or later and stays silent on older versions. |

## Configuration and state

Three places hold data: plugin options set once per machine, remembered answers kept by the kit, and per-project state in the repo.

**Plugin options** (`userConfig`, editable in `/config`)

| Key | Type | Default | Used by |
| --- | --- | --- | --- |
| `default_owner` | string | empty (asked on first bootstrap) | BST-2 |
| `default_visibility` | `public` or `private` | `public` | BST-2 |
| `language` | string | `en` | CORE-8, KCK-2 |
| `kit_repo` | string, `owner/name` | empty | RET-4 (where kit-improvement issues go) |
| `hide_ai_attribution` | boolean | `true` | BST-12, BST-13, ENT-5, HOOK-6 (CFG-5) |
| `action_band` | boolean | `true` | BAND-1 |

**Remembered answers**: the last owner, stack and similar choices are stored in `${CLAUDE_PLUGIN_DATA}/defaults.json`, which survives plugin updates, and preselected next time (CORE-2). Skills never write this file with the Write tool, which asks for permission there in an interactive session and is denied in a `-p` run. They call `node ${CLAUDE_PLUGIN_ROOT}/scripts/defaults.mjs --data ${CLAUDE_PLUGIN_DATA} get|set …`, pre-approved in each skill's `allowed-tools` as `Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/*)`. Claude Code substitutes both variables in skill text and in `allowed-tools`, but does not set them in the environment of a command a skill runs, so a script receives the data directory only as an argument. Settings hooks read the variables from their environment. The grant lasts for the turn that invoked the skill and survives answering a multiple-choice question in that turn (ADR 0002).

**Project state**

| File | Committed | Holds |
| --- | --- | --- |
| `.project/state.json` | Yes | Schema version, kit version, project facts (`repo`, `repo_source`, `visibility`, `language`, `stack`), phase, gates, PRD version, status and source, ADR and CR counters, step status |
| `.project/local/active.json` | No | Active issue, branch, plan comment link |
| `.project/local/verify/<issue>.md` | No | Latest verify output with commit hash |

| ID | Priority | Requirement |
| --- | --- | --- |
| CFG-1 | p1 | Validate `state.json` against its schema on every read; on corruption, stop and offer to rebuild it from the repo and GitHub. |
| CFG-2 | p1 | Ship a migration for every schema change; never require the user to edit state by hand. |
| CFG-3 | p0 | Never store secrets or tokens; GitHub access always goes through the user's `gh` login. |
| CFG-4 | p0 | Skills run kit scripts only as `node ${CLAUDE_PLUGIN_ROOT}/scripts/<name>.mjs …`, pre-approved by their `allowed-tools`. A script that reads or writes plugin data takes `--data ${CLAUDE_PLUGIN_DATA}` and never reads the location from the environment. No skill writes plugin data with Write or Edit (ADR 0002). |
| CFG-5 | p1 | `hide_ai_attribution` switches BST-12, BST-13, ENT-5 and HOOK-6 together. Bootstrap reads it when it generates files; the hook reads it on every call. Turning it off later changes no file by itself: `/solokit:status` reports which of the generated parts are still in place. |

## Technical architecture

solokit is one plugin: skills hold the dialogue and judgement, Node.js scripts do the deterministic git and GitHub work and print JSON, hooks and a reviewer agent enforce the rules, and an optional mod draws the action band.

&#91;embedded content: solokit components · how a command flows\]

A command enters through any entry point, its skill runs the dialogue and writes documents and state, scripts carry out git and GitHub work, and hooks guard every edit and commit Claude makes in between.

**Division of labour**

- **Skills** (one per command, invoked as `/solokit:<skill>`): ask questions, read and write documents and `state.json`, call scripts, show gate previews. Sub-modes such as `prd import` and `prd check` are arguments to the same skill.
- **Scripts** (`scripts/*.mjs`): idempotent operations on git and GitHub through `gh`, each with `--dry-run` and JSON output, so a skill can show a preview, run the step and verify the result.
- **Hooks**: settings hooks for HOOK-1 to HOOK-4 and HOOK-6; the action band is a hooks module (mod) in the same `hooks/hooks.json`.
- **Agent**: `reviewer`, read-only.
- **Templates**: project skeleton, CI per stack, the solo ruleset and the `state.json` schema, copied and filled by bootstrap.

**Plugin layout**

```text
solokit/
├── .claude-plugin/
│   ├── plugin.json              # name, displayName, version, userConfig
│   └── marketplace.json         # personal marketplace in the same repo
├── skills/
│   ├── go/SKILL.md              # entry point /solokit:go
│   ├── kickoff/  prd/  bootstrap/  plan/  next/  verify/  pr/
│   ├── change/  release/  retro/  status/
│   └── issue-plan/  test-first/ # helpers used by next
├── agents/reviewer.md
├── hooks/
│   ├── hooks.json               # settings hooks + "modules": ["./band.js"]
│   ├── guard-main.mjs  issue-required.mjs  prd-drift.mjs  state-sync.mjs
│   ├── no-ai-attribution.mjs
│   └── band.js                  # action band mod
├── scripts/                     # Node.js, built-in modules only:
│   ├── lib/                     # state read/validate/migrate, gh wrapper, git wrapper
│   └── bootstrap-remote.mjs  bootstrap-local.mjs  readback.mjs
│       plan-issues.mjs  release-notes.mjs  repo-check.mjs …
├── templates/
│   ├── project/                 # CLAUDE.md (local baseline), README, docs/, .github/
│   ├── ci/                      # flutter, node, python, php, generic
│   ├── rulesets/solo-main.json
│   └── schemas/state.schema.json
├── migrations/                  # state.json schema migrations (Node.js)
├── tests/                       # node:test for scripts and hooks, claude plugin test for the band
└── docs/                        # solokit follows its own conventions
```

**Dogfooding**: the solokit repo itself is laid out by the conventions, with this PRD as `docs/PRD.md` and the conventions as `docs/CONVENTIONS.md`. Once bootstrap works, the repo's own rules are re-applied by solokit.

## Testing

Each part is tested where it can fail cheaply: scripts and hooks offline against fixtures, skills with eval cases, GitHub behaviour against a sandbox owner, and the whole flow by running it on a toy project.

| Layer | Method | Runs |
| --- | --- | --- |
| Plugin structure | `claude plugin validate --strict` | CI, every push |
| Scripts | `--dry-run` output compared with golden files using node:test; no network | CI, every push |
| Hooks | Feed JSON fixtures on stdin, assert exit code and message, including the 200 ms budget; `no-ai-attribution` cases include `--body-file` input and branch names that must pass (`maintain`, `email`, `detail`) | CI, every push |
| Action band | `claude plugin test` with stubbed `state.json` reads and button presses, terminal and desktop surfaces, including the `$.command.run` hand-off and its `$.prompt.fill` fallback | CI, every push |
| Skills | `claude plugin eval` cases: PRD import fixtures (mapping report, no invented content), change classification fixtures (idea to expected class), entry-point recommendations per phase | Before each release |
| GitHub behaviour | Scripts run for real against a sandbox owner, grown from `spikes/e2-ruleset/run.mjs`: create repo, apply ruleset, read back, first PR passes, docs-only PR passes, a PR behind `main` merges, delete repo | Before each release |
| End to end | Full flow on a toy project: kickoff, PRD, bootstrap, plan, two issues, one change, release, retro | Before each release |
| Windows | Hooks and scripts on Windows (paths, line endings, process spawning, a plugin data path with spaces passed to a pre-approved script) | Before each release |

The sandbox owner needs a `gh` token with the `delete_repo` scope, used only by the test harness.

## Milestones

All milestones belong to one release, 1.0; they fix only the build order, so each step can be used and tested before the next one starts.

0. **M0 Spike** (done 8 Oct 2026): ran the two experiments left in Open questions (E1 mod hand-off and skill permissions, E2 ruleset on a fresh repo), recorded the answers as ADRs 0001 to 0003 and folded the results into this PRD (0.4.0) and the conventions (v0.2). The spike code stays in `spikes/` as the starting point for M3's bootstrap scripts.
1. **M1 Foundation**: plugin skeleton, `state.json` schema and migrations, shared behaviour, entry point, status, `state-sync` hook. Covers CORE, ENT-1 to ENT-3, STA, CFG-1 to CFG-4, HOOK-4, HOOK-5.
2. **M2 Kickoff and PRD**: interview, draft, check, import, approval gate. Covers KCK, PRD, IMP.
3. **M3 Bootstrap**: both repo modes, templates, CI per stack, remote gate, read-back, `guard-main`. Covers BST, ENT-5, CFG-5, HOOK-1. Done when solokit re-applies its own repo rules.
4. **M4 Plan and build loop**: issues, next, test-first, verify, reviewer, PR and merge gate, `issue-required`. Covers PLN, NXT, VER, PR, AGT, HOOK-2, HOOK-6.
5. **M5 Change flow**: classes, CR, ADR, docs PR, re-plan, `prd-drift`. Covers CHG, HOOK-3.
6. **M6 Release and retro**: version proposal, notes, tag, retro, kit-improvement issues. Covers REL, RET.
7. **M7 Action band**: the mod, including the bare /solokit alias. Covers BAND, ENT-4.

**1.0** is tagged when M0 to M7 are done and the end-to-end test passes on a toy project.

## Risks

The largest risks are platform behaviour the kit relies on and a scope that is all-in-one by decision.

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Full scope in one release delays any usable result | High | Medium | Build order M1 to M7 makes each milestone usable on real projects as soon as it is done |
| Claude Code changes skills, hooks or mods APIs | Medium | High | Pin a minimum Claude Code version in the README; `claude plugin validate` and `claude plugin test` in CI; hooks fail open; the band falls back to `$.prompt.fill` when the host refuses `$.command.run` |
| A plugin data path with spaces (common on Windows) breaks or no longer matches a skill's pre-approved script call | Medium | Medium | M1 settles the quoting rule by test; the Windows layer covers it (ADR 0002) |
| GitHub API or ruleset semantics differ from the docs, especially on a fresh repo | Medium | High | M0 spike against a sandbox owner (ADR 0003); BST-8 read-back on every bootstrap, which also lists parameters GitHub adds, such as the undocumented `require_extra_approval_for_unattributed_changes` |
| Skills behave inconsistently across runs (questions skipped, IDs invented) | Medium | Medium | Strict skeletons and checks (`prd check`), eval cases, scripts for anything deterministic |
| Scripts or hooks behave differently on Windows | Medium | Medium | Windows test layer; Node.js built-ins for paths and processes, no shell-specific syntax |
| Hooks slow down every tool call | Low | Medium | 200 ms budget tested in CI; no network in hooks |
| A local `CLAUDE.md` is missing in a fresh clone or cloud session, so rules are not loaded | Medium | Medium | `state-sync` reports it and `/solokit:go` regenerates it (ENT-5); hooks and settings enforce the important rules without it |
| A mistaken gate confirmation creates or reconfigures the wrong repo | Low | High | Gate previews show owner and name prominently; `--dry-run`; destructive actions are never part of bootstrap |

## Open questions

Items marked **spike** are answered by experiment in M0; items marked **decision** need your call while we iterate on this PRD.

- [x] **Spike**, answered from the docs (8 Oct 2026): plugin skills are always namespaced (`/solokit:<skill>`), so the entry point is `/solokit:go`. A bare `/solokit` is possible only as a mod command (ENT-4).
- [x] **Spike**, answered from the docs (8 Oct 2026): a multiple-choice round holds one to four questions with two to four options each, plus Other. The tool is removed with `--permission-prompts none` and denied in `dontAsk` mode (CORE-2, CORE-3).
- [x] **Spike**, answered from the docs (8 Oct 2026): `${CLAUDE_PLUGIN_DATA}` is substituted in skill text and `allowed-tools`, but a Write there needs permission; remembered answers go through a pre-approved Node script (Configuration and state).
- [x] **Spike E1** (8 Oct 2026, [ADR 0001](decisions/0001-band-and-alias-hand-off.md), [ADR 0002](decisions/0002-skill-permissions-and-remembered-defaults.md)), mod hand-off and skill permissions. The host refuses `$.prompt.submit` with a `/command` text. `$.command.run` from a band button expands the skill and starts its turn. The bare `/solokit` hands off with `$.command.run` once its own hook has returned, and `$.prompt.fill` works everywhere with one Enter. The `allowed-tools` grant survives answering a question in the same turn. AskUserQuestion is absent from every `-p` run without a permission host. Skill-run commands do not get `CLAUDE_PLUGIN_DATA` in their environment (ENT-4, CORE-2, CORE-3, BAND-3, BAND-4, CFG-4, Configuration).
- [x] **Spike E2** (8 Oct 2026, [ADR 0003](decisions/0003-bootstrap-order-required-check-and-ci-template.md)), ruleset on a fresh sandbox repo. The API accepts a never-run `ci`, but an active ruleset then rejects the initial push, so the BST-7 order is required. In that order the first PR merges with zero approvals and no bypass. A docs-only PR passes with step-level skips, while a `paths` filter blocks it for good. "Branch must be up to date" blocked behind PRs and is turned off. The read-back matches everything sent, and GitHub adds two defaulted parameters (BST-7, BST-8, BST-9, STA-2).
- [x] **Decision** (8 Oct 2026): script runtime is Node.js with built-in modules only; no npm packages.
- [x] **Decision** (8 Oct 2026): blocking reviewer findings may be waived with a reason and the `review:waived` label, except security findings, which must be fixed.
- [x] **Decision** (8 Oct 2026): the release confirmation is one question that shows the notes and offers release, other version, edit notes or cancel.

## Changelog and references

| Date | Version | Change |
| --- | --- | --- |
| 8 Oct 2026 | 0.5.0 | No AI attribution by default (ADR 0004): `CLAUDE.md` generated locally and gitignored with a no-attribution rule (BST-5, BST-12), regenerated when missing (ENT-5, M3), attribution settings off in the project (BST-13), `no-ai-attribution` hook (HOOK-6, M4), switch `hide_ai_attribution` (CFG-5); `stack` added to the state's project facts. |
| 8 Oct 2026 | 0.4.0 | Spikes E1 and E2 closed (ADRs 0001–0003). Band and bare `/solokit` hand off with `$.command.run`, with `$.prompt.fill` as fallback (BAND-3, BAND-4, ENT-4). Questions stay in the invoking turn, and AskUserQuestion is absent from all `-p` runs without a host (CORE-2, CORE-3). Scripts get the plugin data directory as `--data` (Configuration, new CFG-4). The BST-7 order is required, with a detailed read-back and intent-view hash (BST-7, BST-8, STA-2), CI trigger and job shape (BST-9), and no up-to-date requirement on the required check. The PR body is kept short because it becomes the squash commit message, with the verify output and review in PR comments (PR-3). M0 done; M1 covers ENT-1 to ENT-3, and ENT-4 stays in M7. Every requirement gets a priority within its milestone (PRD-2). Frontmatter added. |
| 8 Oct 2026 | 0.3.0 | Three spikes answered from the Claude Code docs: entry point `/solokit:go` with a mod alias (ENT-4); question limits and runs without questions (CORE-2, CORE-3); remembered answers written by a pre-approved script (Configuration). From the GitHub docs: ruleset applied after the first green CI run (BST-7) and CI without path filters (BST-9). Band hand-off (BAND-3, BAND-4). M0 reduced to experiments E1 and E2. |
| 8 Oct 2026 | 0.2.0 | Decisions: Node.js runtime for scripts and hooks; waivable blocking findings except security (PR-2, RET-1); single release confirmation with notes preview (REL-2) |
| 8 Oct 2026 | 0.1.0 | First draft: full command set in one release; adds `/solokit:prd check` and `/solokit:change --ideas` to the command surface |

**References**

- Conventions: solo-agent-coding-kit — Conventions v0.2
- Decisions: [ADR 0001](decisions/0001-band-and-alias-hand-off.md) band and alias hand-off, [ADR 0002](decisions/0002-skill-permissions-and-remembered-defaults.md) skill permissions and remembered defaults, [ADR 0003](decisions/0003-bootstrap-order-required-check-and-ci-template.md) bootstrap order, required check and CI template, [ADR 0004](decisions/0004-no-ai-attribution.md) no AI attribution
- [Claude Code mods overview](https://code.claude.com/docs/en/plugins/mods/overview), [mods reference](https://code.claude.com/docs/en/plugins/mods/reference)
- [Plugin manifest reference](https://code.claude.com/docs/en/plugins-reference)
- [Publish and distribute a plugin](https://code.claude.com/docs/en/plugins/publish)
