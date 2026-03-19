# /feature-status - Check Feature Progress

Read `docs/prompts/FEATURE_PROMPTS.md` and report implementation progress.

## Steps

1. Read `docs/prompts/FEATURE_PROMPTS.md`.
2. Parse each Feature heading (e.g., `# Feature 1 — <Name>`).
3. For each feature, check for completion markers:
   - A feature is **COMPLETE** if its heading contains `✅ COMPLETE` and all `[x]` checkboxes are checked.
   - A feature is **IN PROGRESS** if it has a mix of `[x]` and `[ ]` checkboxes.
   - A feature is **PENDING** if all checkboxes are `[ ]` or there are no checkboxes.
   - A feature is **⚠️ UNMARKED** if all task checkboxes are `[x]` (excluding `[-]` deferred) but the heading does NOT contain `✅ COMPLETE`. This means the feature is done but the heading was never updated.
4. Count total tasks (`- [x]` and `- [ ]`) across all features.
5. Present a summary table:

```
Feature Progress:
  Feature 1 — <Name>    ✅ COMPLETE (X/X tasks)
  Feature 2 — <Name>    PENDING  (0/Y tasks)
  Feature 3 — <Name>    ⚠️ UNMARKED (X/X tasks — heading needs ✅ COMPLETE)
  ...

  Overall: X/Y features complete, A/B tasks done
  ⚠️ N features have all tasks done but heading is not marked ✅ COMPLETE
```

6. Identify the **next actionable task** (first unchecked `[ ]` item) and display it.
7. If any features are **⚠️ UNMARKED**, list them and suggest updating their headings with `✅ COMPLETE`.

## Notes
- If `FEATURE_PROMPTS.md` doesn't exist, report that and suggest running `/prd-to-prompts`.
- Also check for any `TESTING_*.md` files in `docs/prompts/` and list which features have testing docs.
