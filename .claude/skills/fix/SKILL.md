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

### 0b. Test Baseline Snapshot

Capture the current test suite state BEFORE any implementation begins. This baseline lets test-runner classify failures later as PRE-EXISTING vs REGRESSION.

1. Read `.claude/test-commands.md` to get the test layer commands.
2. Run each test layer and collect the names of any failing tests.
3. Write the baseline to `.claude/state/test-baseline-<branch-name>.json`:
   ```json
   { "failing": ["test.name.one", "test.name.two"], "timestamp": "<ISO>", "branch": "<branch>" }
   ```
4. If all tests pass, write `{ "failing": [], "timestamp": "...", "branch": "..." }`.
5. If `.claude/test-commands.md` doesn't exist, skip this step (test-runner will classify all failures as UNCLASSIFIED).

This step is non-blocking — pre-existing failures are recorded, not fixed. They'll be excluded from the gate in pipeline-tail.

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

**Acceptance scenario checkpoint (BLOCKING):** Before proceeding, verify that test-creator produced acceptance scenarios by checking test-creator's output summary for the `Acceptance scenarios:` line. If that line is absent, OR if running `grep -rl 'Given\|When\|Then' tests/acceptance/scenarios/*.md 2>/dev/null` returns empty, re-invoke test-creator with this explicit directive: "You exited without acceptance scenarios. Write Given/When/Then scenarios for this fix in `tests/acceptance/scenarios/<fix-slug>.md` per your Phase 4 section. This is BLOCKING." Do NOT proceed to implementation with only unit/integration tests. If the project has `.claude/no-acceptance`, skip this checkpoint.

### 3. Write fix code (only after tests are confirmed failing)

After test-creator confirms failing tests exist, implement the fix. Make the minimal change necessary — do not refactor, clean up, or improve surrounding code.

### 4. Capture known-failure rule (semi-auto)

After the fix is implemented and tests pass, propose a known-failure rule from the root cause. This step feeds the project's failure knowledge base so future features don't repeat the same mistake.

1. **Draft the rule** from the fix-advocate diagnosis (Step 1). Use this template:
   ```
   ### [domain-tag] [CATEGORY] Short description
   - **Trigger**: when is this rule relevant (what technology/pattern/API)
   - **Failure mode**: what breaks and how
   - **Prevention**: what to do instead
   - **Projects hit**: <this project>
   ```
   - **Domain tag**: the technology area (e.g., `ios-pwa`, `firebase-fcm`, `flask-routing`, `react-state`). Pick the most specific tag that applies.
   - **Category**: one of WIRING, LOGIC, STATE, CONFIG, UI, PLATFORM, TYPE.
   - All three fields (trigger, failure mode, prevention) are required. If you can't fill one, the rule isn't precise enough — rewrite.

2. **Check for cross-project matches.** Before writing, grep `~/.claude/known-failures.md` (global) and `~/projects/*/.claude/known-failures.md` (other projects) for rules with matching domain tags or similar failure descriptions.
   - If a matching rule already exists globally → skip writing (it's already covered).
   - If a matching rule exists in another project's sidecar but not globally → propose promotion to global: "This pattern also hit [other project] — promoting to `~/.claude/known-failures.md`."
   - If no match → write to `<project>/.claude/known-failures.md` (per-project).

3. **Present the rule to the user** for approval. Show the rule and where it will be written (per-project or global). Wait for explicit approval before writing.

4. **On approval**, append the rule to the target sidecar file. If the file doesn't exist, create it with the standard header from `~/.claude/known-failures.md`.

If the user says "skip" or the fix is trivial (typo, copy change), skip this step.

### 5. Hand off to /pipeline-tail

After the fix is written and the known-failure rule is captured (or skipped), invoke the **`/pipeline-tail`** skill with:
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
