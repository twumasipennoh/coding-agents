# /fix - Bug Fix with Diagnosis Gate

> **Pipeline announcements required.** This is a multi-step pipeline. Announce steps via `~/.claude/scripts/pipeline-step.sh` per the rule in `~/.claude/CLAUDE.md § "Pipeline step announcements"`. Use pipeline-id `bug-fix`, display name `Bug Fix`. Call `begin bug-fix "Bug Fix" --total <N>` at kickoff, `start`/`done`/`fail`/`skip` around each non-interactive step below, and `end bug-fix --status ok|fail` on completion. Skip interactive steps (user gates, clarification phases) — they self-announce. **Final output ordering (critical):** call `end` *before* emitting your final user-facing response. Your last message must be the deliverable itself (summary, report, PR link, etc.) with **no tool calls after it** — `--output-format json` returns only the final turn's text, so any deliverable emitted before a subsequent tool call is silently dropped.

Fix a bug using the **fix-advocate** agent for mandatory diagnosis before any code is written.

## Usage

```
/fix <bug description>
```

A bug description is required. If none given, ask the user for one before proceeding.

## Steps

### 1. Run fix-advocate — diagnosis (BLOCKING)

Invoke the **fix-advocate** agent and complete all 6 diagnosis steps:

1. **Reproduce** — Confirm the bug is reproducible. Identify the exact failure condition.
2. **Locate** — Find the file(s) and line(s) where the bug originates.
3. **Root cause** — Explain what is actually happening and why.
4. **Impact** — Describe what is affected (data, UX, security, performance).
5. **Propose fix** — Write a specific, minimal fix with rationale. Describe the change without implementing it yet.
6. **Defend** — Explain why this fix is correct and won't cause regressions.

**STOP here. Present the diagnosis to the user and wait for explicit approval before writing any code.**

### 2. Write fix code (only after approval)

After the user approves the proposed fix, implement it. Make the minimal change necessary — do not refactor, clean up, or improve surrounding code.

### 3. Run all quality gates

After the fix is written, run all gates:

**In parallel:**
- **pattern-enforcer**
- **security-reviewer**
- **monitoring-spec-validator**

**Then sequentially:**
- **test-runner** using this project's configured test command

### 4. Report

```
Bug Fix — <summary>

Diagnosis:   ✅ Complete (approved by user)
Fix applied: <one-line description of the change>

Gate Results:
  pattern-enforcer:          ✅ PASS / ❌ FAIL
  security-reviewer:         ✅ PASS / ❌ FAIL
  monitoring-spec-validator: ✅ PASS / ❌ FAIL
  test-runner:               ✅ PASS / ❌ FAIL (XX passed, XX failed)

Final: ✅ GO / ❌ NO-GO
```

## Notes
- Do NOT write any fix code before fix-advocate completes Steps 1-6 AND the user explicitly approves.
- If the user says "just fix it", still run fix-advocate first — this is non-negotiable.
- Keep the fix minimal. Resist the urge to clean up surrounding code.
