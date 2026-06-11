# /fix - Bug Fix with Diagnosis Gate

> **Pipeline announcements required.** This is a multi-step pipeline. Announce steps via `~/.claude/scripts/pipeline-step.sh` per the rule in `~/.claude/CLAUDE.md § "Pipeline step announcements"`. Use pipeline-id `bug-fix`, display name `Bug Fix`. Call `begin bug-fix "Bug Fix" --total <N>` at kickoff, `start`/`done`/`fail`/`skip` around each non-interactive step below. Skip interactive steps (user gates, clarification phases) — they self-announce. **`end` is delegated to `/pipeline-tail`** — do NOT call `end` yourself.

Fix a bug using the **fix-advocate** agent for mandatory diagnosis before any code is written.

## Usage

```
/fix <bug description>
```

A bug description is required. If none given, ask the user for one before proceeding.

## Steps

### 0. Auto-branch

Detect the current branch. If on the base branch (`main` or `master`):
1. Derive a slug from the bug description (e.g., `login-redirect-loop` → `fix/login-redirect-loop`).
2. Create the branch: `git checkout -b fix/<slug>`.
3. Log: "Created branch fix/<slug>."

If already on a non-base branch, stay on it and log: "Using existing branch <name>."

This must happen **before any implementation work** — all code changes must land on the fix branch, not on main.

### 1. Run fix-advocate — diagnosis (BLOCKING)

Invoke the **fix-advocate** agent and complete all 6 diagnosis steps:

1. **Reproduce** — Confirm the bug is reproducible. Identify the exact failure condition.
2. **Locate** — Find the file(s) and line(s) where the bug originates.
3. **Root cause** — Explain what is actually happening and why.
4. **Impact** — Describe what is affected (data, UX, security, performance).
5. **Propose fix** — Write a specific, minimal fix with rationale. Describe the change without implementing it yet.
6. **Defend** — Explain why this fix is correct and won't cause regressions.

**STOP here. Present the diagnosis to the user and wait for explicit approval before proceeding.**

### 2. Write failing tests (only after approval, BLOCKING)

After the user approves, construct a `fix-spec` block from the fix-advocate diagnosis and invoke **test-creator** in Mode B:

```
fix-spec:
  root-cause: <from fix-advocate step 3>
  affected-paths: <from fix-advocate step 2 — files and functions>
  proposed-change: <from fix-advocate step 5>
  change-type: bug-fix
```

**STOP. Do not write any implementation code until test-creator confirms test files exist and are failing for the right reasons (assertion failures, not syntax errors or import errors).**

~100% coverage required at every reachable layer:
- **Unit** — pure logic, validation, model behavior. Happy path, unhappy (bad input, missing fields, error branches), edge (boundary values, empty inputs, all enum branches).
- **Integration** — cross-component behavior, DB/repo layer, mocked external services. Happy, unhappy (service 4xx/5xx, DB write fail, auth rejected), edge (idempotency, partial data, concurrent writes).
- **Acceptance** — full user-facing flow. Happy, unhappy (invalid inputs, session expiry, permission denied), edge (very long content, back-navigation, deep links).

Never leave any category empty for any layer.

**Acceptance-test checkpoint (BLOCKING):** Before proceeding, verify that test-creator produced at least one acceptance-layer test file. If acceptance tests are missing, re-invoke test-creator with an explicit directive to write the acceptance layer. Do NOT proceed to implementation with only unit/integration tests.

### 3. Write fix code (only after tests are confirmed failing)

After test-creator confirms failing tests exist, implement the fix. Make the minimal change necessary — do not refactor, clean up, or improve surrounding code.

### 4. Hand off to /pipeline-tail

After the fix is written, invoke the **`/pipeline-tail`** skill with:
- **pipeline-id:** `bug-fix`
- **display-name:** `Bug Fix`
- **skill-type:** `fix`

The tail skill handles: quality gates (with auto-fix retry, 3 per gate), doc-updater, memory-review, commit, push, PR creation, and final GATES summary + PR link output.

**Do NOT** call `pipeline-step.sh end`, emit a GATES log, commit, push, or create a PR yourself — the tail skill owns all of that.

## Notes
- Do NOT write any fix code before fix-advocate completes Steps 1-6 AND the user explicitly approves.
- Do NOT write fix code before test-creator confirms failing tests exist — this is a hard sequencing gate.
- If the user says "just fix it", still run fix-advocate first — this is non-negotiable.
- Keep the fix minimal. Resist the urge to clean up surrounding code.
