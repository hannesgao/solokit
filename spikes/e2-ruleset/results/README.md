# Spike E2 results: solo ruleset on a fresh repo

Issue #2. Sandbox repos `hannesgao/solokit-e2-a` and `hannesgao/solokit-e2-b`, both public, run on 8 Oct 2026 with gh 2.83.1; both were deleted by the owner after the run.
The decision drawn from these results is [ADR 0003](../../../docs/decisions/0003-bootstrap-order-required-check-and-ci-template.md).

## How to re-run

| Check | Command (from the repo root) | Output |
| --- | --- | --- |
| Scenario A: BST-7 order, PRs, protection | `node spikes/e2-ruleset/run.mjs a [--only step,…]` | `a/NN-<step>.json`, `a/summary.json` |
| Scenario B: ruleset before ci ever ran | `node spikes/e2-ruleset/run.mjs b [--only step,…]` | `b/NN-<step>.json`, `b/summary.json` |
| CodeQL final state, undocumented parameter | `node spikes/e2-ruleset/followup.mjs` | `a/followup.json` |

Inputs: `solo-main.json` (the ruleset, from the Conventions table), `templates/ci.yml` (the CI template), and `templates/ci-paths.yml` (the counter-example with a `paths` filter). Every step file records each `gh`/`git` call with its exit code or HTTP status and its output.

## Findings

| # | Question | Result | Evidence |
| --- | --- | --- | --- |
| 1 | A: BST-7 order (push with `ci.yml`, wait for green `ci`, then ruleset) | Initial push accepted, and the push run went green. `POST /rulesets` returned 201. The first feature PR was `BLOCKED` until `ci` passed, then `CLEAN`. `gh pr merge --squash` merged it with 0 approvals and no bypass | `a/02`–`a/04`, `a/08` |
| 2 | A: "branch must be up to date" with two open PRs | After the first PR merged, the second was `BEHIND`. `gh pr merge --squash` failed: "the head branch is not up to date with the base branch". `--auto` could be enabled while `BEHIND`, but it does not update the branch. After `gh pr update-branch`, `ci` re-ran and auto-merge merged the PR | `a/09` |
| 3 | B: API accepts a required `ci` that never ran | Yes: `POST /rulesets` returned 201 on an empty repo | `b/02` |
| 4 | B: initial push with the ruleset already active | **Rejected**: `GH013 … Required status check "ci" is expected`. The runner then pushed with the ruleset briefly disabled to continue | `b/03` |
| 5 | B: first PR before any workflow exists | `BLOCKED`. `gh pr checks`: "no checks reported". Merge refused: "the base branch policy prohibits the merge" | `b/05` |
| 6 | B: same PR after it adds `ci.yml` | `pull_request` ran `ci` from the PR's own workflow file and it passed. The PR went `CLEAN` and merged with `--squash` | `b/06` |
| 7 | Docs-only PR with step-level `if:` | `ci` succeeded with "Test: skipped" and the PR merged | `a/10` |
| 8 | Same docs PR with a `paths: ['src/**']` workflow | `ci` never started; only CodeQL checks reported. The PR stayed `BLOCKED` after 2 minutes, merge was refused, and it was closed unmerged | `a/11` |
| 9 | Direct push to `main` | Rejected: "Changes must be made through a pull request" and `Required status check "ci" is expected` | `a/12` |
| 10 | Force push to `main` | Rejected: "Cannot force-push to this branch" | `a/12` |
| 11 | Delete `main` | Rejected by git's default-branch guard ("refusing to delete the current branch") before the ruleset's deletion rule is reached | `a/12` |
| 12 | Read-back: fields GitHub adds | Top level: `id`, `node_id`, `source`, `source_type`, `created_at`, `updated_at`, `_links`, `current_user_can_bypass`. `pull_request.parameters`: `required_reviewers: []` and `require_extra_approval_for_unattributed_changes: true` | `a/07`, `b/04` |
| 13 | Read-back: values GitHub rewrites | None. Every sent value came back unchanged, including `integration_id: 15368` and `~DEFAULT_BRANCH` | same |
| 14 | `require_extra_approval_for_unattributed_changes` | Not in the REST docs. It defaults to `true` when omitted, and a PUT with `false` is accepted and read back as `false`. Under `true`, five PRs across both repos merged with 0 approvals, one of them carrying a GitHub-made update-branch commit | `a/followup.json`, `a/08`–`a/10`, `b/06` |
| 15 | Hash subset | The intent view hashes identically to the sent ruleset on both repos (`5dbd15bee5c1…`). The view keeps the top-level `name`, `target`, `enforcement`, `conditions` and `bypass_actors`, plus each intended rule with only the parameter keys the intent sends; keys are sorted and rules ordered by type | `a/07`, `b/04` |
| 16 | Merge options | One `PATCH /repos/{o}/{r}` set squash only, auto-merge, delete-on-merge, `PR_TITLE`/`PR_BODY`, and wiki and projects off. Read-back showed no gaps | `a/05` |
| 17 | Security settings | See the table below | `a/06`, `a/followup.json` |

### Security settings on a public repo

| Setting | Endpoint | Before | Call | After |
| --- | --- | --- | --- | --- |
| Dependabot alerts | `PUT /repos/{o}/{r}/vulnerability-alerts` (read: `GET`, 204 on, 404 off) | 404 (off) | 204 | 204 (on) |
| Dependabot security updates | `PUT /repos/{o}/{r}/automated-security-fixes` (read: `GET` → `{ enabled, paused }`) | `enabled: false` | 204 | `enabled: true` |
| Secret scanning and push protection | `PATCH /repos/{o}/{r}` with `security_and_analysis.secret_scanning` and `secret_scanning_push_protection` (read: `GET /repos/{o}/{r}`) | already `enabled` on a new public repo | 200 | `enabled` |
| CodeQL default setup | `PATCH /repos/{o}/{r}/code-scanning/default-setup` `{ state: "configured", query_suite: "default" }` (read: `GET`) | `not-configured`, languages `[actions]` | 202 with a run id | `configured`, languages `[actions]`, weekly |

CodeQL default setup needs at least one supported language; the workflow file alone counts as `actions`. It adds the "Analyze (actions)" and "CodeQL" checks to PRs. They are not required checks.
