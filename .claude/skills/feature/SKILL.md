# Feature Implementation Skill

> **Pipeline announcements required.** This is a multi-step pipeline. Announce steps via `~/.claude/scripts/pipeline-step.sh` per the rule in `~/.claude/CLAUDE.md § "Pipeline step announcements"`. Use pipeline-id `feature-sprint`, display name `Feature Sprint`. Call `begin feature-sprint "Feature Sprint" --total <N>` at kickoff, `start`/`done`/`fail`/`skip` around each non-interactive step below. Skip interactive steps (user gates, clarification phases) — they self-announce. **`end` is delegated to `/pipeline-tail`** — do NOT call `end` yourself.

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

### Step 1 — Pre-Flight Validation
Run the **pre-flight** agent to verify the project is in a clean state:
- Test suite health (BLOCKING if tests fail)
- Doc freshness
- Agent config consistency
- Next feature readiness and dependency check

If pre-flight reports **BLOCKING** issues, fix them before proceeding. If **WARNING** issues, inform the user and let them decide.

### Step 2 — Write Failing Tests
Run the **test-creator** agent -> reads the task spec from `FEATURE_PROMPTS.md`, writes failing tests based on "Tests to Write First."

**Acceptance scenario checkpoint (BLOCKING):** Before proceeding to Step 3, verify that test-creator wrote at least one acceptance scenario (Given/When/Then file in `tests/acceptance/scenarios/` or equivalent per the project's `.claude/acceptance-config.md` Scenario Source). If acceptance scenarios are missing, re-invoke test-creator with an explicit directive to write the acceptance layer. Do NOT proceed to implementation with only unit/integration tests. If the project has `.claude/no-acceptance`, skip this checkpoint.

### Step 3 — Implement Feature
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
