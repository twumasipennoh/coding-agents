# /patch — Quick Fix or Design Tweak with Gates

> **Pipeline announcements required.** This is a multi-step pipeline. Announce steps via `~/.claude/scripts/pipeline-step.sh` per the rule in `~/.claude/CLAUDE.md § "Pipeline step announcements"`. Use pipeline-id `patch`, display name `Patch`. Call `begin patch "Patch" --total <N>` at kickoff, `start`/`done`/`fail`/`skip` around each non-interactive step below, and `end patch --status ok|fail` on completion. Skip interactive steps (user gates, clarification phases) — they self-announce. **Final output ordering (critical):** call `end` *before* emitting your final user-facing response. Your last message must be the deliverable itself (summary, report, PR link, etc.) with **no tool calls after it** — `--output-format json` returns only the final turn's text, so any deliverable emitted before a subsequent tool call is silently dropped.

Lightweight flow for small fixes and design tweaks. Runs the right quality gates without the full feature pipeline.

## Usage

```
/patch <description of the fix or tweak>
```

A description is required. If none given, ask the user for one before proceeding.

## Steps

### 1. Classify the change

Determine whether this is a **bug fix** or a **design tweak**:
- **Bug fix** — something is broken, producing wrong behavior, or failing.
- **Design tweak** — UI adjustment, style change, small UX improvement, copy change, layout fix, minor refactor.

State your classification and proceed.

### 2. Diagnosis gate (bug fixes only)

**Skip this step entirely for design tweaks.**

For bug fixes, invoke the **fix-advocate** agent and complete all 6 diagnosis steps:

1. **Reproduce** — Confirm the bug is reproducible.
2. **Locate** — Find the file(s) and line(s) where the bug originates.
3. **Root cause** — Explain what is actually happening and why.
4. **Impact** — Describe what is affected (data, UX, security, performance).
5. **Propose fix** — Write a specific, minimal fix with rationale.
6. **Defend** — Explain why this fix is correct and won't cause regressions.

**STOP. Present the diagnosis to the user and wait for explicit approval before writing any code.**

### 3. Implement

Make the change. Keep it minimal — do not refactor, clean up, or improve surrounding code beyond what the fix/tweak requires.

### 4. Run quality gates

**In parallel (all read-only):**
- **pattern-enforcer** — checks codebase conventions
- **security-reviewer** — static security analysis
- **monitoring-spec-validator** — validates monitoring_spec.md

**Then sequentially:**
- **test-runner** — run the project's full test suite

**Conditional:**
- **frontend-design-reviewer** — only if changed files touch frontend/UI code. BLOCKING on CRITICAL findings only.

**Then:**
- **doc-updater** — run all applicable doc-sync phases. BLOCKING.

### 5. Report

```
Patch — <summary>

Type:        Bug fix / Design tweak
Diagnosis:   ✅ Complete (approved) / ⏭️ SKIPPED (design tweak)
Change:      <one-line description>

Gate Results:
  pattern-enforcer:          ✅ PASS / ❌ FAIL
  security-reviewer:         ✅ PASS / ❌ FAIL
  monitoring-spec-validator: ✅ PASS / ❌ FAIL
  frontend-design-reviewer:  ✅ PASS / ❌ FAIL / ⏭️ SKIPPED
  test-runner:               ✅ PASS / ❌ FAIL (XX passed, XX failed)
  doc-updater:               ✅ PASS / ❌ FAIL

Final: ✅ GO / ❌ NO-GO
```

If NO-GO, list each failing gate with the specific findings that must be resolved.

## Notes
- For bug fixes: do NOT write code before fix-advocate diagnosis + user approval.
- For design tweaks: proceed directly to implementation — no diagnosis gate.
- If the user explicitly says "skip gates" or "no gates", respect that and only implement.
- Do NOT auto-fix gate failures — report and wait for user direction.
