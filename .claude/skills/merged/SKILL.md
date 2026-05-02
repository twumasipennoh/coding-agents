# /merged — Post-Merge Branch Cleanup

> **Pipeline announcements required.** This is a multi-step pipeline. Announce steps via `~/.claude/scripts/pipeline-step.sh` per the rule in `~/.claude/CLAUDE.md § "Pipeline step announcements"`. Use pipeline-id `merged`, display name `Branch Cleanup`. Call `begin merged "Branch Cleanup" --total <N>` at kickoff, `start`/`done`/`fail`/`skip` around each non-interactive step below, and `end merged --status ok|fail` on completion. Skip interactive steps (user gates, plan-and-confirm) — they self-announce. **Final output ordering (critical):** call `end` *before* emitting your final user-facing response. Your last message must be the deliverable itself (the report) with **no tool calls after it** — `--output-format json` returns only the final turn's text, so any deliverable emitted before a subsequent tool call is silently dropped.

After a PR merges, align local branches with remote and clean up merged feature branches across one or many projects in `~/projects/`.

## Modes

- **`/merged`** (no args) — auto-detect scope. Use the cwd's current branch as the trigger. If sibling repos under `~/projects/*/` also have a branch with the same name, treat as a multi-project batch. Otherwise just the cwd repo.
- **`/merged --here`** — only the cwd repo, ignore siblings.
- **`/merged --batch <branch>`** — process every project under `~/projects/*/` that has a branch named `<branch>`. Useful when you didn't cd into one of them or when the cwd is unrelated.
- **`/merged <free text>`** — auto-detect mode plus capture trailing text as an annotation. Echo the annotation in the final report; pass it as `--note` to `pipeline-step.sh end`. Free text never affects branch detection or actions.

Combinations are allowed: `/merged --here cleaning up after F32` means single-repo with annotation. Treat any flag-leading token (`--here`, `--batch`) before parsing as positional; everything else after the flags is annotation.

## Multi-Project Detection (always runs)

Before mutating anything:

1. Determine the trigger branch:
   - If `--batch <branch>` provided, that's the trigger.
   - Else `git branch --show-current` from cwd.
2. **STOP** if the trigger is the base branch itself (`main` / `master`). Tell the user: "You're on the base branch. Pass `--batch <branch>` or run from the merged feature branch."
3. List candidate projects:
   - If `--here` set → only the cwd repo.
   - Else walk every dir under `~/projects/*/` containing a `.git` directory. Include the cwd repo regardless of whether it matches.
4. For each candidate, check whether a branch matching the trigger exists locally OR was recently active on the remote (`git ls-remote --heads <remote> <trigger>`).
5. Drop candidates with no matching branch unless they're the cwd repo (always include cwd).

## Per-Project Decision Table

For each candidate repo, classify before mutating:

| Repo state | Action |
|---|---|
| PR for `<trigger>` is merged AND local branch tip exactly matches what shipped AND working tree clean | switch to base, fast-forward, delete local `<trigger>`, prune stale remote-tracking refs |
| PR for `<trigger>` is merged AND local branch has commits beyond what shipped | switch to base, fast-forward, **keep `<trigger>`**; report "kept — N unmerged commits beyond what shipped" |
| PR for `<trigger>` is closed unmerged | switch to base, fast-forward, **keep `<trigger>`**; report "PR #X closed without merging — branch kept" |
| Working tree dirty in this repo | refuse to mutate this repo; list dirty files; ask whether to **stash / commit / abort this repo only** (continue with siblings either way) |
| User on base branch (`main` / `master`) already in this repo | just `git fetch --prune` + `git pull --ff-only`; report new commits if any; no branch switching |
| Local base has accidental merge commits not on `<remote>/<base>` | flag and **prompt before** suggesting `git reset --hard <remote>/<base>`. Never auto-fix. |
| `gh auth status` fails or network down | fall back to `git branch --merged <base>` (catches merge-commit and rebase-merge but **not** squash); print warning that squash-merged PRs may not be detected |

To check if a PR was merged via squash/rebase/merge-commit uniformly:

```
gh pr list --head <trigger> --state merged --limit 1 --json number,mergedAt,mergeCommit --jq '.[0]'
```

If `.mergedAt` is non-null, the PR was merged regardless of strategy.

## Plan-and-Confirm

After the scan and classification:

1. Print a compact per-repo plan, one block per repo.
2. **Auto-confirm and proceed without prompting** when every repo's classification is "merged + clean tip + clean tree" (the most common case).
3. **Prompt the user with `y/N`** if any repo is in an ambiguous state — dirty tree, unmerged commits, declined PR, accidental merge commits, or `gh` fallback warnings. Show the plan, ask explicitly, wait.

Plan output format:

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

HabitTracker (sibling): no matching branch — skipping
```

## Execute (per repo, sequential)

For each repo classified as actionable (in declared order):

1. Capture original branch (`git branch --show-current`) and dirty state (`git status --porcelain`).
2. Detect remote: prefer `origin`, fall back to `upstream`, else first listed remote. **STOP this repo with note** if no remote.
3. Detect base: `git symbolic-ref refs/remotes/<remote>/HEAD`, else probe `master`, else probe `main`. **STOP this repo with note** if neither exists.
4. If dirty work outside the cleanup paths → `git stash push --include-untracked -m "merged-skill-tmp"`. Record whether stashed.
5. `git fetch <remote> --prune` (drops stale remote-tracking refs as a side effect).
6. `git checkout <base>`.
7. `git pull --ff-only <remote> <base>`. If this fails (divergent), abort this repo cleanly: switch back to original branch, pop stash, log the failure, continue siblings.
8. If the trigger branch should be deleted: `git branch -d <trigger>` (regular delete — refuses if there are unmerged commits, which is the safety net we want).
9. Switch back to the original branch (unless original was the trigger and we just deleted it — in that case stay on base).
10. Pop stash if one was created. **If pop has conflicts, do NOT drop the stash**; note "stash exists in <repo> — run `git stash pop` manually."

If any step fails for a repo: capture reason, attempt to restore (checkout original, pop stash), continue to next repo. Do not abort the entire run.

## Stale Local Branches Report

After the per-repo work, additionally check each touched repo for branches that look abandoned: local branches not associated with an open or recently-merged PR, with no commits in the last 30 days. List them as informational hints — do **not** delete them.

```bash
git for-each-ref --format='%(refname:short) %(committerdate:relative)' refs/heads/ | \
  grep -v -E '(^main|^master)' | head -20
```

For each, confirm via `gh pr list --head <branch>`. If no PR (open or merged) is associated, list as stale.

## Final Report

Single output block, one line per project plus a footer:

```
Insem_SocialMediaAggregator: aligned with origin/main, deleted chore/foo
MediaTracker: skipped — branch present but no merged PR
HabitTracker: clean, on main, no action needed
ai_personal_assistant: kept docs/something — 2 unmerged commits beyond what shipped

Notes:
  - <free-text annotation from invocation, if any>
  - HabitTracker: 3 stale local branches (no recent PR). Review manually.
  - MediaTracker: stash from skill remains — run `git stash pop` manually.
```

## What this skill does NOT do

- Merge PRs.
- Force-push or rewrite remote history.
- Delete branches that have unmerged work (regular `git branch -d` refuses; we never use `-D`).
- Run quality gates (no test-runner, no pattern-enforcer).
- Reconcile vendored skills with globals (use `~/.claude/scripts/sync-skills.sh` for that).
- Touch any project outside `~/projects/*/` even if reachable.
- Auto-rebase other local feature branches that are now behind base. Reports their state only.
