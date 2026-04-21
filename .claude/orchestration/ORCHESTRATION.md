# Orchestration Patterns

> **Pipeline announcements required.** For any orchestration pattern invoked below (Feature Sprint, Bug Hunt, Refactoring Session, Research Spike, Security Hardening), announce each non-interactive agent/step via `~/.claude/scripts/pipeline-step.sh` per the rule in `~/.claude/CLAUDE.md § "Pipeline step announcements"`. Use the pattern name as display name (e.g. `Feature Sprint`) and one of these pipeline-ids: `feature-sprint`, `bug-hunt`, `refactor`, `research-spike`, `security-hardening`. Call `begin <id> "<Display>" --total <N>` at the start, `start <id> "<Agent Name>" --index N` before each agent, `done`/`fail`/`skip` after, and `end <id> --status ok|fail` when the pattern completes. Interactive agents (requirements-clarifier) are exempt.

Predefined workflows for common development tasks. Each pattern maps this workflow's agents and skills to a specific type of work.

The Feature Sprint (Pattern A) is the default pipeline defined in CLAUDE.md. Patterns B-E cover tasks that don't fit the linear feature pipeline.

## Handoff Format

When transitioning between agents in any pattern, pass context using this format:

```
Step N complete.
What was done: [summary of actions taken]
Files changed: [list of files created/modified]
Open issues: [concerns, blockers, or items needing attention]
Next step: [agent name] -- [what it should focus on]
```

---

## Pattern A: Feature Sprint

The existing 8-step feature implementation pipeline.

**Agents (in order):**
1. requirements-clarifier -- scope and plan
2. pre-flight -- validate project health
3. test-creator -- write failing tests
4. feature-creator -- implement to pass tests
5. pattern-enforcer + security-reviewer + frontend-design-reviewer (conditional) -- parallel review
6. test-runner -- full suite
7. doc-updater -- sync all docs
8. User gate -- confirm, then commit

**Gates:** ALL 6 non-negotiable gates apply (fix-advocate for bugs, test-runner, pattern-enforcer, security-reviewer, frontend-design-reviewer conditional, doc-updater)

**Trigger:** `/feature` or "implement feature N"

---

## Pattern B: Bug Hunt

For debugging and fixing bugs. The fix-advocate drives the process.

**Agents (in order):**
1. fix-advocate -- diagnose, propose, defend fix (Steps 1-6). **BLOCKING: no code until user approves.**
2. test-creator -- write regression test for the bug (if no existing test covers it)
3. Implement the approved fix
4. test-runner -- verify fix + no regressions
5. pattern-enforcer + security-reviewer + frontend-design-reviewer (conditional) -- review the fix (parallel)
6. doc-updater -- update docs if the fix changed behavior

**Gates:**
- fix-advocate approval is BLOCKING before any code changes
- test-runner, pattern-enforcer, security-reviewer after fix

**Trigger:** Bug report, failing test, user reports error, unexpected behavior

---

## Pattern C: Refactoring Session

For code cleanup, pattern migration, or technical debt reduction.

**Agents (in order):**
1. pattern-enforcer -- audit current state, produce violation report
2. requirements-clarifier -- scope the refactor with user (Phases 1, 3, 4 -- skip Brainstorm if approach is clear)
3. feature-creator -- implement refactor changes
4. test-runner -- full suite. **BLOCKING: zero tolerance for regressions.**
5. pattern-enforcer -- re-verify, confirm violations resolved
6. security-reviewer -- if refactor touched auth, API, or data access
7. frontend-design-reviewer -- if refactor touched UI files
8. doc-updater -- Phase 4 only (update agent memory with new patterns)

**Gates:**
- test-runner is BLOCKING (zero regressions)
- pattern-enforcer runs TWICE (before and after)

**Trigger:** "refactor X", "clean up Y", "migrate pattern Z", tech debt reduction

---

## Pattern D: Research Spike

For investigation, prototyping, or exploring options. No gates -- this is exploratory work that does not produce production code.

**Agents:**
1. requirements-clarifier -- scope the question (all 5 phases: Explore, Brainstorm, Evaluate, Plan, Test Strategy)

**Gates:** NONE (no production code is written)

**Output:** Requirements document in `docs/requirements/` with findings and recommendations

**Trigger:** "research X", "explore options for Y", "investigate Z", "what's the best approach for..."

---

## Pattern E: Security Hardening

For dedicated security improvement passes.

**Agents (in order):**
1. security-reviewer -- full audit of current codebase
2. requirements-clarifier -- scope fixes with user (Phases 1 + 3 only)
3. feature-creator -- implement security fixes
4. security-reviewer -- re-verify, confirm findings resolved
5. test-runner -- full suite (fixes must not break functionality)
6. pattern-enforcer -- verify fixes follow code patterns
7. doc-updater -- Phase 3 (log security decisions) + Phase 4 (update memory)

**Gates:**
- security-reviewer runs TWICE (before and after)
- test-runner is BLOCKING

**Trigger:** `/security-check` results, security audit request, vulnerability report

---

## Choosing a Pattern

| Situation | Pattern |
|-----------|---------|
| Building a new feature from FEATURE_PROMPTS.md | A: Feature Sprint |
| User reports a bug or test failure | B: Bug Hunt |
| Code is messy, patterns have drifted, tech debt | C: Refactoring Session |
| Need to understand options before committing | D: Research Spike |
| Security audit findings need fixing | E: Security Hardening |
| Not sure what type of task this is | Start with requirements-clarifier, then pick the pattern |

## Rules

1. **Patterns are guidelines, not straitjackets.** Adapt to the situation -- skip steps that clearly don't apply, add steps if needed.
2. **Gates within each pattern are non-negotiable.** Do not skip gates marked as BLOCKING.
3. **Always use the handoff format** when transitioning between agents, so the next agent has full context.
4. **The user can override any pattern** with explicit instruction. Orchestration is a suggestion -- the human decides.
5. **If a task crosses patterns** (e.g., a feature that also fixes a bug), use the dominant pattern and note the crossover.
