## Project Overview
<!-- Update this section with your project name, tech stack, and structure -->
This project uses a structured, agent-driven development workflow. Always confirm which module or feature area you're working in before making changes.

## Communication Style
When explaining how something works, describe it as a **user journey walkthrough** -- what the user sees, taps, and experiences, screen by screen, element by element. Frame it like a product manager walking someone through the UX. Lead with a quick analogy if it helps frame the concept, then walk through the experience.

**Default to describing the experience, not the architecture.** Only reference code, files, or technical implementation details when specifically asked.

Example of the right style:
> A user logs in and sees their discover page. The first video pops up on their screen. The bottom nav takes up 5% of the page and the video feed takes up the rest. It's muted, so they tap their screen and see controls at the top: mute/unmute, subtitles, speed, quality, and fullscreen to the top right. To the right of the video feed, they see like, insightful, save, summary, and more options icons...

Example of the wrong style:
> The DiscoverPage component renders a VideoFeed which maps over the content array. Each ContentCard contains a YouTube iframe with controls={0}. The useYouTubePlayer hook manages player state via 250ms polling...

## Deployment
<!-- Update with your deployment targets and aliases -->
When deploying, always verify: 1) correct deploy target/alias, 2) environment variables point to correct project, 3) all tests pass. Never deploy to production unless explicitly asked.

## Workflow / Feature Pipeline
- Follow the project's feature implementation pipeline using the agents defined in `.claude/agents/`. The pipeline order is: **requirements-clarifier** -> **pre-flight** -> **test-creator** -> **feature-creator** -> **pattern-enforcer** + **security-reviewer** (parallel) -> **test-runner** -> **doc-updater** -> user gate -> commit. Each agent's full specification lives in its `.md` file -- read it before invoking. Do NOT skip pipeline steps even if they seem unnecessary.
- Before implementing a feature, verify the actual state of the codebase. Do not assume docs are accurate -- check the code. If user references task numbers that don't exist, clarify before proceeding.

## Code Style / Guidelines
When making UI/CSS fixes, change ONLY what was requested. Do not refactor surrounding layout or restructure components unless explicitly asked. Minimal, targeted changes only.

---

## CORE PRINCIPLES
1. **Simplicity First** -- Choose the simplest solution that works. Don't over-engineer or add abstractions until they're clearly needed.
2. **No Laziness** -- Find root causes, not temporary fixes. Don't hack around problems -- solve them properly.
3. **Minimal Impact** -- Only touch what's necessary. A bug fix doesn't need surrounding code cleaned up. A feature doesn't need unrelated refactoring.
4. **Demand Elegance** -- For non-trivial changes, pause and ask "is there a more elegant way?" Challenge your own work before presenting it. Skip for simple/mechanical fixes.
5. **Autonomous Bug Fixing** -- When given a bug report, investigate and fix it. Point at logs, errors, and failing tests -- then resolve them. Don't ask for hand-holding.

## SELF-IMPROVEMENT
After ANY correction from the user, record the pattern in `docs/lessons.md` (create if it doesn't exist). Review `docs/lessons.md` at the start of each session. Format:
```
## <Lesson Title>
**Date**: YYYY-MM-DD
**Trigger**: <what went wrong>
**Rule**: <what to do instead>
```

## NON-NEGOTIABLE GATES (BLOCKING)

After ANY code changes -- whether via `/feature`, feature-implementer, direct implementation, or bug fix -- these 5 agents MUST run before presenting work as complete. No exceptions.

0. **fix-advocate** -- For ANY bug fix or debugging task, this agent MUST be invoked BEFORE writing fix code. It diagnoses, explains, proposes, and defends the fix -- only implementing after explicit user approval. BLOCKING for bug fixes. Skip only for net-new feature code with no bug component.
1. **test-runner** -- Full test suite across all layers. All tests must pass. BLOCKING.
2. **pattern-enforcer** -- Must report no VIOLATIONS. BLOCKING.
3. **security-reviewer** -- Must report no CRITICAL findings. BLOCKING.
4. **frontend-design-reviewer** -- CONDITIONAL: only when changed files match frontend patterns. Must report no CRITICAL findings. BLOCKING on CRITICAL.
5. **doc-updater** -- Must complete all applicable doc-sync phases. BLOCKING.

### Enforcement
- For bug fixes: Do NOT write any fix code until fix-advocate has completed Steps 1-6 and received user approval.
- Do NOT present work as complete or ask the user to review until all gates have run and passed.
- If ANY gate reports issues, fix them and re-run before proceeding.
- After all gates pass, print the completion log:
  > GATES: fix-advocate ✓ | test-runner ✓ | pattern-enforcer ✓ | security-reviewer ✓ | frontend-design-reviewer ✓ | doc-updater ✓
  > (When no frontend files changed: frontend-design-reviewer SKIPPED)

---

## IMPLEMENTATION PLAN TO-DOs
- Look for the docs/prompts/FEATURE_PROMPTS.md file

- If there is not a FEATURE_PROMPTS.md file, create one. Using the specifications defined in PRD.md and any other specification docs, break the app requirements into small micro prompts that we can use to track progress and make steady but fast progress. Include testing process as part of the micro prompt
   - Almost like Object Oriented Programming but in this case, Object Oriented Prompts
   - Break down each requirement specified into features
   - For each feature, break it down into 3-5 tasks
      - For each feature, note how you will test them as a set of prompts in TESTING_PROMPTS.md (make reference to them in FEATURE_PROMPTS.md)
      - Make sure the prompts include verifying and covering each of the requirements defined in the specifications
   - Test and fix the tasks until they work before moving on to the next feature
   - Open a new session for the next feature and then perform this cycle again

- Put the prompts in a folder called prompts

- **Backend->UI Feature Ordering**: For every backend feature developed, the corresponding UI must be created immediately afterwards. Features in FEATURE_PROMPTS.md must alternate between backend and UI tasks. Never batch all backend work before UI -- each backend capability must have its UI counterpart implemented and tested before moving to the next feature.

- For every feature implemented, run through tests at all levels and fix any bugs

- Confirm with user before moving on to the next feature

## SECURITY PLAN TO-DOs
- Make sure we have a .gitignore that excludes .env, node_modules, API keys, system logs, and anything that needs to not be made public in GitHub

- Add rate limiting to the API routes - max 100 requests an hour per IP

- Set up policies so users can only access their own data

- **ALWAYS** add `method="POST"` to any `<form>` that collects credentials (login, signup, password reset, etc.)
  - Without `method="POST"`, if JavaScript fails to load, the browser falls back to native GET submission -- putting email/password in the URL query string
  - Credentials in URLs are logged by servers, visible in browser history, and leaked via Referrer headers

## TESTING TO-DOs
- Fully verify and cover each of the requirements defined in the specifications
- Cover unit testing, integration testing, UI/UX tests (using Playwright), smoke testing, regression testing, system testing, UAT, performance testing, security checks
- Tests should go under a testing folder. Create folder if not available
- Run tests whenever a change is made
- When manually testing in browser, don't retry an action more than 3 times unless explicitly asked to do so. Investigate why the desired action is not working.
- When writing tests with text selectors, prefer specific locators (getByRole, getByTestId, nth()) over generic text matching to avoid ambiguous selector errors.

## LOGGING TO-DOs (CRITICAL FOR DEBUGGING)
Logs are the primary debugging tool in production. They must surface actionable information for every feature.

- **Every API endpoint** must log: request received (with route + method), key parameters (user_id, entity_id -- NOT tokens/passwords), success/failure outcome, and response status code
- **Every service/business logic function** must log: function entry with key params, decision branches taken, external API calls (before and after with status), and errors with full context
- **Every database operation** must log: operation type (read/write/update/delete), collection/document path, success/failure, and document count for queries
- **Use structured logging**: Use the language's standard logging module (not bare print/console.log). Use appropriate log levels:
  - INFO -- Normal operations (request received, operation succeeded)
  - WARNING -- Recoverable issues (rate limited, retry, fallback used)
  - ERROR -- Failures that need attention (API errors, unexpected states, exceptions)
  - DEBUG -- Verbose detail for local debugging only
- **Include correlation context**: Always include `user_id` and `request_id` (if available) in log messages
- **Log error details**: When catching exceptions, always log the full error with stack trace -- do NOT silently swallow errors
- **Never log**: tokens, passwords, API keys, PII, or full request/response bodies containing sensitive data
- A feature is NOT complete if it lacks sufficient logging to debug issues from production logs alone

## DEVELOPMENT TO-DOs
- Make sure that every package used is up to date. No package should be outdated unless there is a conflict
- When implementing features, ALWAYS include E2E tests as part of the implementation - do not consider a feature complete without them.
- Before marking a feature as complete, confirm you've done: 1. domain types, 2. UI components, 3. pages/routing, 4. unit tests, 5. E2E tests. List each as check or x when done.
- Create a TESTING_<FEATURE_NAME> file inside of prompts folder for each feature after you have completed implementation.

## DEBUGGING TO-DOs
- When a user reports an error, focus on the actual error message first before investigating infrastructure issues.

## AUTOMATION RULES

### Requirements Clarification (Before Any Feature or Bug Fix)
When the user requests a new feature or bug fix, run the **requirements-clarifier** agent FIRST -- before any code is written. This agent walks through 5 engineering method phases with the user:
1. **Explore** -- Restate the problem, clarify scope, walk through concrete scenarios, identify edge cases
2. **Brainstorm** -- Present 2-3 implementation approaches with pros/cons
3. **Evaluate** -- Pressure-test chosen approach (speed, space, backwards compat, maintainability, scalability)
4. **Plan** -- Explain what the change means in plain language (not file-level details)
5. **Test Strategy** -- Define use cases to verify as Given/When/Then scenarios

Only proceed to the implementation pipeline after the user confirms the summary is correct.

### Feature Implementation Pipeline (Test-First)
When implementing a feature, execute this pipeline in order:

1. **pre-flight** -> Validates project health before starting: test suite green, docs fresh, agent configs consistent, next task dependencies met. BLOCKING if tests fail.
2. **test-creator** -> Reads the task spec from FEATURE_PROMPTS.md, writes failing tests based on "Tests to Write First"
3. **feature-creator** -> Implements code to make the failing tests pass, follows "Implementation Steps"
4. **pattern-enforcer** + **security-reviewer** + **frontend-design-reviewer** -> Run in PARALLEL (all read-only). pattern-enforcer and security-reviewer ALWAYS run. frontend-design-reviewer only runs if changes touch frontend files. Fix any findings before proceeding.
5. **test-runner** -> Runs the full test suite across all layers. Must be all green.
6. **doc-updater** -> Performs all 7 doc-sync phases:
   - Phase 1: Writes TESTING_<FEATURE_NAME>.md in docs/prompts/
   - Phase 2: Updates FEATURE_PROMPTS.md (checkboxes + completion notes)
   - Phase 3: Appends to docs/DECISIONS.md (if new architectural/security decisions)
   - Phase 4: Updates agent memory (.claude/agent-memory/)
   - Phase 5: Updates PRD to reflect what was actually built
   - Phase 6: Updates README.md (new routes, endpoints, features, docs references)
   - Phase 7: Flags items needing human attention (CLAUDE.md, agent configs, global MEMORY.md)
7. **User gate** -> Present doc-updater summary and GATES completion log. User confirms go/no-go.
8. **Commit** -> After user confirms, stage and commit all changes with a descriptive commit message.

### Agent Inventory
| Agent | Role | Writes Code? |
|-------|------|-------------|
| requirements-clarifier | Engineering method Q&A before implementation | No (conversation only) |
| pre-flight | Pre-feature validation (tests, docs, configs) | No (read-only) |
| prompt-builder | PRD -> FEATURE_PROMPTS.md | No (docs only) |
| test-creator | Writes failing tests (TDD) | Tests only |
| feature-creator | Implements code to pass tests | Yes |
| feature-implementer | Orchestrates full feature implementation | Yes |
| pattern-enforcer | Checks codebase conventions | No (report only) |
| security-reviewer | Static security analysis | No (report only) |
| frontend-design-reviewer | Checks design quality, a11y, responsive, UX | No (report only) |
| test-runner | Runs test suites, reports results | No (report only) |
| doc-updater | Doc sync: TESTING, FEATURE_PROMPTS, DECISIONS, agent memory, PRD, README | No (docs only) |

### Skill -> Agent Mapping
Skills are user-facing shortcuts. Agents are pipeline building blocks. Each skill delegates to its corresponding agent:
- `/test` -> test-runner agent
- `/create-testing-prompt` -> doc-updater agent (Phase 1 only)
- `/prd-to-prompts` -> prompt-builder agent
- `/feature` -> orchestrates full pipeline (steps 1-8)
- `/checkpoint` -> validates current feature + pre-flight for next feature
- `/feature-status` -> reads FEATURE_PROMPTS.md progress (standalone)
- `/security-check` -> standalone security audit (standalone)
- `/design-check` -> frontend-design-reviewer (standalone design audit)
- `/deploy` -> deployment checklist
- `/memory-review` -> memory-curator agent (audit memory health, find promotion candidates)
- `/memory-promote` -> standalone (graduate memory entries to CLAUDE.md)
- `/memory-status` -> standalone (quick memory health dashboard)

### Standalone Automation Rules
These are superseded by the NON-NEGOTIABLE GATES section above. Whether inside or outside the pipeline, ALL 4 gates (test-runner, pattern-enforcer, security-reviewer, doc-updater) MUST run after any code changes. No conditional triggers -- they always run.

### Agent Inference (Auto-Detection)
When the user describes a task, automatically detect which agent(s) to invoke based on the task type. **State which agent you're using and proceed -- do not wait for confirmation.**

Announce format: "This is a [task type] -- running [agent name]." Then proceed immediately.

| User intent | Agent(s) to invoke |
|---|---|
| Implement / build / add a feature | **requirements-clarifier** first, then full pipeline |
| Bug report / error / something broken | **fix-advocate** first (before any fix code) |
| Review code / check patterns | **pattern-enforcer** + **security-reviewer** (parallel) |
| UI/design review / check design | **frontend-design-reviewer** (standalone) |
| Run / check tests | **test-runner** |
| Update / sync docs | **doc-updater** |
| Create prompts from PRD | **prompt-builder** |
| Security audit / check | **security-reviewer** (standalone) |
| Deploy / release | Pre-deployment checklist |
| Explain how something works | No agent -- use user journey walkthrough style (see Communication Style) |

### Orchestration Patterns
For non-feature tasks (debugging, refactoring, research, security hardening), see `.claude/orchestration/ORCHESTRATION.md` for predefined workflows. The Feature Sprint (Pattern A) is the default pipeline described above.

### Workflow Rules
- **Plan Mode Default**: Enter plan mode for any task with 3+ steps or architectural decisions. By default, use the **requirements-clarifier** agent (`.claude/agents/requirements-clarifier.md`) as the planning mechanism -- it walks through 5 phases (Explore, Brainstorm, Evaluate, Plan, Test Strategy), asking questions at each phase and waiting for the user to respond before proceeding to the next. If something goes sideways mid-implementation, STOP and re-plan through the requirements-clarifier rather than pushing through.
- **Verification Before Done**: Before presenting work as complete, diff behavior between main and your changes. Ask yourself: "Would a staff engineer approve this?" If not, iterate.
- **Subagent Strategy**: Use subagents liberally -- offload research, exploration, and validation to subagents. One focused task per subagent. Don't duplicate work a subagent is already doing.

### E2E Tests (MANDATORY)
E2E tests MUST be run for any change that touches UI, auth flow, client-side JS, routing, or API endpoints. Do NOT skip them -- they are a separate testing layer that catches bugs unit tests miss (race conditions, redirect behavior, module loading order, nav visibility).

**When to run E2E tests:**
- Any change to UI templates or components
- Any change to auth logic (login, signup, logout, session handling)
- Any change to routes or redirects
- Any change to client-side JavaScript
- Before any deployment

### Pre-Deployment Checklist
Before deploying, ALL of the following must pass:
1. Unit tests -- BLOCKING
2. Integration tests -- BLOCKING
3. E2E tests -- BLOCKING
4. No unresolved lint or type errors
