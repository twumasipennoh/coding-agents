# /test - Run Test Suite

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
