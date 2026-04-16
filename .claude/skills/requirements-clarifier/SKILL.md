# /requirements-clarifier - Engineering Method Q&A

Run the **requirements-clarifier** agent before any feature or bug fix. Walks through 5 engineering method phases with the user.

## Usage

```
/requirements-clarifier [phase <N> | all]
```

- `/requirements-clarifier` — run all 5 phases sequentially
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

**Pause after this phase and wait for user input before proceeding.**

### Phase 2 — Brainstorm
Present 2-3 implementation approaches with pros and cons for each. Consider: complexity, maintainability, backwards compatibility, testability, performance. Do not commit to an approach yet.

**Pause after this phase and wait for the user to choose or redirect before proceeding.**

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

**Pause after this phase and wait for user confirmation before proceeding.**

### Phase 4 — Plan
Explain what the change means in plain language — not file-level details, but what the system will do differently. Describe the implementation sequence without going into code.

**Pause after this phase and wait for user sign-off before proceeding.**

### Phase 5 — Test Strategy
Define use cases to verify the implementation as Given/When/Then scenarios. Cover:
- Happy path
- Edge cases identified in Phase 1
- Error/recovery scenarios
- Test coverage across all relevant layers

**Present the full summary and ask the user to confirm before proceeding to implementation.**

## Notes
- Do NOT write any code during this skill.
- The goal is alignment, not implementation. Only proceed to the feature pipeline after the user explicitly confirms the summary.
- If running a single phase, still pause at the end of that phase for user input.
