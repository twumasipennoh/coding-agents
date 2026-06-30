# /pr — Create Pull Request

> **Pipeline announcements required.** This is a multi-step pipeline. Announce steps via `~/.claude/scripts/pipeline-step.sh` per the rule in `~/.claude/CLAUDE.md § "Pipeline step announcements"`. Use pipeline-id `pr`, display name `Pull Request`. Call `begin pr "Pull Request" --total <N>` at kickoff, `start`/`done`/`fail`/`skip` around each non-interactive step below, and `end pr --status ok|fail` on completion. Skip interactive steps (user gates, clarification phases) — they self-announce. **Final output ordering (critical):** call `end` *before* emitting your final user-facing response. Your last message must be the deliverable itself (summary, report, PR link, etc.) with **no tool calls after it** — `--output-format json` returns only the final turn's text, so any deliverable emitted before a subsequent tool call is silently dropped.

> **Pacing:** multi-part deliverables follow `~/.claude/references/one-beat-per-turn.md`.

<!-- LEAN_OUTPUT_SUMMARY_START -->
## Lean output rules (canonical summary — auto-synced from `~/.claude/references/lean-output.md`)

- **Compact one-liner format by default.** Each item is one line:
  `name — 1-sentence summary (constraints in parens)`. Drill-down only
  on explicit user request ("expand", "full details", "show me X").
- **Padding-killers.** Never restate prior answers. Never preamble the
  next item ("Now I'll cover…", "Moving on to…"). A turn ending in two
  question marks is a bug — pick the load-bearing question, let the
  answer tee up the next turn.
- **Load-bearing first.** For lists of 3+ items, deliver the most
  load-bearing one first — the option you'd recommend, the worst
  finding, the user-facing change. Don't bury the lede.
- **Coverage tally for long lists.** Open with `N items: X top, Y
  secondary, Z edge` so the user can scan distribution before reading.
- **Side-channel instrumentation.** Log rule applications to
  `~/.claude/state/rule-hits.jsonl` via
  `~/.claude/scripts/log-rule-hit.sh lean-output <rule>` — don't cite
  rules inline in user-facing replies.
<!-- LEAN_OUTPUT_SUMMARY_END -->

> **Rule consultation.** Before generating the PR title and body, read `~/.claude/references/lean-output.md` and `~/.claude/calibration.md`. Apply matching entries (where **Wrong pitch** matches your planned output shape) by formatting per the **Right approach**. Don't cite rules inline. Call `~/.claude/scripts/log-rule-hit.sh <family> <entry-slug> pr` for each rule applied, BEFORE the final assistant turn. **Compact-format for this skill:** PR title as one line < 70 chars; PR body summary as 1-3 bullets describing user-facing change first, then implementation surface; final reply is just the PR URL.

Create a pull request for the current branch. Auto-detects whether changes span multiple projects and handles each accordingly.

## Modes

- **`/pr`** (no args) — Infer scope from branch name + commit history, auto-generate title and body.
- **`/pr <message>`** — Use the provided message as the PR title seed; generate body from commits and diff.

---

## Multi-Project Detection (runs every time)

Before doing anything else, scan for uncommitted changes across projects:

1. Check the current repo for uncommitted changes.
2. Scan all directories under `~/projects/*/` for repos with uncommitted changes (run `git status --porcelain` in each that has a `.git` directory).
3. Check `~/.claude/` for changes (may or may not be a git repo).
4. **If only the current repo has changes** → run the Single-Project Flow below.
5. **If multiple repos have changes** → run the Multi-Project Flow below.
6. **If a repo has changes you're unsure about** (e.g., unrelated dirty files beyond the coordinated change), surface it to the user: "This repo also has other uncommitted changes — include it?"

---

## Single-Project Flow

This is the existing behavior when only one repo has changes.

### 1. Validate branch state

1. Get current branch: `git branch --show-current`
2. Detect base branch: `main` or `master` (whichever exists as `origin/main` or `origin/master`)
3. **STOP** if on the base branch: "You're on the base branch. Create a feature branch first."
4. Check commits ahead of base: `git log <base>..HEAD --oneline`
5. **STOP** if no commits ahead: "No changes to PR. Branch is even with `<base>`."

### 2. Check push status

1. Check if branch has a remote tracking ref: `git rev-parse --abbrev-ref @{u} 2>/dev/null`
2. If no tracking ref: **STOP** — "Branch not pushed. Run `git push -u origin <branch>` first."
3. If tracking ref exists, compare: `git rev-list @{u}..HEAD --count`
4. If local is ahead: **STOP** — "You have <N> unpushed commit(s). Run `git push` first."
5. If remote is ahead of local: **WARN** — "Remote is ahead of local. Consider `git pull` first."

### 3. Check for existing PR

1. Run: `gh pr list --head <branch> --json number,url,state --jq '.[0]'`
2. If a PR already exists for this branch, return its URL instead of creating a duplicate:
   "PR already exists: <url>"

### 4. Generate PR content

**If no args provided (infer mode):**
1. Parse branch name for context (e.g., `feat/habit-reminders` → "Habit Reminders")
2. Read commit messages: `git log <base>..HEAD --format="%s"`
3. Get diff stat: `git diff <base>..HEAD --stat`
4. Auto-generate title from branch name + commit themes
5. Auto-generate body with summary bullets from commits

**If args provided (scoped mode):**
1. Use the provided message as the PR title
2. Read commit messages and diff stat (same as above)
3. Generate body using the message as context for the summary

**PR body format:**
```
## Summary
- <bullet 1 from commits/context>
- <bullet 2>
- <bullet N>

## Changes
<diff stat summary — X files changed, Y insertions, Z deletions>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

### 5. Create PR

```bash
gh pr create --title "<title>" --body "<body>" --base <base-branch>
```

### 6. Return result

```
PR created: https://github.com/<owner>/<repo>/pull/<number>
```

---

## Multi-Project Flow

Activated when changes are detected across multiple repos.

### 1. Gather candidates

For each repo with changes, collect:
- Repo path and name
- Current branch
- Whether it has a git remote
- Whether it has uncommitted work beyond the coordinated change
- Whether `~/.claude/` has changes (note: may not be a git repo)

### 2. Dry-run validation

Before mutating any repo, validate every candidate:

| Check | Pass | Fail action |
|---|---|---|
| Is a git repo | Has `.git` | Skip, note "not a git repo — updated locally, no PR applicable" |
| Has a remote | `git remote -v` returns something | Skip, note "no remote configured" |
| Base branch exists | `origin/main` or `origin/master` reachable | Skip, note reason |
| Branch name available | Proposed branch doesn't already exist locally or on remote | Flag to user — suggest appending suffix or skipping |
| Stash safety (if dirty work on different branch) | `git stash --dry-run` equivalent — check that working tree can be stashed | Skip, note "can't safely stash current work" |
| Detached HEAD | `git branch --show-current` returns a name | Skip, note "detached HEAD" |

**Auto-generate the branch name** from the change content. Examine the changed files and commit message to produce a descriptive branch name (e.g., changes to CLAUDE.md about e2e backend verification → `chore/e2e-backend-verification`, changes to SKILL.md about PR multi-project → `chore/pr-skill-multi-project`).

**Present the plan to the user before executing:**
```
Ready to create PRs in N repos:
  - HabitTracker (will stash dirty work on feat/m2-client-error-tracking)
  - MediaTracker
  - coding-agents
  - Insem_SocialMediaAggregator

Skipping:
  - ~/.claude/ — updated locally, no PR applicable

Branch name: chore/<auto-generated>
Proceed?
```

Wait for user confirmation.

### 3. Execute per-repo

For each validated repo, sequentially:

1. `cd` to the repo directory
2. Record current branch: `git branch --show-current`
3. Record dirty state: `git status --porcelain`
4. **If dirty work exists on a different branch:**
   a. `git stash push -m "pr-skill: auto-stash before multi-project PR"`
   b. Record that a stash was created
5. Switch to base branch: `git checkout <base>`
6. Pull latest: `git pull --ff-only`
7. Create branch: `git checkout -b <branch-name>`
8. Stage only the relevant changed files (e.g., `.claude/CLAUDE.md`): `git add <specific files>`
9. Commit with a message tailored to the project and change
10. Push: `git push -u origin <branch-name>`
11. Create PR: `gh pr create --title "<title>" --body "<body>" --base <base>`
12. Record the PR URL
13. Switch back to original branch: `git checkout <original-branch>`
14. **If a stash was created:**
    a. `git stash pop`
    b. If pop fails: **do NOT drop the stash**. Note: "Stash exists but couldn't auto-apply in <repo> — run `git stash pop` manually."

**If any step fails for a repo:**
- Attempt to restore the repo to its original state (checkout original branch, pop stash if needed)
- Record the failure reason
- Continue to the next repo — do not abort the entire run

### 4. PR content (multi-project)

**Title:** Tailored per project if the changes differ, otherwise shared. Format: concise description of the change.

**Body format (same structure as single-project):**
```
## Summary
- <bullets describing what changed in this specific project>

## Changes
<diff stat for this repo>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

### 5. Report results

After all repos are processed, list results:

```
<repo-name>: <PR URL>
<repo-name>: <PR URL>
<repo-name>: skipped — <reason>
~/.claude/: updated locally, no PR applicable
```

---

## What this skill does NOT do
- Run quality gates (trusts they already passed)
- Merge PRs
- Force-push or rewrite history
- Modify files (it only commits and PRs what's already changed)
