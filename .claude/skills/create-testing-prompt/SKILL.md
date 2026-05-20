# /create-testing-prompt - Generate Testing Doc

> **Pipeline announcements required.** This is a multi-step pipeline. Announce steps via `~/.claude/scripts/pipeline-step.sh` per the rule in `~/.claude/CLAUDE.md § "Pipeline step announcements"`. Use pipeline-id `create-testing-prompt`, display name `Create Testing Prompt`. Call `begin create-testing-prompt "Create Testing Prompt" --total 6` at kickoff, `start`/`done`/`fail`/`skip` around each non-interactive step below, and `end create-testing-prompt --status ok|fail` on completion. Skip interactive steps (user gates, clarification phases) — they self-announce. **Final output ordering (critical):** call `end` *before* emitting your final user-facing response. Your last message must be the deliverable itself (summary, report, PR link, etc.) with **no tool calls after it** — `--output-format json` returns only the final turn's text, so any deliverable emitted before a subsequent tool call is silently dropped.

Delegates to the **doc-updater** agent in testing-doc-only mode. This skill is a shortcut — the full testing doc logic lives in `.claude/agents/doc-updater.md` (Phase 1).

## What to Do

Run the **doc-updater** agent and instruct it to run **Phase 1 only** (write `TESTING_<FEATURE_NAME>.md`), skipping Phases 2-7.

## Arguments

- If the user provides a feature name or number (e.g., `/create-testing-prompt Feature 2`), target that feature.
- If not provided, detect the most recently completed feature from `FEATURE_PROMPTS.md`.

## Notes
- Output goes to `docs/prompts/TESTING_<FEATURE_NAME>.md` using SCREAMING_SNAKE_CASE.
- See `.claude/agents/doc-updater.md` Phase 1 for the full document structure and quality rules.
