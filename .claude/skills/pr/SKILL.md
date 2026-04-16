# /pr — Create Pull Request

Create a pull request for the current branch and return the PR link.

## Modes

- **`/pr`** (no args) — Infer scope from branch name + commit history, auto-generate title and body.
- **`/pr <message>`** — Use the provided message as the PR title seed; generate body from commits and diff.

## Steps

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

## What this skill does NOT do
- Push the branch (you must push first)
- Run quality gates (trusts they already passed)
- Merge the PR
- Modify any files
