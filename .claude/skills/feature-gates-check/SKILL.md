# /feature-gates-check - Check Gates for Current Feature

> **Pipeline announcements required.** This is a multi-step pipeline. Announce steps via `~/.claude/scripts/pipeline-step.sh` per the rule in `~/.claude/CLAUDE.md § "Pipeline step announcements"`. Use pipeline-id `feature-gates-check`, display name `Feature Gates Check`. Call `begin feature-gates-check "Feature Gates Check" --total 4` at kickoff, `start`/`done`/`fail`/`skip` around each non-interactive step below, and `end feature-gates-check --status ok|fail` on completion. Skip interactive steps (user gates, clarification phases) — they self-announce. **Final output ordering (critical):** call `end` *before* emitting your final user-facing response. Your last message must be the deliverable itself (summary, report, PR link, etc.) with **no tool calls after it** — `--output-format json` returns only the final turn's text, so any deliverable emitted before a subsequent tool call is silently dropped.

Find the in-progress feature, determine which gates have already passed, run any missing ones, and report overall completeness.

## Steps

### 1. Identify the current in-progress feature
Read `FEATURE_PROMPTS.md` (or equivalent feature tracking file) and locate the feature currently in progress. If multiple in-progress features exist, pick the most recently started one and note the ambiguity.

### 2. Check which gates already passed
Scan for gate completion evidence in:
- Completion notes in `FEATURE_PROMPTS.md` under the feature heading
- Agent memory files in `.claude/agents/` for gate pass records
- Inline task checkboxes indicating gate runs

For each gate, determine status:
- `fix-advocate` — ran and approved by user?
- `pattern-enforcer` — ran, no VIOLATIONS?
- `security-reviewer` — ran, no CRITICAL findings?
- `monitoring-spec-validator` — ran, valid spec present?
- `test-runner` — ran, all tests green?
- `doc-updater` — all 7 phases complete?

### 3. Run missing gates
For any gate not already passed, run it now:
- **pattern-enforcer** + **security-reviewer** + **monitoring-spec-validator** in parallel (read-only)
- **test-runner** sequentially after the above using this project's configured test command

### 4. Report

```
Feature: <Feature Name>

Gate Status:
  fix-advocate:              ✅ Already done / 🔄 Just run / ⏭️ N/A (no bug fix)
  pattern-enforcer:          ✅ Already done / 🔄 Just run / ❌ FAIL
  security-reviewer:         ✅ Already done / 🔄 Just run / ❌ FAIL
  monitoring-spec-validator: ✅ Already done / 🔄 Just run / ❌ FAIL
  test-runner:               ✅ Already done / 🔄 Just run / ❌ FAIL
  doc-updater:               ✅ Already done / ❌ Missing phases: <list>

Completeness: X/6 gates passed
Final: ✅ COMPLETE / ❌ INCOMPLETE — fix: <list>
```

## Notes
- Do NOT fix gate failures automatically — report them.
- If FEATURE_PROMPTS.md does not exist, report that and stop.
- Adapt the test-runner command to whichever test framework this project uses.
