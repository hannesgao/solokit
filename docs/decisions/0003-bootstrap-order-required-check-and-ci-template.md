---
id: "0003"
date: 2026-10-08
status: proposed
---

# Bootstrap applies the ruleset after the first green ci, and CI never filters pull requests

## Context

Bootstrap (BST-7 to BST-9) configures a fresh public repo with the solo ruleset from the Conventions: PR required with 0 approvals, `ci` required and up to date, no force pushes, no deletion, linear history and an empty bypass list. Spike E2 (#2) ran the ruleset against two sandbox repos. Evidence: `spikes/e2-ruleset/results/README.md`.

The findings that decide this ADR:

- The API accepts a required `ci` that has never run (201). It does not protect against the wrong order.
- If the ruleset is active before the first commit, the initial push to `main` is rejected (`GH013 … Required status check "ci" is expected`). Bootstrap could not push its skeleton at all.
- In the BST-7 order (push with `ci.yml`, wait for the green push run, then the ruleset), the first PR merges with `gh pr merge --squash`, 0 approvals and no bypass.
- If a PR's own branch adds `ci.yml`, `pull_request` runs it and the PR can merge.
- A docs-only PR passes when work is skipped with step-level `if:`. A workflow with a `paths` filter never reports `ci`, and the PR stays blocked.
- "Up to date" blocks a second open PR after the first one merges. `gh pr merge` fails, and auto-merge waits without updating the branch. `gh pr update-branch` re-runs `ci`, and auto-merge then completes.
- On read-back, GitHub adds metadata and two `pull_request` parameters: `required_reviewers: []` and the undocumented `require_extra_approval_for_unattributed_changes: true`. It rewrites none of the sent values.

## Decision

1. **The bootstrap order is required, not just safer.** Bootstrap pushes the initial commit, including `.github/workflows/ci.yml`, while no ruleset exists. It then waits for that push's `ci` run on `main` to succeed and fails the step if it does not. After that it creates the ruleset, sets the merge options, creates labels and enables security, in that order. Re-running bootstrap on a repo that already has the ruleset skips the push and the wait (CORE-4).
2. **Required check.** The rule is `ci` with `integration_id: 15368` (GitHub Actions), so only an Actions job can satisfy it, and `strict_required_status_checks_policy: true` is kept. When a PR is `BEHIND`, `/solokit:pr` runs `gh pr update-branch` before it merges or enables auto-merge, and says so.
3. **CI template.** The template has these parts:
   - Triggers: `pull_request` with types `opened, synchronize, reopened, edited` and no `paths` or `branches` filter, plus `push` to `main`. `edited` re-runs the title check when a title is fixed. The `main` filter on `push` only defines "push to main"; push runs never feed a PR's required check.
   - One job named `ci` (`permissions: contents: read`).
   - Steps, in order:
     1. `actions/checkout` with `fetch-depth: 0`.
     2. The Conventional Commits title check, only on `pull_request`, in a few lines of shell.
     3. A change-detection step that sets `code=true` unless every changed file is under `docs/`.
     4. Install, lint, test and build steps, each guarded by `if: steps.changes.outputs.code == 'true'`.
4. **Ruleset template** (`templates/rulesets/solo-main.json`). It sends only documented parameters and leaves `require_extra_approval_for_unattributed_changes` to GitHub's default (`true`). Five PRs merged under that default, one of them with a GitHub-made update commit.
5. **Read-back and hash (BST-8, STA-2).** Bootstrap compares an intent view of the applied ruleset with `.github/rulesets/main.json`:
   - The view keeps the top-level `name`, `target`, `enforcement`, `conditions` and `bypass_actors`.
   - For each rule type in the intent, it keeps only the parameter keys the intent sends.
   - Keys are sorted and rules ordered by type.

   `state.json` stores `sha256:` plus the hex digest of that view's canonical JSON as `gates.remote_applied.ruleset_sha`; tools display the first 7 characters. Keys GitHub adds are reported as information, not as drift. A missing rule, or a changed value of a sent key, is drift.
6. **Merge options and security.** One `PATCH /repos/{o}/{r}` sets the merge options and turns off the wiki and projects. Security uses the endpoints in the results table: `PUT vulnerability-alerts`, `PUT automated-security-fixes`, `PATCH security_and_analysis` and `PATCH code-scanning/default-setup`. Each is read back. Secret scanning and push protection are already on for a new public repo, so that call is a no-op there.

## Consequences

- A step that waits for CI adds about 30 to 60 s to bootstrap. If the first run fails, bootstrap stops before any ruleset exists and the repo stays unprotected, so BST-10 (the first run must pass) matters.
- Every stack template must keep its expensive steps behind the change-detection output. Skipping the whole job, or the workflow, blocks the PR.
- `/solokit:pr` handles `BEHIND` itself. A solo developer rarely has two PRs open, but auto-merge alone would wait forever on a behind branch.
- The hash is stable across GitHub adding new parameters with defaults. A future default that matters (such as the unattributed-changes approval) shows up only in the information list, so the read-back report prints that list every time.
- CodeQL default setup adds two non-required checks to every PR.

## Alternatives considered

- **Ruleset first, `do_not_enforce_on_create: true`, then push**: possible in principle, but it adds a setting to the solo ruleset only to work around the order. The verified order needs no exception.
- **Ruleset first with enforcement `disabled`, activated after the first run**: works, as the B fallback showed, but it is the same order with one more API call and one more state to recover from.
- **`paths` filters to save CI minutes on docs PRs**: confirmed to block the PR.
- **Dropping "branch must be up to date"**: removes the `BEHIND` friction but allows merging a PR whose `ci` ran against an old `main`. The Conventions keep it; `update-branch` is cheap.
- **Hashing the full GET response**: changes with every timestamp and every new default GitHub adds.
- **Sending `require_extra_approval_for_unattributed_changes: false` explicitly**: accepted by the API, but the parameter is undocumented and its meaning unknown. Revisit if it ever blocks a merge.
