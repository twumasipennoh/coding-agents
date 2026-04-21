# /doc-update - Sync Documentation for a Feature

> **Pipeline announcements required.** This is a multi-step pipeline. Announce steps via `~/.claude/scripts/pipeline-step.sh` per the rule in `~/.claude/CLAUDE.md § "Pipeline step announcements"`. Use pipeline-id `doc-update`, display name `Doc Update`. Call `begin doc-update "Doc Update" --total <N>` at kickoff, `start`/`done`/`fail`/`skip` around each non-interactive step below, and `end doc-update --status ok|fail` on completion. Skip interactive steps (user gates, clarification phases) — they self-announce.

Run the **doc-updater** agent for a named feature (or the current in-progress feature if none given). Executes all 7 documentation phases.

## Usage

```
/doc-update [feature-name]
```

If no feature name is given, read the feature tracking file to identify the current in-progress feature.

## Steps

### 1. Identify the target feature
If a feature name was provided, use it. Otherwise read `FEATURE_PROMPTS.md` (or equivalent) and find the feature currently in progress.

### 2. Run doc-updater agent — all 7 phases

Execute each phase in order:

**Phase 1 — TESTING doc**
Write or update a `TESTING_<FEATURE_NAME>.md` file with the test strategy, scenarios, and coverage notes for the feature.

**Phase 2 — FEATURE_PROMPTS.md**
Update the feature entry: mark completed tasks `[x]`, add completion notes, and append `✅ COMPLETE` to the heading if all tasks are done. Update all status indicators (TOC, heading, checkboxes).

**Phase 3 — DECISIONS.md**
Update `DECISIONS.md` with any architectural or security decisions made during this feature. Skip if none.

**Phase 4 — Agent memory**
Update relevant agent memory files in `.claude/agents/` with patterns, learnings, and preferences discovered during this feature.

**Phase 5 — PRD**
Update the PRD to reflect what was actually implemented. Correct any drift between spec and implementation.

**Phase 6 — README.md**
Update README.md if the feature changes user-facing behavior, setup steps, or environment requirements.

**Phase 7 — Human attention flags**
List any items that require manual human review: security decisions, architectural trade-offs, deferred tasks, open questions.

### 3. Report

```
Doc Update — <Feature Name>

Phase 1 (TESTING doc):     ✅ Done / ⚠️ Skipped: <reason>
Phase 2 (FEATURE_PROMPTS): ✅ Done / ⚠️ Skipped: <reason>
Phase 3 (DECISIONS.md):    ✅ Done / ⏭️ No decisions to record
Phase 4 (Agent memory):    ✅ Done
Phase 5 (PRD):             ✅ Done / ⏭️ No drift found
Phase 6 (README):          ✅ Done / ⏭️ No changes needed
Phase 7 (Human flags):     ✅ Done — <N> items flagged / ✅ Nothing to flag

All 7 phases complete.
```

## Notes
- All phases must run — do not skip any without a stated reason.
- Phase 7 items must be explicitly listed, not just counted.
