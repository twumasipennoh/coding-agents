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

**Phase A — Parallel static analysis (all read-only):**
- **pattern-enforcer** — checks codebase conventions. BLOCKING on VIOLATIONS.
- **security-reviewer** — static security analysis. BLOCKING on CRITICAL.
- **monitoring-spec-validator** — validates monitoring_spec.md. Reports DEFERRED if no spec exists.
- **frontend-design-reviewer** — CONDITIONAL: only if `~/.claude/scripts/needs-design-review.sh` exits 0. BLOCKING on CRITICAL. If exit 2 (no `ui-paths.txt`), report SKIPPED.

**Phase B — Sequential test gates:**
- **test-runner** — full test suite across all layers. BLOCKING.
- **acceptance-tester** — invoke as a full-tool agent (`subagent_type: claude`). BLOCKING if scenarios can't reach `Then` clause. Reports DEFERRED if `.claude/acceptance-config.md` missing and no `.claude/no-acceptance`. Reports SKIPPED if `.claude/no-acceptance` present.

**Auto-fix retry loop:**
```
for each gate that reported failure:
  attempt = 0
  while attempt < 3:
    auto-fix the reported issues
    re-run the gate
    if gate passes: break
    attempt += 1
  if attempt == 3:
    STOP — report "gate <name> failed after 3 retries: <persistent issues>"
    do NOT proceed to Step 2
```

Gate retry counts are **independent** — each gate tracks its own retry count. If auto-fixing one gate introduces a failure in another gate, that other gate gets its own 3 retries.

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
GATES: pattern-enforcer ✓ | security-reviewer ✓ | monitoring-spec-validator ✓/DEFERRED |
       frontend-design-reviewer ✓/SKIPPED | test-runner ✓ | acceptance-tester ✓/DEFERRED/SKIPPED |
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
