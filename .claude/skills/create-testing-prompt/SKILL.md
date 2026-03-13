# /create-testing-prompt - Generate Testing Doc

Delegates to the **doc-updater** agent in testing-doc-only mode. This skill is a shortcut — the full testing doc logic lives in `.claude/agents/doc-updater.md` (Phase 1).

## What to Do

Run the **doc-updater** agent and instruct it to run **Phase 1 only** (write `TESTING_<FEATURE_NAME>.md`), skipping Phases 2-7.

## Arguments

- If the user provides a feature name or number (e.g., `/create-testing-prompt Feature 2`), target that feature.
- If not provided, detect the most recently completed feature from `FEATURE_PROMPTS.md`.

## Notes
- Output goes to `docs/prompts/TESTING_<FEATURE_NAME>.md` using SCREAMING_SNAKE_CASE.
- See `.claude/agents/doc-updater.md` Phase 1 for the full document structure and quality rules.
