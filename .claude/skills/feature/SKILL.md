# Feature Implementation Skill

This skill implements Pattern A (Feature Sprint) from `.claude/orchestration/ORCHESTRATION.md`.

**Do NOT skip any step.**

When implementing a feature, follow the revised pipeline defined in CLAUDE.md.

## Pipeline

### Step 0a — Verify
Check codebase state - does backend exist? What's actually implemented? Do not assume docs are accurate — check the code.

### Step 0b — Clarify
Run requirements clarification phases with user. If user references task numbers that don't exist, clarify before proceeding.

### Step 1 — Pre-Flight Validation
Run the **pre-flight** agent to verify the project is in a clean state:
- Test suite health (BLOCKING if tests fail)
- Doc freshness
- Agent config consistency
- Next feature readiness and dependency check

If pre-flight reports **BLOCKING** issues, fix them before proceeding. If **WARNING** issues, inform the user and let them decide.

### Step 2 — Write Failing Tests
Run the **test-creator** agent -> reads the task spec from `FEATURE_PROMPTS.md`, writes failing tests based on "Tests to Write First."

### Step 3 — Implement Feature
Run the **feature-creator** agent -> implements code to make the failing tests pass, follows "Implementation Steps."

### Step 4 — Review (parallel)
Run these two agents in parallel — both are read-only reviewers and ALWAYS run (no conditions):
- **pattern-enforcer** -> checks codebase conventions
- **security-reviewer** -> checks security posture

If either reports issues, fix them before proceeding.

### Step 5 — Test Suite
Run the **test-runner** agent -> full suite across all layers. Must be all green before proceeding.

### Step 6 — Doc Sync
Run the **doc-updater** agent -> performs all 7 phases:
1. Writes `TESTING_<FEATURE_NAME>.md` in `docs/prompts/`
2. Updates `FEATURE_PROMPTS.md` (checkboxes + completion notes)
3. Appends to `docs/DECISIONS.md` (if new decisions were made)
4. Updates agent memory (`.claude/agent-memory/`)
5. Updates PRD to reflect what was built
6. Updates `README.md` (new routes, endpoints, features, docs)
7. Flags items needing human attention (CLAUDE.md, agent configs)

### Step 7 — User Gate
Mark the task checkbox as complete in FEATURE_PROMPTS.md. If all tasks in the feature are now `[x]` (excluding `[-]` deferred items), also append `✅ COMPLETE` to the feature heading. Present the doc-updater's summary and GATES completion log to the user. Ask whether to proceed to the next feature.

### Step 8 — Commit
After user confirms go, stage and commit all changes with a descriptive commit message summarizing the feature/task implemented.

## Completion Criteria

Do not mark a task complete until:
- [ ] Pre-flight passed (no blockers)
- [ ] All tests green (full suite)
- [ ] E2E coverage gate passed (test-runner confirmed E2E tests ran OR justified skip)
- [ ] Pattern review clean
- [ ] Security review clean
- [ ] TESTING_<FEATURE_NAME>.md exists
- [ ] FEATURE_PROMPTS.md updated with completion notes and `✅ COMPLETE` on heading (if all tasks done)
- [ ] DECISIONS.md updated (if applicable)
- [ ] Agent memory updated
- [ ] PRD updated to reflect implementation
- [ ] README updated (if new routes/endpoints/features)
- [ ] User confirms go/no-go
