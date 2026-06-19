# /patch — Quick Fix or Design Tweak with Gates

> **Pipeline announcements required.** This is a multi-step pipeline. Announce steps via `~/.claude/scripts/pipeline-step.sh` per the rule in `~/.claude/CLAUDE.md § "Pipeline step announcements"`. Use pipeline-id `patch`, display name `Patch`. Call `begin patch "Patch" --total <N>` at kickoff, `start`/`done`/`fail`/`skip` around each non-interactive step below. Skip interactive steps (user gates, clarification phases) — they self-announce. **`end` is delegated to `/pipeline-tail`** — do NOT call `end` yourself.

Lightweight flow for small fixes and design tweaks. Runs the right quality gates without the full feature pipeline.

## Usage

```
/patch <description of the fix or tweak>
```

A description is required. If none given, ask the user for one before proceeding.

## Steps

### 0. Auto-branch

Detect the current branch. If on the base branch (`main` or `master`):
1. Derive a slug from the patch description (e.g., `button-color-update` → `patch/button-color-update`).
2. Create the branch: `git checkout -b patch/<slug>`.
3. Log: "Created branch patch/<slug>."

If already on a non-base branch, stay on it and log: "Using existing branch <name>."

This must happen **before any implementation work** — all code changes must land on the patch branch, not on main.

### 0b. Test Baseline Snapshot

Capture the current test suite state BEFORE any implementation begins. This baseline lets test-runner classify failures later as PRE-EXISTING vs REGRESSION.

1. Read `.claude/test-commands.md` to get the test layer commands.
2. Run **ALL** test layers defined in `test-commands.md` (unit, integration, e2e, acceptance — every layer listed under `## Layers`). Do NOT skip any layer. Collect the names of any failing tests per layer.
3. Write the baseline to `.claude/state/test-baseline-<branch-name>.json`:
   ```json
   {
     "failing_by_layer": {
       "core unit": ["test.name.one"],
       "e2e": ["test.name.two"]
     },
     "layers_run": ["core unit", "web unit", "e2e"],
     "timestamp": "<ISO>",
     "branch": "<branch>"
   }
   ```
   - `failing_by_layer`: map of layer name → array of failing test names. Omit layers with zero failures.
   - `layers_run`: every layer that was executed (including those with zero failures). This is the completeness proof.
4. If all tests pass across all layers, write `{ "failing_by_layer": {}, "layers_run": ["...all layers..."], "timestamp": "...", "branch": "..." }`.
5. **Validation**: compare `layers_run` against the layers defined in `test-commands.md`. If any defined layer is missing from `layers_run`, the baseline is incomplete — re-run the missing layer(s) before proceeding.
6. If `.claude/test-commands.md` doesn't exist, skip this step (test-runner will classify all failures as UNCLASSIFIED).

This step is non-blocking — pre-existing failures are recorded, not fixed. They'll be excluded from the gate in pipeline-tail.

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

**Acceptance scenario checkpoint (BLOCKING):** Before proceeding, verify that test-creator produced acceptance scenarios by checking test-creator's output summary for the `Acceptance scenarios:` line. If that line is absent, OR if running `grep -rl 'Given\|When\|Then' tests/acceptance/scenarios/*.md 2>/dev/null` returns empty, re-invoke test-creator with this explicit directive: "You exited without acceptance scenarios. Write Given/When/Then scenarios for this fix in `tests/acceptance/scenarios/<fix-slug>.md` per your Phase 4 section. This is BLOCKING." Do NOT proceed to implementation with only unit/integration tests. If the project has `.claude/no-acceptance`, skip this checkpoint.

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

### 5. Capture known-failure rule (semi-auto, bug fixes only)

**Skip this step for design tweaks.**

For bug fixes, after the fix is implemented and tests pass, propose a known-failure rule from the root cause. This step feeds the project's failure knowledge base so future features don't repeat the same mistake.

1. **Draft the rule** from the fix-advocate diagnosis (Step 2). Use this template:
   ```
   ### [domain-tag] [CATEGORY] Short description
   - **Trigger**: when is this rule relevant (what technology/pattern/API)
   - **Failure mode**: what breaks and how
   - **Prevention**: what to do instead
   - **Projects hit**: <this project>
   ```
   - **Domain tag**: the technology area (e.g., `ios-pwa`, `firebase-fcm`, `flask-routing`, `react-state`).
   - **Category**: one of WIRING, LOGIC, STATE, CONFIG, UI, PLATFORM, TYPE.
   - All three fields (trigger, failure mode, prevention) are required.

2. **Check for cross-project matches.** Grep `~/.claude/known-failures.md` (global) and `~/projects/*/.claude/known-failures.md` (other projects) for matching rules.
   - Match exists globally → skip (already covered).
   - Match exists in another project → propose promotion to global.
   - No match → write to `<project>/.claude/known-failures.md`.

3. **Present the rule to the user** for approval. Wait for explicit approval before writing.

4. **On approval**, append the rule to the target sidecar file.

If the user says "skip" or the fix is trivial, skip this step.

### 6. Hand off to /pipeline-tail

After the implementation and known-failure rule capture are complete, invoke the **`/pipeline-tail`** skill with:
- **pipeline-id:** `patch`
- **display-name:** `Patch`
- **skill-type:** `patch`

The tail skill handles: quality gates (with auto-fix retry, 3 per gate), doc-updater, memory-review, commit, push, PR creation, and final GATES summary + PR link output.

**Do NOT** call `pipeline-step.sh end`, emit a GATES log, commit, push, or create a PR yourself — the tail skill owns all of that.

## Notes
- For bug fixes: do NOT write code before fix-advocate diagnosis + user approval.
- For bug fixes: do NOT write code before test-creator confirms failing tests exist — hard sequencing gate.
- For design tweaks: do NOT implement before test-creator confirms acceptance tests exist and are failing.
- If the user explicitly says "skip gates" or "no gates", respect that and only implement.
