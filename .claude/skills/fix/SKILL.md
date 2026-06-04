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
- **acceptance-tester** — re-runs the Phase 4 scenarios that the bug touches (or all of them, if scope is unclear). **BLOCKING** if any scenario can't reach its `Then` clause. Reports `DEFERRED` if `.claude/acceptance-config.md` is missing AND `.claude/no-acceptance` is absent. Reports `SKIPPED` if the opt-out marker is present. See `~/.claude/agents/acceptance-tester.md` for the contract.

### 4. Reply format

> ⚠️ **Call `pipeline-step.sh end bug-fix --status ok|fail` before writing any text.** End-before-deliverable rule — the reply must be the final turn with no tool calls after it.

**Default chat reply: 1-3 sentences, no template, lead with outcome
+ gate summary.** Pattern:

    fix: <one-line outcome>. gates: <N/M passed>. <"push?" if green,
    "blocker: <one-line>" if red>

If multiple gates failed, apply the one-beat rule from
`~/.claude/CLAUDE.md § "Multi-part answers — one beat per turn"` —
open with the count, deliver the most urgent failure, offer the rest
if asked.

The structured Diagnosis/Fix/Gate Results format is **opt-in only** —
emit it only when the user explicitly asks for "the full breakdown",
"expand", or "details". Don't lead with it.

If asked to expand, use this template:

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
- Default chat reply is 1-3 sentences in one message. Structured format is opt-in only.
- Do NOT write any fix code before fix-advocate completes Steps 1-6 AND the user explicitly approves.
- If the user says "just fix it", still run fix-advocate first — this is non-negotiable.
- Keep the fix minimal. Resist the urge to clean up surrounding code.
