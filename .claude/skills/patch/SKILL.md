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

**STOP. Present the diagnosis to the user and wait for explicit approval before proceeding.**

### 3. Write failing tests (BLOCKING — before any implementation)

**Bug fix path:** Construct a `fix-spec` block from the fix-advocate diagnosis and invoke **test-creator** in Mode B:

```
fix-spec:
  root-cause: <from fix-advocate step 3>
  affected-paths: <from fix-advocate step 2 — files and functions>
  proposed-change: <from fix-advocate step 5>
  change-type: bug-fix
```

**STOP. Do not write any implementation code until test-creator confirms test files exist and are failing for the right reasons.**

~100% coverage required at every reachable layer:
- **Unit** — pure logic, validation, model behavior. Happy path, unhappy (bad input, missing fields, error branches), edge (boundary values, empty inputs, all enum branches).
- **Integration** — cross-component behavior, DB/repo layer, mocked external services. Happy, unhappy (service 4xx/5xx, DB write fail, auth rejected), edge (idempotency, partial data, concurrent writes).
- **Acceptance** — full user-facing flow. Happy, unhappy (invalid inputs, session expiry, permission denied), edge (very long content, back-navigation, deep links).

Never leave any category empty for any layer.

---

**Design tweak path:** Construct a `fix-spec` block from the patch description and the files to be changed, then invoke **test-creator** in Mode B:

```
fix-spec:
  root-cause: N/A (design tweak)
  affected-paths: <files that will be changed>
  proposed-change: <description of the intended visual/behavioral target state>
  change-type: design-tweak
```

**STOP. Do not implement until test-creator confirms acceptance test files exist and are failing** (they describe the intended target state, which doesn't exist yet).

~100% acceptance-layer coverage required — no unit or integration tests:
- **Happy** — intended visual/behavioral change is present and correct.
- **Unhappy** — old broken/incorrect state no longer exists.
- **Edge** — boundary states (empty content, long text, mobile viewport, reduced motion).

Never leave any category empty.

### 4. Implement

Make the change. Keep it minimal — do not refactor, clean up, or improve surrounding code beyond what the fix/tweak requires.

### 5. Run quality gates

**In parallel (all read-only):**
- **pattern-enforcer** — checks codebase conventions
- **security-reviewer** — static security analysis
- **monitoring-spec-validator** — validates monitoring_spec.md

**Then sequentially:**
- **test-runner** — run the project's full test suite
- **acceptance-tester** — re-runs the Phase 4 scenarios that touch the patched code. **BLOCKING** if any scenario can't reach its `Then` clause. Reports `DEFERRED` if `.claude/acceptance-config.md` is missing AND `.claude/no-acceptance` is absent. Reports `SKIPPED` if the opt-out marker is present. See `~/.claude/agents/acceptance-tester.md` for the contract.

**Conditional:**
- **frontend-design-reviewer** — only if changed files touch frontend/UI code. BLOCKING on CRITICAL findings only.

**Then:**
- **doc-updater** — run all applicable doc-sync phases. BLOCKING.

### 6. Reply format

> ⚠️ **Call `pipeline-step.sh end patch --status ok|fail` before writing any text.** End-before-deliverable rule — the reply must be the final turn with no tool calls after it.

**Default chat reply: 1-3 sentences, no template, lead with outcome
+ gate summary.** Pattern:

    patch: <one-line outcome>. gates: <N/M passed>. <"push?" if green,
    "blocker: <one-line>" if red>

If multiple gates failed, apply the one-beat rule from
`~/.claude/CLAUDE.md § "Multi-part answers — one beat per turn"` —
open with the count, deliver the most urgent failure, offer the rest
if asked.

The structured Type/Diagnosis/Tests/Change/Gate Results format is **opt-in
only** — emit it only when the user explicitly asks for "the full
breakdown", "expand", or "details". Don't lead with it.

If asked to expand, use this template:

```
Patch — <summary>

Type:        Bug fix / Design tweak
Diagnosis:   ✅ Complete (approved) / ⏭️ SKIPPED (design tweak)
Tests:       ✅ Written (<N> tests across <layers>)
Change:      <one-line description>

Gate Results:
  pattern-enforcer:          ✅ PASS / ❌ FAIL
  security-reviewer:         ✅ PASS / ❌ FAIL
  monitoring-spec-validator: ✅ PASS / ❌ FAIL
  frontend-design-reviewer:  ✅ PASS / ❌ FAIL / ⏭️ SKIPPED
  test-runner:               ✅ PASS / ❌ FAIL (XX passed, XX failed)
  acceptance-tester:         ✅ PASS / ❌ FAIL / ⏭️ DEFERRED / ⏭️ SKIPPED
  doc-updater:               ✅ PASS / ❌ FAIL

Final: ✅ GO / ❌ NO-GO
```

If NO-GO, list each failing gate with the specific findings that must be resolved.

## Notes
- Default chat reply is 1-3 sentences in one message. Structured format is opt-in only.
- For bug fixes: do NOT write code before fix-advocate diagnosis + user approval.
- For bug fixes: do NOT write code before test-creator confirms failing tests exist — hard sequencing gate.
- For design tweaks: do NOT implement before test-creator confirms acceptance tests exist and are failing.
- If the user explicitly says "skip gates" or "no gates", respect that and only implement.
- Do NOT auto-fix gate failures — report and wait for user direction.
