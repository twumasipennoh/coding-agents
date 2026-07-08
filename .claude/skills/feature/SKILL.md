# Feature Implementation Skill

> **Pipeline announcements required.** This is a multi-step pipeline. Announce steps via `~/.claude/scripts/pipeline-step.sh` per the rule in `~/.claude/CLAUDE.md § "Pipeline step announcements"`. Use pipeline-id `feature-sprint`, display name `Feature Sprint`. Call `begin feature-sprint "Feature Sprint" --total <N>` at kickoff, `start`/`done`/`fail`/`skip` around each non-interactive step below. Skip interactive steps (user gates, clarification phases) — they self-announce. **`end` is delegated to `/pipeline-tail`** — do NOT call `end` yourself. **Final output ordering (critical):** any trailing tool calls (`pipeline-step.sh done`, `log-rule-hit.sh`, TodoWrite cleanup) must come **before** your final user-facing text — the commit summary / PR link must be the last turn with **no tool calls after it**, or the openclaw gateway drops it (see `~/.claude/CLAUDE.md § "Final output ordering"`).

> **Pacing:** multi-part deliverables follow `~/.claude/references/one-beat-per-turn.md`.

This skill implements Pattern A (Feature Sprint) from `.claude/orchestration/ORCHESTRATION.md`.

**Do NOT skip any step.**

When implementing a feature, follow the revised pipeline defined in CLAUDE.md.

## Pipeline

### Step 0a — Verify
Check codebase state - does backend exist? What's actually implemented? Do not assume docs are accurate — check the code.

### Step 0b — Clarify
Run requirements clarification phases with user. If user references task numbers that don't exist, clarify before proceeding.

### Step 0c — Auto-branch

Detect the current branch. If on the base branch (`main` or `master`):
1. Derive a slug from the feature name or task description (e.g., `add-user-notifications` → `feature/add-user-notifications`).
2. Create the branch: `git checkout -b feature/<slug>`.
3. Log: "Created branch feature/<slug>."

If already on a non-base branch, stay on it and log: "Using existing branch <name>."

This must happen **before any implementation work** — all code changes must land on the feature branch, not on main.

### Step 0d — Test Baseline Snapshot

Capture the current test suite state BEFORE any implementation begins. This baseline lets test-runner classify failures later as PRE-EXISTING vs REGRESSION.

1. Read `.claude/test-commands.md` to get the test layer commands.
2. Run **ALL** test layers defined in `test-commands.md` (unit, integration, e2e, acceptance — every layer listed under `## Layers`). Do NOT skip any layer. Collect the names of any failing tests per layer.
3. Write the baseline to `.claude/state/test-baseline-<branch-name>.json`:
   ```json
   {
     "failing_by_layer": {
       "core unit": ["test.name.one"],
       "e2e": ["test.name.two"]
     },
     "layers_run": ["core unit", "web unit", "e2e"],
     "timestamp": "<ISO>",
     "branch": "<branch>"
   }
   ```
   - `failing_by_layer`: map of layer name → array of failing test names. Omit layers with zero failures.
   - `layers_run`: every layer that was executed (including those with zero failures). This is the completeness proof.
4. If all tests pass across all layers, write `{ "failing_by_layer": {}, "layers_run": ["...all layers..."], "timestamp": "...", "branch": "..." }`.
5. **Validation**: compare `layers_run` against the layers defined in `test-commands.md`. If any defined layer is missing from `layers_run`, the baseline is incomplete — re-run the missing layer(s) before proceeding.
6. If `.claude/test-commands.md` doesn't exist, skip this step (test-runner will classify all failures as UNCLASSIFIED).

**BLOCKING — main-must-be-green rule.** If any layer in `failing_by_layer` is non-empty, STOP the pipeline immediately. Report failing tests grouped by layer and refuse to proceed. The baseline is captured on a freshly-cut branch off main, so failing tests here mean main itself is red — starting new work on a red base hides regressions inside the "PRE-EXISTING permit" that pipeline-tail's Auto-Fix Constraints grant ([pipeline-tail.md § Auto-Fix Constraints](/home/kwaku/.claude/skills/pipeline-tail/SKILL.md#L71)). Fix main first (revert the offending commit, or fix forward on a dedicated repair branch), then re-run `/feature`.

Exception: if `.claude/test-commands.md` is missing (Step 6 above), the baseline step was skipped and this block does not apply — new/bootstrapping projects still proceed normally.

### Step 1 — Pre-Flight Validation
Run the **pre-flight** agent to verify the project is in a clean state:
- Test suite health (BLOCKING if tests fail)
- Doc freshness
- Agent config consistency
- Next feature readiness and dependency check

If pre-flight reports **BLOCKING** issues, fix them before proceeding. If **WARNING** issues, inform the user and let them decide.

### Step 2 — Write Failing Tests
Run the **test-creator** agent -> reads the task spec from `FEATURE_PROMPTS.md`, writes failing tests based on "Tests to Write First."

**Acceptance scenario checkpoint (BLOCKING):** Before proceeding to Step 3, verify that test-creator produced acceptance scenarios by checking test-creator's output summary for the `Acceptance scenarios:` line. If that line is absent, OR if running `grep -rl 'Given\|When\|Then' tests/acceptance/scenarios/*.md 2>/dev/null` returns empty, re-invoke test-creator with this explicit directive: "You exited without acceptance scenarios. Write Given/When/Then scenarios for this feature in `tests/acceptance/scenarios/<feature-slug>.md` per your Phase 4 section. This is BLOCKING." Do NOT proceed to implementation with only unit/integration tests. If the project has `.claude/no-acceptance`, skip this checkpoint.

### Step 2b — Wiring Gate (BLOCKING)

Run `~/.claude/scripts/check-wiring.sh --json PROJECT_ROOT` against the current codebase. This captures the pre-implementation wiring baseline. If the project has no `.claude/wiring-config.md`, the script auto-scaffolds one.

- If findings exist: note them as **pre-existing wiring gaps** (don't block — they predate this feature). Log the count.
- Pass the seam list from requirements-clarifier Phase 3 (if available) to Step 3 as implementation context.

### Step 3 — Implement Feature

**Pre-write call-chain trace (MANDATORY before writing any code):**
1. Read the task's "Implementation Steps" from `FEATURE_PROMPTS.md`.
2. For each step, trace the call chain from entry point to persistence. List every file you will touch and every integration point (where one module calls another, where a new parameter is passed, where a service is injected, where a route is registered).
3. Output the trace as a checklist:
   ```
   [ ] file.py:create_app — inject new_service (wiring: constructor param)
   [ ] routes.py:new_endpoint — register in blueprint (wiring: route registration)
   [ ] .env.example — add NEW_VAR (wiring: env var)
   ```
4. After writing all implementation code, verify against this checklist. Every item must be checked off. If any item was missed, fix it before proceeding. If you touched a file not in the trace, add it retroactively and verify its wiring.

**Post-write wiring re-check:** Run `~/.claude/scripts/check-wiring.sh --json PROJECT_ROOT` again. Compare findings to the pre-implementation baseline from Step 2b. Any NEW findings (not in baseline) are regressions introduced by this implementation — fix them before proceeding to Step 4.

**Proactive rule generation:** If during the trace you identify a seam type not covered by existing known-failures or script rules, emit a candidate to `~/.claude/state/wiring-rules/review-queue.jsonl`.

Run the **feature-creator** agent -> implements code to make the failing tests pass, follows "Implementation Steps."

### Step 4 — Monitoring (feature-only)

Run the **monitoring-implementer** agent. Produces/updates monitoring infrastructure from `monitoring_spec.md`. If no spec exists yet, reports DEFERRED and continues.

### Step 5 — Hand off to /pipeline-tail

After implementation and monitoring are complete, invoke the **`/pipeline-tail`** skill with:
- **pipeline-id:** `feature-sprint`
- **display-name:** `Feature Sprint`
- **skill-type:** `feature`

The tail skill handles: quality gates (with auto-fix retry, 3 per gate), doc-updater, memory-review, commit, push, PR creation, and final GATES summary + PR link output.

**Do NOT** call `pipeline-step.sh end`, emit a GATES log, commit, push, or create a PR yourself — the tail skill owns all of that.

## Completion Criteria

Do not mark a task complete until:
- [ ] Pre-flight passed (no blockers)
- [ ] All tests green (full suite)
- [ ] E2E coverage gate passed (test-runner confirmed E2E tests ran OR justified skip)
- [ ] Acceptance test passed (every Phase 4 scenario reached its `Then` clause, OR DEFERRED with missing-sidecar notice, OR SKIPPED via `.claude/no-acceptance`)
- [ ] Pattern review clean
- [ ] Security review clean
- [ ] TESTING_<FEATURE_NAME>.md exists
- [ ] FEATURE_PROMPTS.md updated with completion notes and `✅ COMPLETE` on heading (if all tasks done)
- [ ] DECISIONS.md updated (if applicable)
- [ ] Agent memory updated
- [ ] PRD updated to reflect implementation
- [ ] README updated (if new routes/endpoints/features)
- [ ] PR created with GATES log + PR link
