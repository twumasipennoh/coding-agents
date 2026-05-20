# /test - Run Test Suite

> **Pipeline announcements required.** This is a multi-step pipeline. Announce steps via `~/.claude/scripts/pipeline-step.sh` per the rule in `~/.claude/CLAUDE.md § "Pipeline step announcements"`. Use pipeline-id `test`, display name `Test`. Call `begin test "Test" --total 3` at kickoff, `start`/`done`/`fail`/`skip` around each non-interactive step below, and `end test --status ok|fail` on completion. Skip interactive steps (user gates, clarification phases) — they self-announce. **Final output ordering (critical):** call `end` *before* emitting your final user-facing response. Your last message must be the deliverable itself (summary, report, PR link, etc.) with **no tool calls after it** — `--output-format json` returns only the final turn's text, so any deliverable emitted before a subsequent tool call is silently dropped.

Delegates to the **test-runner** agent. This skill is a shortcut — all test execution logic lives in `.claude/agents/test-runner.md`.

## What to Do

Run the **test-runner** agent with the default run order:

1. Unit tests
2. Integration tests (if they exist)
3. E2E tests

## Arguments

- If the user specifies a test file or pattern (e.g., `/test auth.test.ts`), pass it to the test-runner agent as the target scope.
- If no arguments, run the full suite.

## Notes
- Do NOT fix failing tests — just report them.
- See `.claude/agents/test-runner.md` for full details on run order and reporting format.
