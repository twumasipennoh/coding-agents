# /standup - Daily Standup Summary

Generate a quick standup report: what was done, what's next, and any blockers.

## Steps

### 1. Gather recent git activity
Run: `git log --oneline -5`

Note the 5 most recent commits with their short hashes and messages.

### 2. Check current feature status
Read `FEATURE_PROMPTS.md` (or equivalent feature tracking file) and find:
- Which feature is currently in progress
- How many tasks are complete vs. remaining
- Any tasks marked `[-]` (deferred)
- Which pipeline step the feature is on

### 3. Check for blockers
Scan for blockers across:
- **Failing tests** — run the project's test command and check for failures
- **Missing dependencies** — check for TODO/FIXME comments or unresolved imports in recently changed files
- **Unresolved items** — scan CLAUDE.md for any flagged TO-DOs
- **Open Phase 7 flags** from doc-updater in FEATURE_PROMPTS.md or DECISIONS.md

### 4. Format output

```
Standup — <date>

Yesterday:
  - <commit summary 1>
  - <commit summary 2>
  - <commit summary N>

Today:
  - Working on: <current feature name> (Task X.Y — <task title>)
  - Next step: <next pipeline step>
  - Remaining tasks: X of Y

Blockers:
  - <blocker 1> (tests failing / missing dep / open flag)
  - None
```

## Notes
- Keep this brief — 10 lines or fewer total.
- If git log shows no commits, note that.
- If FEATURE_PROMPTS.md doesn't exist, say so under Today.
