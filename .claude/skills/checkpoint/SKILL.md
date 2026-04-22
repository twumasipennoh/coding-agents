# /checkpoint - Feature Gate

> **Pipeline announcements required.** This is a multi-step pipeline. Announce steps via `~/.claude/scripts/pipeline-step.sh` per the rule in `~/.claude/CLAUDE.md § "Pipeline step announcements"`. Use pipeline-id `checkpoint`, display name `Checkpoint`. Call `begin checkpoint "Checkpoint" --total <N>` at kickoff, `start`/`done`/`fail`/`skip` around each non-interactive step below, and `end checkpoint --status ok|fail` on completion. Skip interactive steps (user gates, clarification phases) — they self-announce. **Final output ordering (critical):** call `end` *before* emitting your final user-facing response. Your last message must be the deliverable itself (summary, report, PR link, etc.) with **no tool calls after it** — `--output-format json` returns only the final turn's text, so any deliverable emitted before a subsequent tool call is silently dropped.

Run after completing a feature to validate everything before moving on. Incorporates pre-flight validation for the next feature.

## Steps

### Part A — Validate Current Feature

1. **Run full test suite** via the **test-runner** agent:
   - All test layers
   - Report pass/fail counts

2. **Check completed feature docs**: For the most recently completed feature, verify:
   - Domain types
   - UI components (if applicable)
   - Pages/routing (if applicable)
   - Unit tests
   - E2E tests (if applicable)
   - `TESTING_<FEATURE_NAME>.md` created
   - `FEATURE_PROMPTS.md` has completion notes
   - `DECISIONS.md` updated (if applicable)
   - Agent memory updated

3. **Summarize completed features**: For each completed feature, list:
   - Feature name and task count
   - Whether TESTING doc exists
   - Whether completion notes exist

### Part B — Pre-Flight for Next Feature

4. **Run the pre-flight agent** to validate readiness for the next feature:
   - Test suite health
   - Doc freshness
   - Agent config consistency
   - Next feature dependencies

5. **Present go/no-go decision**: Ask the user whether to proceed to the next feature or address issues first.

## Notes
- If tests fail, recommend fixing before proceeding.
- If the TESTING doc is missing, recommend running `/create-testing-prompt` before proceeding.
- If doc-updater phases were skipped, recommend running the **doc-updater** agent to catch up.
- This is a gate, not a rubber stamp. Be honest about gaps.
