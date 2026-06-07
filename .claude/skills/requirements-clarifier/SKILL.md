# /requirements-clarifier - Engineering Method Q&A

> **Final output ordering (critical):** every phase ends with a GATE — a user-facing message (findings, brainstormed approaches, evaluation, test scenarios, or the plan). That GATE message is the deliverable of the phase. Do all tool calls for the phase *before* emitting it: read `clarifier-context.md`, run cross-project `Grep`, run `WebSearch`, invoke `/mockup`, etc., FIRST — then the final assistant message contains the phase findings + the GATE prompt, with **no tool calls after it**. `--output-format json` returns only the final turn's text, so any phase findings emitted before a subsequent tool call are silently dropped. Phase 1b is the highest-risk phase here (cross-project Grep + WebSearch) — collect all results, then emit the surfaced-options block + build/buy/hybrid prompt as a single closing turn.

Run the **requirements-clarifier** agent before any feature or bug fix. Walks through 5 main engineering method phases with the user, plus optional sub-phases for prior-art survey (1b) and UI mockups (2b).

## Per-project context

Before each phase, read `<project_root>/.claude/clarifier-context.md` if it exists. This sidecar lists the project's stack (backend/frontend frameworks, test frameworks, design system) and any clarifier-specific guidance. Weave its notes into your phase prompts where relevant — e.g., "consider testability across the project's pytest + Vitest + Playwright stack" or "evaluate impact on the Tailwind v4 design tokens." If the file is missing, proceed with universal phrasing — no error, no block.

## Conversational pacing — ONE QUESTION PER TURN

Each phase below lists multiple sub-sections of questions. Do NOT ask all of them in a single message — that produces a wall of text that's hard to read on small screens (telegram) and slow to answer. Pacing rule:

1. Within each phase, identify the single most load-bearing question — the one whose answer most constrains the rest.
2. Ask that one question. **Just the question — no context preamble, no "now I'll ask about <next topic>", no preview of what's coming.** The user already knows they're in a Q&A.
3. Wait for the user's answer.
4. Use the answer to pick the next question — some may now be irrelevant, others clearer.
5. Continue until you have enough substance to emit the phase's GATE message.
6. The GATE message is the only "deliverable" turn for the phase. It carries the findings + the gate prompt, per the ordering rule above.

**Between questions — kill the padding.**

- **Never restate prior answers.** No "So far you've said X about Y and Z about W..." — the user just gave the answer; they have the context.
- **Never preamble the next question** with "Now I'll ask about <topic>" or "Moving on to <area>". Just ask the next question.
- **One question per turn — no multi-question dumps.** A turn that ends with two question marks is a bug. If two things are genuinely entangled, pick the load-bearing one and let the answer tee up the next turn.
- **Acknowledgments stay tight.** A one-line ack is fine if the answer surprises or pivots ("ok, so offline-first changes the surface — "), but the next turn's body is the next question, not a paragraph weighing the implication.

This overrides any later instruction in this file that lists multiple questions to ask "in" a phase — those lists are the menu, not the script. You're picking from the menu one item at a time, not reading the menu aloud.

**Escape hatch:** if the user says "batch them," "give me all the questions," "ask them all at once," or "I'll answer them in one go," dump the full phase's questions in a single message for that phase. Default is one-at-a-time.

## Output pacing — MULTI-PART DELIVERABLES (Phases 1b, 2, 3, 4, 5)

The pacing rule above keeps Phase 1 (Q&A-shaped) from becoming a wall of questions. The output-shaped phases — 1b prior-art options, Phase 2 brainstormed approaches, Phase 3 evaluation findings, Phase 4 test scenarios, Phase 5 plan — have the opposite failure mode: a wall of findings/options/scenarios dumped in one turn. Apply the "Multi-part answers — one beat per turn" rule from `~/.claude/CLAUDE.md`:

1. When the phase's deliverable has 3+ distinct parts (3+ surveyed options, 3 approaches, 4+ evaluation findings, 5+ test scenarios, plan with 3+ phases), open with the count + bypass: "3 approaches, going one at a time — say 'all at once' to skip."
2. Deliver the most load-bearing part first — the one that most constrains the user's next decision. For 1b: the option you'd recommend. For Phase 2: the approach you'd lean toward. For Phase 3: the worst finding (the one that might force a Phase 2 bounce-back). For Phase 4: the riskiest scenario. For Phase 5: the user-facing change.
3. Flow into the next part as the conversation continues — don't ask "want the next one?" after each. Trust the user to interrupt, drill into a specific part, or jump to the gate.
4. The phase's GATE prompt lands at the end of the LAST part, not bundled with part 1. The chunked parts collectively are the deliverable; the GATE is the closing turn.

**Skip the chunking** for 1-2 part deliverables: a Phase 2 with only one viable approach, a Phase 5 plan that's two paragraphs, a Phase 3 with one finding. The chunking is friction; only apply it when the deliverable is genuinely long.

**Escape hatch:** same as ONE QUESTION PER TURN — "all at once," "batch them," "just dump it," "show me everything" → emit the full deliverable in a single closing turn (findings + GATE prompt together, original format).

**Don't double-pace.** Phase 1 already paces *questions*; don't also chunk Phase 1's GATE message — that's a single summary turn by design.

## Usage

```
/requirements-clarifier [phase <N> | all]
```

- `/requirements-clarifier` — run all phases sequentially
- `/requirements-clarifier all` — same as above
- `/requirements-clarifier phase 1` through `phase 5` — run a single main phase
- `/requirements-clarifier phase 1b` — run the prior-art survey sub-phase standalone
- `/requirements-clarifier phase 2b` — run the UI mockup sub-phase standalone

## Phases

### Phase 1 — Explore
Walk through four sub-sections in order. Each is a discussion, not a checklist — adapt depth to the size of the idea.

**Scope & Scenarios.** Restate the problem in your own words. Ask clarifying questions about scope. Walk through 2-3 concrete user scenarios. Identify edge cases and corner cases the user may not have considered.

**Constraints.** Surface and confirm the constraints that bound the idea: must-work-offline, performance ceilings, platform requirements, regulatory/privacy boundaries, deadlines, team capacity, integration limits, anything else that fences the solution space. Constraints are not the same as requirements — they're what *can't* change, not what we're trying to build. If the user hasn't named any, prompt for the obvious ones given the project context.

**UX & onboarding.** For every scenario, also ask:
- What does a first-time user see when they encounter this feature? Is there an empty state, a first-run experience, or a prompt that guides them?
- Does this need onboarding — a tooltip, a walkthrough, inline hints — or is it self-explanatory from context?
- Within this feature's surface area, could parts of it bundle into existing UI/flows the user already knows, instead of introducing new surfaces? (Cross-project / external prior art is covered in Phase 1b — keep this scoped to bundling *within* the feature.)
- What is the minimum the user needs to learn to use this? Can we reduce it?

**Complexity check (active, two-way).** Form an opinion: is this idea over-complicated for the value it delivers? Look for too many moving parts, surface area larger than necessary, scope that's drifted beyond the core need, or coupling that will produce bugs. If you think it's over-complicated, say so explicitly and propose specific simplifications — e.g., "cut X, defer Y to a follow-up, fold Z into existing surface area." The user accepts, pushes back ("Z genuinely needs to be in scope because…"), or counter-proposes. Iterate until you both agree on a version that has few moving parts, is appropriate for the idea, and is as easy to understand as possible. If the idea is already right-sized, say so plainly in one sentence and move on — don't manufacture friction.

**GATE: Pause after this phase and wait for user input before proceeding to Phase 1b.** Phase 1b's prior-art survey runs against the *agreed-on* (possibly simplified) version of the idea, not the original.

### Phase 1b — Prior Art Survey
Surface what already exists, both inside the user's other projects and in the wider package/app ecosystem, so the user can make an informed build/buy/hybrid decision before any approach is brainstormed in Phase 2.

**Trivial-skip exit.** If the change is genuinely trivial (a one-line tweak, a copy-only edit, a clearly scoped bug fix with no architectural choice), say so at the start of this phase and ask the user to confirm skipping. If confirmed, short-circuit straight to Phase 2 with no build/buy framing.

**Step 1 — Cross-project grep.** Eagerly search across the user's other projects under `~/projects/*` for similar implementations. Match the convention used by `/pr` and `/merged`: iterate directories under `~/projects/` that contain a `.git`, and run `Grep` for the keywords and symbols that define the feature (component names, function names, domain terms, file-name patterns). For each hit, note the project, file path, and a one-line summary of what's there. Don't grep the current project for this — Phase 1's UX sub-section already covers within-feature bundling.

**Step 2 — Web search & package survey.** Run `WebSearch` for relevant npm/pip/cargo packages, libraries, apps, or real-world implementations in the problem space. For each candidate worth raising, capture: name, what it does, rough size / dep count, license, maintenance status (recent commits, last release, open issues at a glance), and obvious fit/misfit against the constraints from Phase 1. If WebSearch is unavailable (offline, hook denied), report that and continue with cross-project grep findings only — don't fail the phase.

**Step 3 — Surface options + their constraints.** Present what you found as a flat list — no ranking yet. For each option, state what adopting it would constrain (e.g., "Fuse.js — adds ~10KB, MIT, last release 4 months ago, requires you to flatten the data shape it indexes") so the tradeoff is visible. If nothing relevant turned up, say so plainly: "no prior art across `~/projects/*`, no obvious package — build path is the realistic default."

**Step 4 — Build/buy/hybrid decision.** Ask the user to choose: build, buy (adopt one of the surfaced options), or hybrid (use a surfaced option for part of the scope and build the rest). Capture which surfaced options the buy/hybrid path would use. This decision is what Phase 2 brainstorms against.

**Known limitation:** as `~/projects/*` grows past ~30 projects, the cross-project grep gets slow. If that becomes a problem, add a project allowlist or last-modified filter — out of scope for this skill version.

**GATE: Pause after this phase and wait for the user to lock in the build/buy/hybrid decision before proceeding to Phase 2.**

### Phase 2 — Brainstorm
Use the build/buy/hybrid decision locked in at Phase 1b. The 2-3 approaches you brainstorm should be approaches *within* that path, not across it:
- If **build** → approaches are different ways to build the feature (today's behavior).
- If **buy** → approaches are different ways to integrate/wrap the chosen package or app (where it lives in the codebase, config strategy, how it's mocked in tests, what adapter layer if any).
- If **hybrid** → approaches are different ways to combine the bought piece with the built piece (which seams go where, how state flows between them).

Present 2-3 approaches with pros and cons for each. Consider: complexity, maintainability, backwards compatibility, testability, performance. Do not commit to an approach yet.

**Per-approach testability blurb:** For each approach, include a 1-2 sentence note in its pros/cons covering how the feature could be verified end-to-end under that strategy — what's automatable, what's likely manual, and any obvious testability tradeoff vs. the other approaches. Surface testability now so it factors into the comparison, not after the choice is locked.

**GATE: Pause after this phase and wait for the user to choose or redirect before proceeding.**

### Phase 2b — UI Mockup (UI features only)
After the user chooses an approach in Phase 2, ask whether this feature needs a UI mockup. If yes, run the `/mockup` skill to generate design mockups informed by the chosen approach and the scope from Phase 1.

**Skip this phase** if the feature is purely backend, API-only, infrastructure, or has no visual component. Ask the user if unsure.

Steps:
1. Based on Phase 1 findings and the chosen Phase 2 approach, identify which screens or components need mockups
2. Run `/mockup <feature-name>` for each screen that needs a visual design
3. The mockup skill will auto-commit, create a PR, and present the link
4. The user reviews the mockups via the PR and approves or requests changes
5. Iterate on the mockups if the user requests changes

The approved mockups become the visual spec for Phases 3-5. Phase 3 should evaluate the approach against the approved design. Phase 5 should reference the mockups in the plan.

**GATE: Pause after this phase and wait for user approval of the designs before proceeding.**

### Phase 3 — Evaluate
Pressure-test the chosen approach:
- Speed and performance implications
- Space / storage requirements
- Backwards compatibility with existing interfaces and APIs
- Maintainability and readability
- Scalability as the feature grows
- User experience complexity: Does this add cognitive load for the user? Is the complexity justified by the value?
- Onboarding needs: What type of guidance is appropriate — none, a tooltip, a first-run walkthrough? (Depends on feature and context)
- Feature consolidation: Are there existing features that overlap or could be consolidated with this to simplify the overall experience?
- If mockups were approved in Phase 2b, evaluate the approach against the agreed-upon design

**Testability:** Pressure-test how this feature can actually be verified end-to-end so it ships working on the first try — not "what tests should we write" (that's Phase 4) but "can we even reach this with tests, and if not, what's the closest we can get?" For trivial changes (a one-line tweak, a copy-only edit) say "trivial — no analysis needed" and move on. Otherwise cover:
- **Per-layer reachability.** For each layer that exists in the project (unit, integration, e2e — adapt to `clarifier-context.md` if it names a specific stack), is this feature reachable? Name the layer and what's needed to reach it.
- **E2e seam.** What's the e2e happy-path? Is anything blocking it — async timing, third-party side effects, hardware/permission prompts, auth-gated flows, OAuth handoffs, schedules, non-deterministic outputs, state that only exists in production? Name the specific blocker, don't gesture vaguely. E2e is the non-negotiable layer; if it's blocked, the rest of this section justifies why and proposes how close we can get.
- **Closest reachable approximation.** When e2e is blocked, propose the seam that gets us closest: test hooks, stub interfaces, deterministic fixtures, recorded-fixture replay, dev-mode `?fake=...` query params, admin-only `/trigger` endpoints. If genuinely no automated test can reach it, declare manual QA explicitly with a checklist — never stay silent.
- **Wiring-completeness.** What could ship un-wired and not get caught by tests? New endpoints missing from a router, feature flags not flipped in prod, environment variables not added to the deploy config, schema migrations not run, sub-components not imported, cron schedules not registered. List the obvious "could-silently-break" wiring that an e2e test should cover specifically.

If a testability finding materially undermines the chosen approach (e.g., the architecture makes the critical path e2e-unreachable in a way no seam can fix), say so explicitly and bounce back to Phase 2 to pick a more testable approach rather than silently patching.

**GATE: Pause after this phase and wait for user confirmation before proceeding.**

### Phase 4 — Test Strategy
Define use cases to verify the implementation as Given/When/Then scenarios. Build on Phase 3's testability findings — the layers, seams, and approximations identified there determine what gets covered here.

**Coverage mandate — ~100% of implementation paths.** Every code path the feature introduces must be exercised by at least one test. The goal is exhaustive coverage, not a representative sample. For each reachable layer, cover all three categories — never leave any of them empty:

- **Happy path** — the feature works as intended with valid inputs and satisfied preconditions.
- **Unhappy path** — invalid inputs, missing required fields, external service errors (4xx/5xx), auth failures, rate limit responses, DB write failures, permission denied. Cover every error branch the implementation will handle.
- **Edge cases** — boundary values (empty, single-item, max-length, zero/negative), concurrent operations, idempotent retries, out-of-order events, null/undefined coercion, large payloads, all enum/variant branches, session expiry mid-flow.

**Per-layer structure.** Produce a separate block of GWT scenarios for each reachable layer (per Phase 3), covering all three categories in each block:

- **Unit** — pure logic, model validation, utility helpers. Unhappy = bad input, out-of-range, type coercion surprises. Edge = boundary values, empty inputs, all enum branches.
- **Integration** — cross-component behavior, repo/DB layer, mocked external services. Unhappy = service returns 4xx/5xx, DB write fails, timeout, auth token rejected. Edge = idempotency (same call twice), partial data, concurrent writes.
- **E2E / Acceptance** — full user-facing flow. Unhappy = form with missing/invalid fields, session expired mid-flow, network error, permission denied. Edge = very long content, back-navigation mid-flow, deep links into protected pages, concurrent sessions.

**Scenario format.** Use Given/When/Then for every scenario, tagged with its layer:

```
[Unit] Given a createUser function and an email without @
When called
Then it throws ValidationError("invalid email")
```

For any e2e-unreachable seam identified in Phase 3, include explicit manual QA steps as a checklist — never stay silent.

**GATE: Pause after this phase and wait for user sign-off before proceeding.**

**After user sign-off:** extract the E2E / Acceptance-layer scenarios from this phase and write them to `tests/acceptance/scenarios/<feature-slug>.md` (derive the slug from the feature name, e.g. `feature-12-user-notifications`). Use the exact Given/When/Then format the acceptance-tester parses — do not summarize or paraphrase the scenarios. This is a silent file write, not a conversational step; confirm in one line: "Wrote N acceptance scenarios to tests/acceptance/scenarios/<feature-slug>.md." Append if the file already exists; create the directory if it doesn't. Then proceed to Phase 5.

### Phase 5 — Plan
Explain what the change means in plain language — not file-level details, but what the user will experience and what the system will do differently. Describe the implementation sequence without going into code. If mockups were approved, reference them as the visual spec. Fold in the test scenarios from Phase 4 as the acceptance criterion.

**Reference the Phase 1b decision.** State which path won — build, buy (and which package/app), or hybrid (and which pieces are bought vs. built). This anchors the plan so the build/buy/hybrid choice survives intact to implementation rather than getting forgotten between phases.

**GATE: Present the full summary and ask the user to confirm before proceeding to implementation.**

**After user confirms:** silently update docs before handing off to the feature pipeline:

1. **`docs/prompts/FEATURE_PROMPTS.md`** — add or update the feature entry with: feature title, PRD refs, dependencies, task breakdown (from Phase 5's implementation sequence), "Tests to Write First" per task (from Phase 4's layer-by-layer scenarios), and "Implementation Steps" per task. If the feature already has an entry, reconcile it rather than duplicating.
2. **`docs/DECISIONS.md`** — append any architectural or approach decisions surfaced during the 5 phases (build/buy/hybrid choice, approach selected in Phase 2, any tradeoffs locked in Phase 3). Skip if no new decisions were made.
3. Confirm in one line: "Updated FEATURE_PROMPTS.md (Feature N) and DECISIONS.md (N decisions)." Then invite the user to kick off `/feature`.

## Notes
- Do NOT write any code during this skill (except mockup HTML files in Phase 2b via the `/mockup` skill).
- Every phase is a GATE — do not proceed until the user explicitly responds.
- The goal is alignment, not implementation. Only proceed to the feature pipeline after the user explicitly confirms the summary.
- If running a single phase, still pause at the end of that phase for user input.
- Phase 1b runs against the *simplified* idea agreed on in Phase 1's complexity check, not the original — surveying prior art for a bloated version wastes the survey.
- Phase 2 brainstorms approaches *within* the build/buy/hybrid path locked at Phase 1b, not across it.
- Phase 2b mockups are auto-committed and auto-PR'd by the `/mockup` skill — never prompt about commits or PRs.
- If a Phase 3 testability finding materially undermines the chosen approach, bounce back to Phase 2 and pick a more testable alternative rather than silently patching.
