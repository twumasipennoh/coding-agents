# /requirements-clarifier - Engineering Method Q&A

Run the **requirements-clarifier** agent before any feature or bug fix. Walks through 5 engineering method phases with the user.

## Usage

```
/requirements-clarifier [phase <N> | all]
```

- `/requirements-clarifier` — run all phases sequentially
- `/requirements-clarifier all` — same as above
- `/requirements-clarifier phase 1` through `phase 5` — run a single phase

## Phases

### Phase 1 — Explore
Restate the problem in your own words. Ask clarifying questions about scope. Walk through 2-3 concrete user scenarios. Identify edge cases and corner cases the user may not have considered.

**User experience & onboarding:** For every scenario, also ask:
- What does a first-time user see when they encounter this feature? Is there an empty state, a first-run experience, or a prompt that guides them?
- Does this need onboarding — a tooltip, a walkthrough, inline hints — or is it self-explanatory from context?
- Could this be part of an existing feature instead of a new surface? Research what already exists and suggest bundling if it would simplify the user's mental model.
- What is the minimum the user needs to learn to use this? Can we reduce it?

**GATE: Pause after this phase and wait for user input before proceeding.**

### Phase 2 — Brainstorm
Present 2-3 implementation approaches with pros and cons for each. Consider: complexity, maintainability, backwards compatibility, testability, performance. Do not commit to an approach yet.

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

The approved mockups become the visual spec for Phases 3-5. Phase 3 should evaluate the approach against the approved design. Phase 4 should reference the mockups in the plan.

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

**GATE: Pause after this phase and wait for user confirmation before proceeding.**

### Phase 4 — Plan
Explain what the change means in plain language — not file-level details, but what the system will do differently. Describe the implementation sequence without going into code. If mockups were approved, reference them as the visual spec.

**GATE: Pause after this phase and wait for user sign-off before proceeding.**

### Phase 5 — Test Strategy
Define use cases to verify the implementation as Given/When/Then scenarios. Cover:
- Happy path
- Edge cases identified in Phase 1
- Error/recovery scenarios
- Test coverage across all relevant layers

**GATE: Present the full summary and ask the user to confirm before proceeding to implementation.**

## Notes
- Do NOT write any code during this skill (except mockup HTML files in Phase 2b via the `/mockup` skill).
- Every phase is a GATE — do not proceed until the user explicitly responds.
- The goal is alignment, not implementation. Only proceed to the feature pipeline after the user explicitly confirms the summary.
- If running a single phase, still pause at the end of that phase for user input.
- Phase 2b mockups are auto-committed and auto-PR'd by the `/mockup` skill — never prompt about commits or PRs.
