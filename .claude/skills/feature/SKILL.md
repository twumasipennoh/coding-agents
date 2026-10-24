# Feature Implementation Skill

> **Pipeline announcements required.** This is a multi-step pipeline. Announce steps via `~/.claude/scripts/pipeline-step.sh` per the rule in `~/.claude/CLAUDE.md § "Pipeline step announcements"`. Use pipeline-id `feature-sprint`, display name `Feature Sprint`. Call `begin feature-sprint "Feature Sprint" --total <N>` at kickoff, `start`/`done`/`fail`/`skip` around each non-interactive step below. Skip interactive steps (user gates, clarification phases) — they self-announce. **`end` is delegated to `/pipeline-tail`** — do NOT call `end` yourself. **Final output ordering (critical):** any trailing tool calls (`pipeline-step.sh done`, `log-rule-hit.sh`, TodoWrite cleanup) must come **before** your final user-facing text — the commit summary / PR link must be the last turn with **no tool calls after it**, or the openclaw gateway drops it (see `~/.claude/CLAUDE.md § "Final output ordering"`).

> **Pacing:** multi-part deliverables follow `~/.claude/references/one-beat-per-turn.md`.

This skill implements Pattern A (Feature Sprint) from `.claude/orchestration/ORCHESTRATION.md`.

**Do NOT skip any step.**

When implementing a feature, follow the revised pipeline defined in CLAUDE.md.

## Pipeline

### Step 0 — Checkpoint resume/init (F1, checkpoint-enrolled)

This skill is **checkpoint-enrolled** (see `docs/DECISIONS.md` F1). Run this before Step 0a.

1. Derive the task slug from the feature name / branch (e.g. `add-user-notifications`).
2. **Resume check:** `~/.claude/scripts/checkpoint.sh status <slug>`.
   - `none` or `complete` → fresh run; go to init.
   - `incomplete` → this is a **resume**: read the checkpoint (`checkpoint.sh path <slug>`), then reconcile against reality — `git log` / `git status` / `git diff` plus a test run — to see what actually landed vs what the file claims. **Trust git over the file.** Continue from the first unfinished `## Remaining` item; do NOT redo `## Done` items already reflected in git.
3. **Init (fresh run only):** `checkpoint.sh init <slug> --goal "<one-line goal>"`.

Keep the checkpoint current **eagerly** (as things happen, not at milestone-end):
- Each decision: `checkpoint.sh note <slug> "decision: <what> — why: <why>"`.
- On finishing a worklist item: `checkpoint.sh note <slug> "done: <item>"` then `checkpoint.sh progress <slug>` (bumps the counter the resume trigger reads to tell "progressing" from "stuck").
- Keep `## Remaining` accurate so a fresh-context resume knows what's left.

On terminal success (Step 5, after pipeline-tail confirms green): `checkpoint.sh complete <slug>` — the done-signal; the resume trigger then archives it and stops relaunching. If a run dies mid-way and auto-resume is armed (`PIPELINE_AUTORESUME=1` / arm-flag), `pipeline-resume-trigger.sh` relaunches a fresh turn that re-enters this Step 0.

### Step 0a — Verify
Check codebase state - does backend exist? What's actually implemented? Do not assume docs are accurate — check the code.

### Step 0b — Clarify
Run requirements clarification phases with user. If user references task numbers that don't exist, clarify before proceeding.

### Step 0c — Auto-branch

Detect the current branch. If on the base branch (`main` or `master`):
1. Derive a slug from the feature name or task description (e.g., `add-user-notifications` → `feature/add-user-notifications`).
2. Create the branch: `git checkout -b feature/<slug>` (or from `origin/<parent head>` when stacking, below).
3. Log: "Created branch feature/<slug>." (plus "stacking on #N" when it does).

**Stacked branches (`~/.claude/references/stacked-branch.md`):** before step 2, run that file's "Auto-branch" section. With one chain of open PRs of yours it says "stacking on #N (<title>), say 'standalone' to branch from main" and cuts from `origin/<parent head>` instead of the base branch, without waiting; it only stops to ask when two open chains exist. "standalone" → the base branch, as below.

If already on a non-base branch, stay on it and log: "Using existing branch <name>."

This must happen **before any implementation work** — all code changes must land on the feature branch, not on main.

Once the branch is settled, stamp it onto the checkpoint: `checkpoint.sh set <slug> branch "$(git branch --show-current)"` — the task slug is often not the literal branch name (e.g. task `f84` shipped on branch `next-segment-countdown-indicator`), so `/pr` and `/merged` need this explicit field to find the right checkpoint by branch rather than guessing from the filename.

### Step 0d — Test Baseline Snapshot

Capture the test suite state BEFORE any implementation begins, from saved receipts where they exist. The baseline lets test-runner classify failures later as KNOWN vs REGRESSION. New failures are reported per test-runner's "New failures need a lead" rule, never judged here; a layer with a wrapper script (e.g. KaeMe's `verify-real-claude.sh`) runs through it with `--foreground --quiet` when unattended, never the raw command.

1. If `.claude/test-commands.md` doesn't exist, skip this step (test-runner will classify all failures as UNCLASSIFIED); the main-must-be-green block below then does not apply.
2. `KEY=$(~/.claude/scripts/test-result-cache.sh key)` — the fingerprint of the tracked code, `test-commands.md`, the lockfiles and tool versions. Receipts live in one drawer per repo (`<main checkout>/.claude/state/test-results/`, shared by every worktree, never committed).
3. `~/.claude/scripts/test-result-cache.sh plan "$KEY"` prints one `layer<TAB>command[<TAB>never-reusable]` line per layer with no receipt under this key. On a branch just cut from a green tip it prints nothing, or only never-reusable layers (real-API / real-claude / `## No Reuse`): every other layer is reused and no test runs. Any other line means the fingerprint changed since the last saved run (code, lockfile or tool version) — run only those layers.
4. For each printed line, run the command verbatim (it already carries its tmp/slot wrappers) as a **blocking Bash call in the same turn**, wrapped in `~/.claude/scripts/longrun-tick.sh -i 60 --no-ping -l /tmp/test-baseline-<layer>.log -- <command>`. After a completed run, `~/.claude/scripts/test-result-cache.sh record "$KEY" "<layer>" --failing-json '<failing test names as a JSON array>'`, each name as `<file path from the repo root> > <full test title, describe blocks included>` (e.g. `tests/auth.test.ts > sign-in > rejects a bad token`) so names from a saved run match names from a fresh one. Don't record a layer that crashed or failed on setup (port in use, emulator down): only a completed run is a result. `record` exits 4 while tracked files are modified — commit or stash first. **Do NOT stream a layer via the `Monitor` tool to "wait" for it** — `Monitor` returns immediately, so to wait on it you'd end the turn, which is exactly the detach that stalls under a print-mode CLI. NEVER launch the baseline as a detached background job and end the turn with a "waiting for results" message. See `~/.claude/CLAUDE.md` § "Long-running commands".
5. `~/.claude/scripts/test-result-cache.sh baseline "$KEY" "$(git branch --show-current)" --ran "<comma-separated layers you ran in step 4>"` writes `.claude/state/test-baseline-<branch>.json` (`failing_by_layer`, `layers_run`, `reused_layers`, `key`, `branch`, `timestamp`). Exit 5 names a layer with no receipt — run and record it, then retry. That exit is the completeness proof: every layer under `## Layers` ends up in `layers_run`.

**BLOCKING — main-must-be-green rule.** If any layer in `failing_by_layer` is non-empty, STOP the pipeline immediately. Report failing tests grouped by layer and refuse to proceed. The baseline is captured on a freshly-cut branch, so failing tests here mean the base itself is red — starting new work on a red base hides regressions inside the "PRE-EXISTING permit" that pipeline-tail's Auto-Fix Constraints grant ([pipeline-tail.md § Auto-Fix Constraints](/home/kwaku/.claude/skills/pipeline-tail/SKILL.md#L71)). Fix the base first (revert the offending commit, or fix forward on a dedicated repair branch), then re-run `/feature`.

Exception: if `.claude/test-commands.md` is missing (step 1 above), the baseline step was skipped and this block does not apply — new/bootstrapping projects still proceed normally.

### Step 1 — Pre-Flight Validation
Run the **pre-flight** agent to verify the project is in a clean state:
- Test suite health (BLOCKING if tests fail)
- Doc freshness
- Agent config consistency
- Next feature readiness and dependency check

If pre-flight reports **BLOCKING** issues, fix them before proceeding. If **WARNING** issues, inform the user and let them decide.

### Step 2 — Write Failing Tests
Run the **test-creator** agent -> reads the task spec from `FEATURE_PROMPTS.md`, writes failing tests based on "Tests to Write First."

**Acceptance scenario checkpoint (BLOCKING):** Before proceeding to Step 3, verify that test-creator produced acceptance scenarios by checking test-creator's output summary for the `Acceptance scenarios:` line. If that line is absent, OR if running `grep -rl 'Given\|When\|Then' tests/acceptance/scenarios/*.md 2>/dev/null` returns empty, re-invoke test-creator with this explicit directive: "You exited without acceptance scenarios. Write Given/When/Then scenarios for this feature in `tests/acceptance/scenarios/<feature-slug>.md` per your Phase 4 section. This is BLOCKING." Do NOT proceed to implementation with only unit/integration tests. If the project has `.claude/no-acceptance`, skip this checkpoint.

### Step 2b — Wiring Gate (BLOCKING)

Run `~/.claude/scripts/check-wiring.sh --json PROJECT_ROOT` against the current codebase. This captures the pre-implementation wiring baseline. If the project has no `.claude/wiring-config.md`, the script auto-scaffolds one.

- If findings exist: note them as **pre-existing wiring gaps** (don't block — they predate this feature). Log the count.
- Pass the seam list from requirements-clarifier Phase 3 (if available) to Step 3 as implementation context.

### Step 3 — Implement Feature

**Pre-write call-chain trace (MANDATORY before writing any code):**
1. Read the task's "Implementation Steps" from `FEATURE_PROMPTS.md`.
2. For each step, trace the call chain from entry point to persistence. List every file you will touch and every integration point (where one module calls another, where a new parameter is passed, where a service is injected, where a route is registered).
3. Output the trace as a checklist:
   ```
   [ ] file.py:create_app — inject new_service (wiring: constructor param)
   [ ] routes.py:new_endpoint — register in blueprint (wiring: route registration)
   [ ] .env.example — add NEW_VAR (wiring: env var)
   ```
4. After writing all implementation code, verify against this checklist. Every item must be checked off. If any item was missed, fix it before proceeding. If you touched a file not in the trace, add it retroactively and verify its wiring.

**Post-write wiring re-check:** Run `~/.claude/scripts/check-wiring.sh --json PROJECT_ROOT` again. Compare findings to the pre-implementation baseline from Step 2b. Any NEW findings (not in baseline) are regressions introduced by this implementation — fix them before proceeding to Step 4.

**Proactive rule generation:** If during the trace you identify a seam type not covered by existing known-failures or script rules, emit a candidate to `~/.claude/state/wiring-rules/review-queue.jsonl`.

**Tracer slice (BLOCKING when the entry has a non-`none` `Tracer Path:`):** before any real logic, connect the whole path first.
1. Implement every seam on the `Tracer Path:` in call order with stub bodies (fixed return values, no real logic) — but real registration, injection, routing, and imports.
2. Run the tracer test alone, using the command from test-creator's `Tracer test:` line. It must pass. If it fails, the path isn't connected — fix the wiring, not the test. Do not start step 3 until it passes; report the actual command and output.
3. Only then fill in each layer behind the stubs (feature-creator below, or the Slice Gate loop). Re-run the tracer test after each layer; it must stay green. A red tracer after a layer means that layer broke a connection — fix before continuing.
If the entry has no `Tracer Path:` block (older entries) or says `none`, skip this silently.

**Slice Gate check:** if this task's `FEATURE_PROMPTS.md` entry has `Slice Mode: enabled`, run the implementation as the per-slice hard-gate loop defined in `~/.claude/references/slice-gate.md` — implement and verify one tagged slice at a time, pausing at each `[GATE]` for explicit user confirmation before continuing, as silent sub-steps inside this step (no extra `pipeline-step.sh` calls per slice). Otherwise, proceed normally.

Run the **feature-creator** agent -> implements code to make the failing tests pass, follows "Implementation Steps." (Under Slice Gate, feature-creator is invoked once per slice instead of once for the whole task.)

### Step 4 — Monitoring (feature-only)

Run the **monitoring-implementer** agent. Produces/updates monitoring infrastructure from `monitoring_spec.md`. If no spec exists yet, reports DEFERRED and continues.

### Step 5 — Hand off to /pipeline-tail

After implementation and monitoring are complete, invoke the **`/pipeline-tail`** skill with:
- **pipeline-id:** `feature-sprint`
- **display-name:** `Feature Sprint`
- **skill-type:** `feature`

The tail skill handles: quality gates (with auto-fix retry, 3 per gate), doc-updater, memory-review, commit, push, PR creation, and final GATES summary + PR link output.

**Do NOT** call `pipeline-step.sh end`, emit a GATES log, commit, push, or create a PR yourself — the tail skill owns all of that.

## Completion Criteria

Do not mark a task complete until:
- [ ] Pre-flight passed (no blockers)
- [ ] All tests green (full suite)
- [ ] E2E coverage gate passed (test-runner confirmed E2E tests ran OR justified skip)
- [ ] Acceptance test passed (every Phase 4 scenario reached its `Then` clause, OR DEFERRED with missing-sidecar notice, OR SKIPPED via `.claude/no-acceptance`)
- [ ] Pattern review clean
- [ ] Security review clean
- [ ] TESTING_<FEATURE_NAME>.md exists
- [ ] FEATURE_PROMPTS.md updated with completion notes and `✅ COMPLETE` on heading (if all tasks done)
- [ ] DECISIONS.md updated (if applicable)
- [ ] Agent memory updated
- [ ] PRD updated to reflect implementation
- [ ] README updated (if new routes/endpoints/features)
- [ ] PR created with GATES log + PR link
