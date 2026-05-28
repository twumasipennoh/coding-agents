# /merged — Post-Merge Branch Cleanup

> **Pipeline announcements required.** This is a multi-step pipeline. Announce steps via `~/.claude/scripts/pipeline-step.sh` per the rule in `~/.claude/CLAUDE.md § "Pipeline step announcements"`. Use pipeline-id `merged`, display name `Branch Cleanup`. Call `begin merged "Branch Cleanup" --total <N>` at kickoff, `start`/`done`/`fail`/`skip` around each non-interactive step below, and `end merged --status ok|fail` on completion. Skip interactive steps (user gates, plan-and-confirm) — they self-announce. **Final output ordering (critical):** call `end` *before* emitting your final user-facing response. Your last message must be the deliverable itself (the report) with **no tool calls after it** — `--output-format json` returns only the final turn's text, so any deliverable emitted before a subsequent tool call is silently dropped.

After a PR merges, align local branches with remote and clean up merged feature branches across one or many projects in `~/projects/`.

## Modes

- **`/merged`** (no args) — auto-detect scope. Use the cwd's current branch as the trigger. If sibling repos under `~/projects/*/` also have a branch with the same name, treat as a multi-project batch. Otherwise just the cwd repo.
- **`/merged --here`** — only the cwd repo, ignore siblings.
- **`/merged --batch <branch>`** — process every project under `~/projects/*/` that has a branch named `<branch>`. Useful when you didn't cd into one of them or when the cwd is unrelated.
- **`/merged --all-merged`** — sweep mode. Walk every project under `~/projects/*/`, find every local branch with a merged PR, classify per the decision table, and process them in one plan-and-confirm pass. Combine with `--here` to scope to cwd only. Mutually exclusive with `--batch`. Use after a long stretch of work that accumulated stale branches.
- **`/merged <free text>`** — auto-detect mode plus capture trailing text as an annotation. Echo the annotation in the final report; pass it as `--note` to `pipeline-step.sh end`. Free text never affects branch detection or actions.

Combinations are allowed: `/merged --here cleaning up after F32` means single-repo with annotation. `/merged --all-merged sweep before vacation` works too. Treat any flag-leading token (`--here`, `--batch`, `--all-merged`) before parsing as positional; everything else after the flags is annotation. **Error and stop** if both `--batch` and `--all-merged` are passed.

## Candidate Detection

Different modes scan differently. Use the right one based on which flags were passed:

### Default / `--batch` / `--here` modes

1. Determine the trigger branch:
   - If `--batch <branch>` provided, that's the trigger.
   - Else `git branch --show-current` from cwd.
2. **STOP** if the trigger is the base branch itself (`main` / `master`). Tell the user: "You're on the base branch. Pass `--batch <branch>`, `--all-merged`, or run from a merged feature branch."
3. List candidate projects:
   - If `--here` set → only the cwd repo.
   - Else walk every dir under `~/projects/*/` containing a `.git` directory. Include the cwd repo regardless of whether it matches.
4. For each candidate, check whether a branch matching the trigger exists locally OR was recently active on the remote (`git ls-remote --heads <remote> <trigger>`).
5. Drop candidates with no matching branch unless they're the cwd repo (always include cwd).

### `--all-merged` sweep mode

Different shape: instead of using cwd's branch as the trigger, find every local branch with a merged PR across all eligible projects.

1. List candidate projects:
   - If `--here` set → only the cwd repo.
   - Else walk every dir under `~/projects/*/` containing a `.git` directory.
2. For each project:
   a. List every local branch except `main`/`master`: `git for-each-ref --format='%(refname:short)' refs/heads/`.
   b. For each branch, query `gh pr list --head <branch> --state merged --limit 1 --json number,mergedAt --jq '.[0]'`. If `.mergedAt` is non-null, the branch is a candidate.
   c. Branches with no merged PR (open, closed-unmerged, or no PR at all) are reported as "left alone" but not processed.
3. If `gh` is unauthenticated, fall back to `git branch --merged <base>` per project (catches merge-commit and rebase-merge but not squash). Warn the user.
4. The `--all-merged` mode **always prompts** before mutating, regardless of cleanliness — the blast radius is too wide for auto-confirm.

## Per-Project Decision Table

For each candidate branch, classify before mutating:

| Branch state | Action |
|---|---|
| PR is merged AND local branch tip exactly matches what shipped AND working tree clean | switch to base, fast-forward, delete local branch, prune stale remote-tracking refs |
| PR is merged AND local branch has commits beyond what shipped | switch to base, fast-forward, **keep branch**; report "kept — N unmerged commits beyond what shipped" |
| PR is closed unmerged | switch to base, fast-forward, **keep branch**; report "PR #X closed without merging — branch kept" |
| Working tree dirty in this repo | refuse to mutate this repo; list dirty files; ask whether to **stash / commit / abort this repo only** (continue with siblings either way) |
| User on base branch (`main` / `master`) already in this repo | just `git fetch --prune` + `git pull --ff-only`; report new commits if any; no branch switching |
| Local base has accidental merge commits not on `<remote>/<base>` | flag and **prompt before** suggesting `git reset --hard <remote>/<base>`. Never auto-fix. |
| `gh auth status` fails or network down | fall back to `git branch --merged <base>` (catches merge-commit and rebase-merge but **not** squash); print warning that squash-merged PRs may not be detected |

To check if a PR was merged via squash/rebase/merge-commit uniformly:

```
gh pr list --head <branch> --state merged --limit 1 --json number,mergedAt,mergeCommit --jq '.[0]'
```

If `.mergedAt` is non-null, the PR was merged regardless of strategy.

## Plan-and-Confirm

After detection and classification:

1. Print a compact plan. In default / `--batch` / `--here` modes: one block per repo. In `--all-merged` sweep mode: group by project with counts (`<project>: N to delete, M to keep, K left alone`).
2. **Auto-confirm and proceed without prompting** in default / `--batch` / `--here` modes when every repo's classification is "merged + clean tip + clean tree" (the most common case).
3. **Prompt the user with `y/N`** in default / `--batch` / `--here` modes if any repo is in an ambiguous state — dirty tree, unmerged commits, declined PR, accidental merge commits, or `gh` fallback warnings.
4. **Always prompt** in `--all-merged` sweep mode regardless of cleanliness.

Plan output format (default / `--batch`):

```
Insem_SocialMediaAggregator (cwd):
  branch: chore/foo
  PR #74 — merged 2h ago
  local tip = origin merge SHA
  → switch to main, fast-forward, delete chore/foo, prune

MediaTracker (sibling):
  branch: chore/foo
  No matching PR found
  → skip
```

Plan output format (`--all-merged`):

```
Sweep mode — scanning 7 projects for branches with merged PRs.

Insem_SocialMediaAggregator: 9 to delete, 0 to keep, 0 left alone
  delete: chore/automated-deploy-skill, chore/claude-md-reply-style, ...
HabitTracker: 9 to delete, 0 to keep, 1 closed-unmerged kept
  keep: chore/promote-monitoring-rules-to-claude-md (PR #54 closed without merging)
...

Total: 56 branches to delete across 7 projects.
Proceed? [y/N]
```

## Execute (per repo, sequential)

For each repo with at least one actionable branch:

1. Capture original branch (`git branch --show-current`) and dirty state (`git status --porcelain`).
2. Detect remote: prefer `origin`, fall back to `upstream`, else first listed remote. **STOP this repo with note** if no remote.
3. Detect base: `git symbolic-ref refs/remotes/<remote>/HEAD`, else probe `master`, else probe `main`. **STOP this repo with note** if neither exists.
4. If dirty work outside the cleanup paths → `git stash push --include-untracked -m "merged-skill-tmp"`. Record whether stashed.
5. `git fetch <remote> --prune` (drops stale remote-tracking refs as a side effect).
6. `git checkout <base>`.
7. `git pull --ff-only <remote> <base>`. If this fails (divergent), abort this repo cleanly: switch back to original branch, pop stash, log the failure, continue siblings.
8. **For each branch to delete in this repo** (one in default mode, possibly many in sweep mode): `git branch -d <branch>` (regular delete — refuses if there are unmerged commits, which is the safety net we want). If `-d` refuses, fall through to "kept — has unmerged commits" classification and continue.
9. Switch back to the original branch (unless original was deleted — in that case stay on base).
10. Pop stash if one was created. **If pop has conflicts, do NOT drop the stash**; note "stash exists in <repo> — run `git stash pop` manually."

If any step fails for a repo: capture reason, attempt to restore (checkout original, pop stash), continue to next repo. Do not abort the entire run.

## Stale Local Branches Report

In default / `--batch` / `--here` modes, after the per-repo work, additionally check each touched repo for branches that look abandoned: local branches not associated with an open or recently-merged PR, with no commits in the last 30 days. List them as informational hints — do **not** delete them. Suggest `/merged --all-merged` if many surface.

```bash
git for-each-ref --format='%(refname:short) %(committerdate:relative)' refs/heads/ | \
  grep -v -E '(^main|^master)' | head -20
```

For each, confirm via `gh pr list --head <branch>`. If no PR (open or merged) is associated, list as stale.

In `--all-merged` mode, this section is redundant — the sweep already touched every branch with a merged PR. Just list "no merged PR" branches in the final report under "left alone."

## Final Report

**Default chat reply: one line.** The audit trail is already in git
history (merge commits, branch deletes) and was emitted by
`pipeline-step.sh` during the run — no need to re-narrate per-repo in
chat. Pattern:

    merged: <N> PRs cleaned across <M> repos. top: <one-line of most notable cleanup>. <"clean" OR "needs follow-up: <one-line>">

Examples:

    merged: 19 PRs cleaned across 4 repos. top: HabitTracker 9 deleted + 1 kept (PR #54 closed). clean.

    merged: 23 PRs cleaned across 5 repos. top: Insem 9 deleted. needs follow-up: MediaTracker stash remains — run `git stash pop`.

Pick the "top" line by impact: most branches deleted, the only repo with
exceptions, or the only one needing manual follow-up — whatever the user
most needs to see. Free-text annotation from the invocation, if any,
goes on its own line under the one-liner.

The structured per-repo block (one line per project + Notes footer) is
**opt-in only** — emit it only when the user asks for "the full
breakdown" or "expand". Don't lead with it. For reference, the opt-in
shape:

```
Insem_SocialMediaAggregator: aligned with origin/main, deleted 9 branches (chore/foo, chore/bar, ...)
MediaTracker: clean, on master, no action needed
HabitTracker: deleted 9 branches; kept 1 (chore/promote-monitoring-rules-to-claude-md — PR #54 closed)
ai_personal_assistant: kept docs/something — 2 unmerged commits beyond what shipped

Notes:
  - <free-text annotation from invocation, if any>
  - HabitTracker: 3 stale local branches (no recent PR). Run `/merged --all-merged` to clean.
  - MediaTracker: stash from skill remains — run `git stash pop` manually.
```

If the run had a true multi-axis result (e.g. 3 distinct follow-up items
across different repos), apply the one-beat rule from `~/.claude/CLAUDE.md
§ "Multi-part answers — one beat per turn"` — open with the count,
deliver the most urgent piece, offer the rest if asked.

## What this skill does NOT do

- Merge PRs.
- Force-push or rewrite remote history.
- Delete branches that have unmerged work (regular `git branch -d` refuses; we never use `-D`).
- Run quality gates (no test-runner, no pattern-enforcer).
- Reconcile vendored skills with globals (use `~/.claude/scripts/sync-skills.sh` for that).
- Touch any project outside `~/projects/*/` even if reachable.
- Auto-rebase other local feature branches that are now behind base. Reports their state only.
