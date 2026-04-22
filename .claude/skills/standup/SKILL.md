# /standup - Daily Standup Summary

> **Pipeline announcements required.** This is a multi-step pipeline. Announce steps via `~/.claude/scripts/pipeline-step.sh` per the rule in `~/.claude/CLAUDE.md § "Pipeline step announcements"`. Use pipeline-id `standup`, display name `Standup`. Call `begin standup "Standup" --total <N>` at kickoff, `start`/`done`/`fail`/`skip` around each non-interactive step below, and `end standup --status ok|fail` on completion. Skip interactive steps (user gates, clarification phases) — they self-announce. **Final output ordering (critical):** call `end` *before* emitting your final user-facing response. Your last message must be the deliverable itself (summary, report, PR link, etc.) with **no tool calls after it** — `--output-format json` returns only the final turn's text, so any deliverable emitted before a subsequent tool call is silently dropped.

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
