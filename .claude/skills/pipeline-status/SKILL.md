# /pipeline-status — Check Feature Pipeline Progress

Read the pipeline state file and report where in-progress features currently stand in the implementation pipeline.

## Steps

### 1. Read pipeline state

1. Read `docs/prompts/.pipeline-state.json`.
2. If the file doesn't exist or is empty: report "No features currently in the pipeline." and **STOP**.

### 2. Parse and display progress

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

### 3. Cross-reference with FEATURE_PROMPTS.md

1. Read `docs/prompts/FEATURE_PROMPTS.md`.
2. For each in-progress feature in the state file, show:
   - Total tasks in the feature vs. completed tasks
   - The specific task currently being worked on
   - Any deferred tasks (`[-]`)

### 4. Summary

```
Pipeline Summary:
  In progress: <N> feature(s)
  Current step: <step name> for <feature name>
  Next action: <what needs to happen next>
```

## Notes
- This skill is read-only — it does not modify any files.
- The state file is written by the `feature-implementer` agent and cleaned up by the `doc-updater` agent when a feature is marked ✅ COMPLETE.
- If the state file contains entries for features already marked ✅ COMPLETE in FEATURE_PROMPTS.md, flag them as stale and suggest cleanup.
