# /gate-check - Run All Quality Gates

> **Pipeline announcements required.** This is a multi-step pipeline. Announce steps via `~/.claude/scripts/pipeline-step.sh` per the rule in `~/.claude/CLAUDE.md § "Pipeline step announcements"`. Use pipeline-id `gate-check`, display name `Gate Check`. Call `begin gate-check "Gate Check" --total <N>` at kickoff, `start`/`done`/`fail`/`skip` around each non-interactive step below, and `end gate-check --status ok|fail` on completion. Skip interactive steps (user gates, clarification phases) — they self-announce. **Final output ordering (critical):** call `end` *before* emitting your final user-facing response. Your last message must be the deliverable itself (summary, report, PR link, etc.) with **no tool calls after it** — `--output-format json` returns only the final turn's text, so any deliverable emitted before a subsequent tool call is silently dropped.

Run all quality gates and return a consolidated GO/NO-GO decision.

## Steps

### 1. Run review gates in parallel
Run these three agents simultaneously (all read-only):
- **pattern-enforcer** — checks codebase conventions
- **security-reviewer** — static security analysis
- **monitoring-spec-validator** — validates monitoring_spec.md is present and complete

### 2. Run test suite
After the parallel review gates complete, run the **test-runner** agent with the project's test command (check package.json or Makefile for the test runner configured for this project).

### 2b. Run acceptance-tester
After test-runner, run the **acceptance-tester** agent against the Phase 4 scenarios. **BLOCKING** if any scenario can't reach its `Then` clause. Reports `DEFERRED` if `.claude/acceptance-config.md` is missing AND `.claude/no-acceptance` is absent. Reports `SKIPPED` if the opt-out marker is present. See `~/.claude/agents/acceptance-tester.md` for the contract.

### 3. Pipeline audit (step-announcement pairing check)

Scan the current session's pipeline audit logs for unmatched `start` events. This enforces the rule in `~/.claude/CLAUDE.md § "Pipeline step announcements"` — every announced `start` must have a matching `done`, `fail`, or `skip`. Unmatched events indicate the pipeline ran but a step didn't report its outcome.

1. Resolve the session id: `$CLAUDE_SESSION_ID` → `$OPENCLAW_SESSION_ID` → `pid-<PPID>`.
2. Glob `~/.claude/state/pipelines/*-<session>.jsonl`. For each matching file, parse the JSONL events.
3. For each `start` event, look for a matching terminator (`done` / `fail` / `skip`) with the same `step` value later in the file. Build a list of unmatched starts (if any).
4. Report:
   - `✅ Pipeline audit: all announced steps paired.` — if every `start` has a terminator.
   - `⚠️ Pipeline audit: N unmatched start event(s) — <step labels>.` — if the current session has active-but-unterminated steps. This is WARN when steps are in-flight (concurrent work); upgrade to FAIL if a pipeline's `end` event was reached while leaving starts unmatched.
   - `⏭️ Pipeline audit: no audit logs in this session.` — if no files match; SKIP (no pipelines have been announced; nothing to audit).

Add the result row to the gate results table: `pipeline-audit: ✅ PASS / ⚠️ WARN / ❌ FAIL / ⏭️ SKIPPED`.

### 4. Reply format

**Default chat reply: 1-3 sentences, no template, lead with N/M
gates passed + any failures.** Pattern:

    gates: N/M passed. <"clean" OR "fail: <one-line list>">.

If multiple gates failed, apply the one-beat rule from
`~/.claude/CLAUDE.md § "Multi-part answers — one beat per turn"` —
open with the count, deliver the most urgent failure, offer the rest
if asked.

The structured per-gate tickbox format is **opt-in only** — emit it
only when the user explicitly asks for "the full breakdown",
"expand", or "details". Don't lead with it.

If asked to expand, use this template:

```
Gate Results:

pattern-enforcer:          ✅ PASS / ⚠️ WARN / ❌ FAIL
security-reviewer:         ✅ PASS / ⚠️ WARN / ❌ FAIL
monitoring-spec-validator: ✅ PASS / ⚠️ WARN / ❌ FAIL
test-runner:               ✅ PASS / ❌ FAIL (XX passed, XX failed)

Final: ✅ GO / ❌ NO-GO
```

If NO-GO, list each failing gate with the specific findings that must be resolved.

## Notes
- Default chat reply is 1-3 sentences in one message. Structured format is opt-in only.
- Do NOT fix issues automatically — report them and wait for user direction.
- FAIL on any gate = NO-GO. WARN is informational only and does not block.
- Adapt the test-runner command to whichever test framework this project uses.
