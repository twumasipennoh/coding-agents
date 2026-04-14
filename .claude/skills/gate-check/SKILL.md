# /gate-check - Run All Quality Gates

Run all quality gates and return a consolidated GO/NO-GO decision.

## Steps

### 1. Run review gates in parallel
Run these three agents simultaneously (all read-only):
- **pattern-enforcer** — checks codebase conventions
- **security-reviewer** — static security analysis
- **monitoring-spec-validator** — validates monitoring_spec.md is present and complete

### 2. Run test suite
After the parallel review gates complete, run the **test-runner** agent with the project's test command (check package.json or Makefile for the test runner configured for this project).

### 3. Report results

```
Gate Results:

pattern-enforcer:          ✅ PASS / ⚠️ WARN / ❌ FAIL
security-reviewer:         ✅ PASS / ⚠️ WARN / ❌ FAIL
monitoring-spec-validator: ✅ PASS / ⚠️ WARN / ❌ FAIL
test-runner:               ✅ PASS / ❌ FAIL (XX passed, XX failed)

Final: ✅ GO / ❌ NO-GO
```

If NO-GO, list each failing gate with the specific findings that must be resolved.

## Notes
- Do NOT fix issues automatically — report them and wait for user direction.
- FAIL on any gate = NO-GO. WARN is informational only and does not block.
- Adapt the test-runner command to whichever test framework this project uses.
