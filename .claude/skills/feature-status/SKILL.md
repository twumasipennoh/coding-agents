# /feature-status - Check Feature Progress

> **Pipeline announcements required.** Announce via `~/.claude/scripts/pipeline-step.sh` per `~/.claude/CLAUDE.md § "Pipeline step announcements"`. Use pipeline-id `feature-status`, display name `Feature Status`. Call `begin feature-status "Feature Status"` at kickoff and `end feature-status --status ok` before emitting the reply. **Final output ordering (critical):** call `end` *before* emitting your final user-facing response — `--output-format json` returns only the final turn's text, so any reply emitted before a subsequent tool call is silently dropped.

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
5. Reply format

> ⚠️ **Call `pipeline-step.sh end feature-status --status ok|fail` before writing any text.** End-before-deliverable rule — the reply must be the final turn with no tool calls after it.

**Default chat reply: 1-3 sentences, no template, lead with current
feature + tasks remaining + on-track status.** Pattern:

    <feature> task X.Y, <pipeline step>, N/M remaining. <"on track"
    OR "blocked: <one-line>">.

If multiple features need flagging (e.g. UNMARKED features that need
headings updated, or several features in flight), apply the one-beat
rule from `~/.claude/CLAUDE.md § "Multi-part answers — one beat per
turn"` — open with the count, deliver the most urgent piece, offer
the rest if asked.

The structured summary table (per-feature progress, UNMARKED list,
TESTING doc inventory) is **opt-in only** — emit it only when the user
explicitly asks for "the full breakdown", "expand", or "details".
Don't lead with it.

If asked to expand, use this template:

```
Feature Progress:
  Feature 1 — <Name>    ✅ COMPLETE (X/X tasks)
  Feature 2 — <Name>    PENDING  (0/Y tasks)
  Feature 3 — <Name>    ⚠️ UNMARKED (X/X tasks — heading needs ✅ COMPLETE)
  ...

  Overall: X/Y features complete, A/B tasks done
  ⚠️ N features have all tasks done but heading is not marked ✅ COMPLETE
```

Then identify the **next actionable task** (first unchecked `[ ]`
item) and list any **⚠️ UNMARKED** features with a suggestion to update
their headings with `✅ COMPLETE`.

## Notes
- Default chat reply is 1-3 sentences in one message. Structured table format is opt-in only.
- If `FEATURE_PROMPTS.md` doesn't exist, report that and suggest running `/prd-to-prompts`.
- Also check for any `TESTING_*.md` files in `docs/prompts/` and list which features have testing docs.
