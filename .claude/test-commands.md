# coding-agents — Test Commands

Sidecar for `~/.claude/agents/test-runner.md`.

## Layers
- `unit + integration (vitest)`: `~/.claude/scripts/with-test-tmp.sh --label "coding-agents vitest" -- npx vitest run` (central Firebase drift gate: `tests/check-firebase-drift.test.ts` pure comparison, `tests/cli.test.ts` the real script launched against a scratch project with stubbed fetch; no network, no real keys)

## E2E Coverage Gate
None. The end-to-end path is `/deploy` in a Firebase project; it's covered by the manual QA checklist in `docs/prompts/FEATURE_PROMPTS.md` Feature 1.

## Pre-Test Setup
`npm ci --legacy-peer-deps` once (the system npm 9.2 crashes in arborist's peer-set loader without it).

## Post-Test Cleanup
None.
