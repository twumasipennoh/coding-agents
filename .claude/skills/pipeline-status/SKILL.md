# /pipeline-status — Check Feature Pipeline Progress

Reports two kinds of pipeline state:
1. **Feature-tracking state** — long-lived state written by `feature-implementer` about which feature is being worked on (persisted at `docs/prompts/.pipeline-state.json`).
2. **Live step-announcement audit log** — events written by `~/.claude/scripts/pipeline-step.sh` at each pipeline step boundary (persisted at `~/.claude/state/pipelines/<pipeline>-<session>.jsonl`). This is written by any skill that uses the helper (`/feature`, `/fix`, `/deploy`, `/checkpoint`, `/pr`, `/patch`, `/gate-check`, etc.) and by ad-hoc long tasks. It's the right source to check "what step is the current run on?"

## Steps

### 1. Check live step audit (current session)

1. Resolve the session id: `$CLAUDE_SESSION_ID`, or `$OPENCLAW_SESSION_ID`, or `pid-<PPID>` as fallback — same logic as `pipeline-step.sh` uses.
2. Glob `~/.claude/state/pipelines/*-<session>.jsonl` for files matching the current session.
3. For each matching file:
   - Parse the JSONL events (one JSON object per line).
   - Find the last `begin` without a matching `end` → that's an active pipeline.
   - List each step event in order: `start` events awaiting `done`/`fail`/`skip` are in-flight; events with a terminator are complete.
   - Compute elapsed time per completed step (from the event's `duration_s`) and running elapsed for in-flight steps (from `start` ts to now).
4. Display format:

```
Active pipelines (this session):
  Feature Sprint (feature-sprint) — 23m elapsed
    ✅ Step 1/9 · Pre-Flight           — done in 12s
    ✅ Step 2/9 · Test Creator         — done in 1m 42s (14 tests)
    🔄 Step 3/9 · Feature Creator      — in progress (4m so far)
    ⬜ Step 4/9 · Pattern Enforcer     — pending
    ⬜ Step 5/9 · Test Runner          — pending
    ...

  Progress: 2/9 steps complete
```

If there are no matching audit logs for the session, say "No active pipeline in this session."

### 2. Read per-feature pipeline state (project-specific)

1. Read `docs/prompts/.pipeline-state.json`.
2. If the file doesn't exist or is empty: skip this section.

### 3. Parse and display per-feature progress

For each feature entry in the state file, display a progress tracker showing which pipeline steps are done, in-progress, or pending:

```
Pipeline Status
═══════════════

Feature 9 — Habit Reminders (Task 9.2)
  Started: 2026-04-15

  ✅ requirements    — done
  ✅ pre-flight      — done
  ✅ tests           — done
  🔄 implementation  — in progress
  ⬜ gates           — pending
  ⬜ test-suite      — pending
  ⬜ doc-sync        — pending
  ⬜ user-gate       — pending
  ⬜ commit          — pending

  Progress: 3/9 steps complete
```

### 4. Cross-reference with FEATURE_PROMPTS.md

1. Read `docs/prompts/FEATURE_PROMPTS.md`.
2. For each in-progress feature in the state file, show:
   - Total tasks in the feature vs. completed tasks
   - The specific task currently being worked on
   - Any deferred tasks (`[-]`)

### 5. Reply format

**Default chat reply: 1-3 sentences, no template, lead with current
step + last result + next action.** Pattern:

    pipeline <id>: step N/M (<current step>), <last result>.
    <continue/blocked>?

If multiple pipelines are active concurrently, apply the one-beat
rule from `~/.claude/CLAUDE.md § "Multi-part answers — one beat per
turn"` — open with the count, deliver the most urgent piece, offer
the rest if asked.

The structured step-by-step tracker (active pipelines block,
per-feature progress, cross-reference with FEATURE_PROMPTS) is
**opt-in only** — emit it only when the user explicitly asks for "the
full breakdown", "expand", or "details". Don't lead with it.

If asked to expand, use the templates from steps 1, 3, and 4 above
(active pipelines block, per-feature progress, summary).

## Notes
- Default chat reply is 1-3 sentences in one message. Structured tracker is opt-in only.
- This skill is read-only — it does not modify any files.
- The feature-tracking state file (`docs/prompts/.pipeline-state.json`) is written by the `feature-implementer` agent and cleaned up by the `doc-updater` agent when a feature is marked ✅ COMPLETE.
- The step-announcement audit log (`~/.claude/state/pipelines/*.jsonl`) is written by `pipeline-step.sh` and reaped at 30 days by the daily cron.
- If the feature-tracking state contains entries for features already marked ✅ COMPLETE in FEATURE_PROMPTS.md, flag them as stale and suggest cleanup.
- Cross-session view: to list recent pipeline runs across all sessions, glob `~/.claude/state/pipelines/*.jsonl` (without session filter) and group by pipeline-id.
