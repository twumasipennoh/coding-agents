# /prd-to-prompts - Generate Feature Prompts from PRD

> **Pipeline announcements required.** This is a multi-step pipeline. Announce steps via `~/.claude/scripts/pipeline-step.sh` per the rule in `~/.claude/CLAUDE.md § "Pipeline step announcements"`. Use pipeline-id `prd-to-prompts`, display name `PRD to Prompts`. Call `begin prd-to-prompts "PRD to Prompts" --total <N>` at kickoff, `start`/`done`/`fail`/`skip` around each non-interactive step below, and `end prd-to-prompts --status ok|fail` on completion. Skip interactive steps (user gates, clarification phases) — they self-announce. **Final output ordering (critical):** call `end` *before* emitting your final user-facing response. Your last message must be the deliverable itself (summary, report, PR link, etc.) with **no tool calls after it** — `--output-format json` returns only the final turn's text, so any deliverable emitted before a subsequent tool call is silently dropped.

Delegates to the **prompt-builder** agent. This skill is a shortcut — all prompt generation logic lives in `.claude/agents/prompt-builder.md`.

## What to Do

Run the **prompt-builder** agent to transform a PRD into structured "Object Oriented Prompts" in `FEATURE_PROMPTS.md`.

## Arguments

- The user should specify which PRD to use (e.g., `/prd-to-prompts PRD.md`).
- If not specified, ask the user which PRD file in `docs/` to use.

## Notes
- Output goes to `docs/prompts/FEATURE_PROMPTS.md`.
- See `.claude/agents/prompt-builder.md` for the full prompt structure, rules, and codebase patterns to reference.
- If a FEATURE_PROMPTS.md already exists, the prompt-builder agent appends new features after the last existing feature.
