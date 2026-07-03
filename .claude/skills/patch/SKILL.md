# /patch — Quick Fix or Design Tweak with Gates

> **Pipeline announcements required.** This is a multi-step pipeline. Announce steps via `~/.claude/scripts/pipeline-step.sh` per the rule in `~/.claude/CLAUDE.md § "Pipeline step announcements"`. Use pipeline-id `patch`, display name `Patch`. Call `begin patch "Patch" --total <N>` at kickoff, `start`/`done`/`fail`/`skip` around each non-interactive step below. Skip interactive steps (user gates, clarification phases) — they self-announce. **`end` is delegated to `/pipeline-tail`** — do NOT call `end` yourself.

> **Pacing:** multi-part deliverables follow `~/.claude/references/one-beat-per-turn.md`.

<!-- LEAN_OUTPUT_SUMMARY_START -->
## Lean output rules (canonical summary — auto-synced from `~/.claude/references/lean-output.md`)

- **Compact one-liner format by default.** Each item is one line:
  `name — 1-sentence summary (constraints in parens)`. Drill-down only
  on explicit user request ("expand", "full details", "show me X").
- **Padding-killers.** Never restate prior answers. Never preamble the
  next item ("Now I'll cover…", "Moving on to…"). A turn ending in two
  question marks is a bug — pick the load-bearing question, let the
  answer tee up the next turn.
- **Load-bearing first.** For lists of 3+ items, deliver the most
  load-bearing one first — the option you'd recommend, the worst
  finding, the user-facing change. Don't bury the lede.
- **Coverage tally for long lists.** Open with `N items: X top, Y
  secondary, Z edge` so the user can scan distribution before reading.
- **Side-channel instrumentation.** Log rule applications to
  `~/.claude/state/rule-hits.jsonl` via
  `~/.claude/scripts/log-rule-hit.sh lean-output <rule>` — don't cite
  rules inline in user-facing replies.
<!-- LEAN_OUTPUT_SUMMARY_END -->

> **Rule consultation.** Before any user-facing deliverable (classification in Step 1, diagnosis in Step 3, test gap in Step 3b, known-failure in Step 6), read `~/.claude/references/lean-output.md` and `~/.claude/calibration.md`. Apply matching entries (where **Wrong pitch** matches your planned output shape) by formatting per the **Right approach**. Don't cite rules inline. Call `~/.claude/scripts/log-rule-hit.sh <family> <entry-slug> patch` for each rule applied, BEFORE the final assistant turn. **Compact-format for this skill:** diagnosis steps as `Step: 1-line finding (file:line if anchored)`; tweak options as `Option X — 1-sentence visual/behavioral change (effort in parens)`; lead with the user-visible target state.

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

**BLOCKING — main-must-be-green rule.** If any layer in `failing_by_layer` is non-empty, STOP the pipeline immediately. Report failing tests grouped by layer and refuse to proceed. The baseline is captured on a freshly-cut branch off main, so failing tests here mean main itself is red — starting new work on a red base hides regressions inside the "PRE-EXISTING permit" that pipeline-tail's Auto-Fix Constraints grant ([pipeline-tail.md § Auto-Fix Constraints](/home/kwaku/.claude/skills/pipeline-tail/SKILL.md#L71)). Fix main first (revert the offending commit, or fix forward on a dedicated repair branch), then re-run `/patch`.

Exception: if `.claude/test-commands.md` is missing (Step 6 above), the baseline step was skipped and this block does not apply — new/bootstrapping projects still proceed normally.

### 1. Classify the change

Determine whether this is a **bug fix** or a **design tweak**:
- **Bug fix** — something is broken, producing wrong behavior, or failing.
- **Design tweak** — UI adjustment, style change, small UX improvement, copy change, layout fix, minor refactor.

State your classification and proceed.

### 2. Expected behavior (BLOCKING)

**Bug fix path:** Before any code reading or diagnosis, understand what the user expects:

1. **What did you expect to happen?** — Ask the user to describe the correct behavior they expected.
2. **How would you ideally want this to work?** — Ask how the feature should behave if working correctly.

If the user's description reveals this isn't a bug but a missing feature or design gap, flag it explicitly: "This sounds like a feature request rather than a bug fix — consider running `/feature` instead." Wait for the user to confirm direction before proceeding.

**Design tweak path:** Understand the visual/behavioral target:

1. **What should this look like?** — Ask the user to describe the intended visual or behavioral result.
2. **Mockup?** — If the tweak is non-trivial (layout change, new component state, multi-element adjustment), offer to run `/mockup` to generate a visual target before implementation. If trivial (copy change, single color swap, spacing adjustment), skip.

**STOP here. Wait for the user's answers (and mockup approval if applicable) before proceeding.**

### 3. Diagnosis gate (bug fixes only)

**Skip this step entirely for design tweaks.**

For bug fixes, invoke the **fix-advocate** agent and complete all 7 diagnosis steps:

1. **Reproduce** — Confirm the bug is reproducible.
2. **Locate** — Find the file(s) and line(s) where the bug originates.
3. **Root cause** — Explain what is actually happening and why, anchored against the user's expected behavior from Step 2.
4. **Impact** — Describe what is affected (data, UX, security, performance).
5. **Sibling sweep & robustness check** — Search for similar patterns across the codebase:
   - **Syntactic**: grep the current project for the same code pattern that caused the bug.
   - **Semantic**: grep for the same category of mistake (e.g., if root cause is a missing null check, search for other unchecked nulls in the same flow).
   - **Cross-project**: grep `~/projects/*` for the same pattern. Flag matches with risk notes — don't fix them. Note if any other project solved the same problem in a better way.
   - **Robustness**: regardless of sibling count, evaluate whether the proposed fix covers all paths that could expose the same class of failure through different routes.
   - If 5+ siblings exist in the current project, list the count with per-sibling risk assessment ("low: dead code path" vs "high: user-facing, same trigger as reported bug") and let the user decide whether to fix all now or defer some.
   - Current-project siblings: the proposed fix must cover all of them (unless the user explicitly defers at the 5+ threshold).
   - Cross-project matches: flagged with risk notes in the diagnosis output, not fixed.
6. **Propose fix** — Write a specific fix with rationale that covers the reported bug AND all current-project siblings identified in step 5. Describe the change without implementing it yet.
7. **Defend** — Explain why this fix is correct and won't cause regressions.

**STOP. Present the diagnosis to the user — including sibling findings, cross-project flags, and robustness assessment — and wait for explicit approval before proceeding.**

### 3b. Test Gap Analysis (BLOCKING, bug fixes only)

**Skip this step for design tweaks.**

After the user approves the fix-advocate diagnosis, invoke the **test-gap-auditor** agent in **Mode A (Diagnosis)**:

**Input to the agent:**
- The patch description from the user
- The fix-advocate diagnosis (root cause, affected paths, sibling sweep results)
- The existing test suite

The agent produces a mandatory three-section checklist answering "why didn't existing tests catch this bug?":

1. **Scenario Coverage** — for each code path involved, was there a happy/unhappy/edge test? Each "covered" cites `file:testName`. Each "gap" includes a Root Cause of Gap.
2. **Layer Coverage** — for each scenario, was it reachable at unit/integration/e2e? Same evidence format.
3. **Wiring Coverage** — are all entry points (routes, triggers, flags) exercised by a test? Same evidence format.

After the checklist, the agent assesses whether any gap root causes represent a **recurring pattern**. If so, it proposes a known-failure rule for user approval (same format as Step 6's known-failure capture).

**STOP. Present the test gap analysis to the user and wait for explicit confirmation before proceeding.** Do not proceed to test writing until the user confirms.

### 4. Write failing tests (BLOCKING — before any implementation)

**Bug fix path:** Construct a `fix-spec` block from the fix-advocate diagnosis and invoke **test-creator** in Mode B:

```
fix-spec:
  root-cause: <from fix-advocate step 3>
  affected-paths: <from fix-advocate step 2 — files and functions, plus siblings from step 5>
  proposed-change: <from fix-advocate step 6>
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
  proposed-change: <description of the intended visual/behavioral target state, informed by user's description from Step 2 and mockup if generated>
  change-type: design-tweak
```

**STOP. Do not implement until test-creator confirms acceptance test files exist and are failing** (they describe the intended target state, which doesn't exist yet).

~100% acceptance-layer coverage required — no unit or integration tests:
- **Happy** — intended visual/behavioral change is present and correct.
- **Unhappy** — old broken/incorrect state no longer exists.
- **Edge** — boundary states (empty content, long text, mobile viewport, reduced motion).

Never leave any category empty.

### 4b. Wiring Gate

Run `~/.claude/scripts/check-wiring.sh --json PROJECT_ROOT` to capture the pre-implementation wiring baseline. Note any pre-existing findings (don't block on them). After writing the implementation in Step 5, re-run the script and verify no NEW wiring findings were introduced. If new findings appear, fix them before proceeding to Step 6.

### 5. Implement

Make the change. Keep it minimal — do not refactor, clean up, or improve surrounding code beyond what the fix/tweak requires. For bug fixes, the implementation must cover all current-project siblings approved in Step 3.

### 6. Capture known-failure rule (semi-auto, bug fixes only)

**Skip this step for design tweaks.**

For bug fixes, after the fix is implemented and tests pass, propose a known-failure rule from the root cause. This step feeds the project's failure knowledge base so future features don't repeat the same mistake.

1. **Draft the rule** from the fix-advocate diagnosis (Step 3). Use this template:
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

### 7. Hand off to /pipeline-tail

After the implementation and known-failure rule capture are complete, invoke the **`/pipeline-tail`** skill with:
- **pipeline-id:** `patch`
- **display-name:** `Patch`
- **skill-type:** `patch`

The tail skill handles: quality gates (with auto-fix retry, 3 per gate), doc-updater, memory-review, commit, push, PR creation, and final GATES summary + PR link output.

**Do NOT** call `pipeline-step.sh end`, emit a GATES log, commit, push, or create a PR yourself — the tail skill owns all of that.

## Notes
- For bug fixes: do NOT write code before Expected behavior gate (Step 2) + fix-advocate diagnosis (Step 3) + user approval.
- For bug fixes: do NOT write code before test-creator confirms failing tests exist — hard sequencing gate.
- For design tweaks: do NOT implement before Expected behavior gate (Step 2) confirms visual target + test-creator confirms acceptance tests exist.
- If the user explicitly says "skip gates" or "no gates", respect that and only implement.
- The fix must cover all current-project siblings identified in the sibling sweep, unless the user explicitly deferred some at the 5+ threshold.
