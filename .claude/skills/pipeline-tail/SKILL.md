# /pipeline-tail — Auto-PR Pipeline Tail

> **Pipeline announcements — inherited.** This skill runs as a continuation of a parent pipeline (`/feature`, `/fix`, `/patch`). It inherits the parent's pipeline-id and display name. The parent calls `begin`; this skill calls `end`. Announce `start`/`done`/`fail`/`skip` around each non-interactive step below using the inherited pipeline-id. **Final output ordering (critical):** call `end` *before* emitting your final user-facing response. Your last message must be the deliverable itself (GATES log + PR link) with **no tool calls after it**.

> **Not user-invocable.** This skill is invoked by parent skills (`/feature`, `/fix`, `/patch`) at the end of their pipelines. It is not meant to be called directly by the user.

Shared tail sequence that runs after implementation is complete. Handles: quality gates with auto-fix retries, doc-updater, memory-review, commit, push, PR creation, and final GATES summary output.

## Input Contract

The parent skill must provide:
- **pipeline-id** — the pipeline-step.sh ID in use (e.g., `feature-sprint`, `bug-fix`, `patch`)
- **display-name** — human-readable pipeline name (e.g., `Feature Sprint`, `Bug Fix`, `Patch`)
- **skill-type** — one of `feature`, `fix`, `patch` (used for GATES log labeling)

The parent skill is responsible for:
- Creating the branch (if on main) before any implementation work
- Running implementation steps (test-creator, feature-creator / fix code / patch code)
- Calling `pipeline-step.sh begin` at pipeline start

The parent skill must NOT:
- Call `pipeline-step.sh end` — the tail skill owns that
- Emit a GATES completion log — the tail skill owns that
- Commit, push, or create PRs — the tail skill owns that

## Steps

### 1. Run quality gates (auto-fix with retry)

Run gates in this order. Each gate gets up to **3 retries** on failure. On failure: auto-fix the issue, then re-run that specific gate. If a gate exhausts its 3 retries, **STOP the entire pipeline** — do not commit, push, or create a PR. Report the persistent failure and leave the branch as-is.

**Phase A-0 — Deterministic wiring gate (pre-analysis):**
Run `~/.claude/scripts/check-wiring.sh --json PROJECT_ROOT` before launching the parallel agents. Pass its JSON output to **pattern-enforcer** as invocation context so it can escalate findings to semantic verification. If the script exits 2 (tool failure), log a warning and continue — don't block on tooling issues.

**Phase A — Parallel static analysis (all read-only):**
- **pattern-enforcer** — checks codebase conventions + consumes `check-wiring.sh` output for semantic escalation. BLOCKING on VIOLATIONS.
- **security-reviewer** — static security analysis. BLOCKING on CRITICAL.
- **test-gap-auditor** — audits test coverage for blind spots (Mode C: Implementation Audit). Runs the mandatory three-section checklist (scenario coverage, layer coverage, wiring coverage) against the implementation diff and test files. BLOCKING on GAP findings — gaps trigger the auto-fix retry loop (write missing tests, re-run auditor). NOT user-blocking — the pipeline self-heals.
- **monitoring-spec-validator** — validates monitoring_spec.md. Reports DEFERRED if no spec exists.
- **frontend-design-reviewer** — CONDITIONAL: only if `~/.claude/scripts/needs-design-review.sh` exits 0. BLOCKING on CRITICAL. If exit 2 (no `ui-paths.txt`), report SKIPPED.

**Phase B — Sequential test gates (with shared test environment):**

Before running any Phase B gate, start the test environment deterministically:
- **Test Environment Setup** — run `~/.claude/scripts/acceptance-infra.sh start $(pwd)` via Bash (not an LLM agent). This starts emulators/dev servers per the project's `.claude/acceptance-config.md` Pre-Run Setup block, with retry logic and the cross-project lock. If the project has no `acceptance-config.md`, skip this sub-step (test-runner manages its own Pre-Test Setup via `test-commands.md`). Announce via `pipeline-step.sh start/done/fail`.
- If setup fails after retries, BLOCK the pipeline — do not proceed to test gates.

Then run the gates sequentially:
- **test-runner** — full test suite across all layers. BLOCKING. Emulators are already running; test-runner's Pre-Test Setup should verify (check) but not re-start.
- **acceptance-tester** — invoke as a full-tool agent (`subagent_type: claude`). BLOCKING if scenarios can't reach `Then` clause. Reports DEFERRED only if sidecar was auto-scaffolded (missing `.claude/acceptance-config.md`). Reports SKIPPED if `.claude/no-acceptance` present. Emulators are already running; Pre-Run Setup checks should find state = `ours` and reuse.

After Phase B completes (success or failure):
- **Test Environment Teardown** — run `~/.claude/scripts/acceptance-infra.sh stop $(pwd)` via Bash. Always runs (success or failure). Announce via `pipeline-step.sh start/done`. Do NOT skip on failure — cleanup must happen.

**Auto-fix retry loop:**
```
for each gate that reported failure:
  attempt = 0
  while attempt < 3:
    auto-fix the reported issues (subject to Auto-Fix Constraints below)
    re-run the gate
    if gate passes: break
    attempt += 1
  if attempt == 3:
    STOP — report "gate <name> failed after 3 retries: <persistent issues>"
    do NOT proceed to Step 2
```

Gate retry counts are **independent** — each gate tracks its own retry count. If auto-fixing one gate introduces a failure in another gate, that other gate gets its own 3 retries.

### Auto-Fix Constraints (MANDATORY — applies to all retry attempts)

When auto-fixing test-runner failures, you MUST follow these rules based on the failure classification from test-runner's output:

**By classification:**
- **REGRESSION** failures (tests that were passing before our changes): fix the APPLICATION CODE to make the test pass. The test caught a real bug in our changes. Do NOT modify the test.
- **NEW-FAILING** failures (test-creator's tests for the new feature/fix): fix the APPLICATION CODE to satisfy the test contract. These tests define what the implementation should do. Do NOT modify the test.
- **PRE-EXISTING** failures (tests already broken before our branch): do NOT fix these. They aren't caused by our changes. Note them in the GATES log as "PRE-EXISTING: X failures (not caused by this branch)" and exclude them from the gate pass/fail decision.
- **UNCLASSIFIED** failures (no baseline available): treat as REGRESSION — fix the application code, not the test.

**Hard rules (never violate):**
- **NEVER** add `.skip()`, `.todo()`, `xit()`, `xdescribe()`, `@pytest.mark.skip`, `@unittest.skip`, or any test-skipping annotation as an auto-fix.
- **NEVER** weaken, loosen, or delete a test assertion to make it pass. If `expect(x).toBe(5)` fails because `x` is `3`, the fix is making the code produce `5`, not changing the assertion to `toBe(3)`.
- **NEVER** delete a test file or test case as an auto-fix.
- **NEVER** wrap a failing assertion in a try/catch that swallows the error.
- **IF a test is genuinely wrong** (bad assertion logic, not a code bug — e.g., the test asserts a wrong HTTP status code that was never correct): you MAY fix the test, but MUST include a one-line comment explaining why the test was wrong (e.g., `// was asserting 201 but this endpoint returns 200 per the route definition`). This is the ONLY permitted test modification, and it requires the comment.

**Diagnosis before fix:** Before writing any auto-fix code, classify the failure:
1. Read the failing test's assertion and the code it tests.
2. Determine: is the test correct and the code wrong? Or is the test wrong?
3. In >95% of cases, the test is correct and the code is wrong. Default to fixing application code.
4. If you believe the test is wrong, state your reasoning in a one-line note before modifying it.

After all gates in Phase A pass, proceed to Phase B. After all gates pass, proceed to Step 2.

### 2. Doc sync

Run the **doc-updater** agent — performs all 7 doc-sync phases:
1. Writes `TESTING_<FEATURE_NAME>.md` in `docs/prompts/`
2. Updates `FEATURE_PROMPTS.md` (checkboxes + completion notes)
3. Appends to `docs/DECISIONS.md` (if new decisions)
4. Updates agent memory (`.claude/agent-memory/`)
5. Updates PRD to reflect what was built
6. Updates `README.md` (new routes, endpoints, features)
7. Flags items needing human attention

BLOCKING — if doc-updater fails, apply the same 3-retry auto-fix loop.

### 3. Memory review

Run **memory-review** to audit memory health based on the work done in this pipeline run. Auto-implement all recommendations:
- **Create** new memory files as recommended
- **Update** existing memory files with new information
- **Delete** stale or outdated memory entries
- **Update MEMORY.md index** to reflect changes

Record what actions were taken for the GATES log (e.g., "created feedback_auto_pr.md, updated project_pipeline_tail.md").

This step is non-blocking — if memory-review has no recommendations, note "no memory changes" in the log and continue.

### 4. Commit + push

1. Stage all changed files: `git add` the specific files changed during this pipeline run (implementation files, test files, doc files, memory files). Do not use `git add -A`.
2. Commit with a descriptive message summarizing the work. Include `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`.
3. Push the branch: `git push -u origin <branch-name>`.

### 5. Create PR

1. Detect base branch (`main` or `master`).
2. Check for existing PR on this branch — if one exists, return its URL instead of creating a duplicate.
3. Generate PR title from branch name + commit themes (same logic as `/pr` skill).
4. Generate PR body:

```
## Summary
- <bullet points from commits and implementation context>

## Changes
<diff stat summary>

## Gates
<GATES completion log — same format as Step 6 output>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

5. Create PR: `gh pr create --title "<title>" --body "<body>" --base <base-branch>`
6. Capture the PR URL.

### 6. Final output

> ⚠️ **Call `pipeline-step.sh end <pipeline-id> --status ok|fail` before writing any text.** End-before-deliverable rule — the reply must be the final turn with no tool calls after it.

Emit the GATES completion log + PR link as the final message:

```
GATES: pattern-enforcer ✓ | security-reviewer ✓ | test-gap-auditor ✓ |
       monitoring-spec-validator ✓/DEFERRED | frontend-design-reviewer ✓/SKIPPED |
       test-runner ✓ | acceptance-tester ✓/DEFERRED/SKIPPED |
       doc-updater ✓ | memory-review ✓ (<N> actions)

Memory: <created X, updated Y, deleted Z — or "no changes">

PR: <URL>
```

If any gate required retries, note it: `pattern-enforcer ✓ (2 retries)`.

### Failure path

If any gate exhausts its 3 retries:

1. Call `pipeline-step.sh end <pipeline-id> --status fail --note "<gate> failed after 3 retries"`.
2. Emit a failure report as the final message:

```
PIPELINE FAILED — <gate-name> could not be fixed after 3 retries.

Persistent issues:
- <issue 1>
- <issue 2>

Branch <branch-name> has uncommitted auto-fix attempts. Gates that passed:
  pattern-enforcer ✓ | security-reviewer ✓ | test-runner ❌ (3 retries exhausted)
```

Do NOT commit, push, or create a PR on failure.

## Notes
- This skill is composition-only — parent skills invoke it, users don't.
- The parent skill owns branch creation and `pipeline-step.sh begin`. This skill owns `pipeline-step.sh end`.
- Gate retry counts are per-gate, not total. Each gate gets 3 independent retries.
- Auto-fix means: read the gate's failure report, apply code/doc changes to resolve the issues, then re-run the gate.
- The final message (GATES log + PR link) must be the last assistant turn with no tool calls after it.
