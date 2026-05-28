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

### 4. Check secret rotation due dates
Run: `~/.claude/scripts/rotate-secret.sh status --due-only`

If output contains `✗` (overdue) or `⚠` (due within 14 days) lines, capture them for the "Secrets due" section in step 5. If output is `No secrets due in the next 14 days.` — omit the Secrets section entirely. The full system is documented in `~/.claude/CLAUDE.md § "Secret rotation"`.

### 5. Reply format

**Default chat reply: 1-3 sentences, no template, no section headers,
no bullet lists.** Standup is a quick check-in — it should read like a
Telegram message, not a memo. Pattern:

    standup <date>: yesterday — <one-line summary of commits>. today —
    <feature> task X.Y, <next step>, <N>/<M> remaining. <"no blockers"
    OR "blocked: <one-line>">.<" secrets due: <one-line>" if any, else
    omit>

If something needs more than one line (e.g. 3 distinct blockers, or
overdue secrets that need action), apply the one-beat rule from
`~/.claude/CLAUDE.md § "Multi-part answers"` — open with the count,
deliver the most urgent piece, offer the rest if asked.

The structured multi-section format (yesterday/today/blockers/secrets
as labeled blocks with bullets) is **opt-in only** — emit it only when
the user explicitly asks for "the full breakdown" or "expand". Don't
lead with it.

If asked to expand, use this template:

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

Secrets due:
  - <line from rotate-secret status --due-only>
  - (omit this section entirely if nothing is due)
```

## Notes
- Default chat reply is 1-3 sentences in one message. Structured format is opt-in only.
- If git log shows no commits, note that.
- If FEATURE_PROMPTS.md doesn't exist, say so under Today.
