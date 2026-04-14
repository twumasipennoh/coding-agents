# /pre-flight - Pre-Feature Validation

Run the **pre-flight** agent standalone to validate project health before starting a feature.

## Steps

### 1. Test suite health
Run all tests using this project's configured test command and confirm they are green before proceeding. Check `package.json`, `Makefile`, or `pyproject.toml` to identify the test runner.

If any tests are failing, list them. **BLOCKING — do not proceed until tests are green.**

### 2. Doc freshness
Check that the most recently completed feature is fully documented:
- A testing doc exists for the last completed feature
- All completed tasks in `FEATURE_PROMPTS.md` are marked `[x]` with completion notes
- DECISIONS.md is not missing any recent architectural decisions

### 3. Agent config consistency
Check for drift between CLAUDE.md and the agent files in `.claude/agents/`:
- Verify the agent inventory matches actual agent files
- Verify skill→agent mappings are consistent with skills in `.claude/skills/`
- Flag any agents referenced in CLAUDE.md that don't have a corresponding `.md` file

### 4. Environment dependencies
Verify required tools and runtimes are available. Check:
- All runtimes referenced in `package.json` / `requirements.txt` / `pyproject.toml` are installed
- Any environment variables required by the project are set
- Any required services (databases, external APIs in dev mode) are reachable

### 5. Next task dependencies
Read `FEATURE_PROMPTS.md` and identify the next task. Check:
- Are all prerequisite features marked `✅ COMPLETE`?
- Are there any unresolved deferred tasks `[-]` that block the next task?

### 6. Report

```
Pre-Flight Report

Tests:         ✅ All green / ❌ X failing — list
Doc freshness: ✅ Complete / ⚠️ Missing: <list>
Agent configs: ✅ Consistent / ⚠️ Drift: <list>
Environment:   ✅ All deps present / ❌ Missing: <list>
Next task deps: ✅ Met / ⚠️ Blocked by: <list>

Verdict: ✅ PROCEED / ❌ FIX FIRST — <list of blockers>
```

## Notes
- This is a gate, not a rubber stamp. Be honest about gaps.
- Failing tests are always BLOCKING. Other issues are advisory unless they directly block the next task.
- Adapt environment checks to whichever stack and toolchain this project uses.
