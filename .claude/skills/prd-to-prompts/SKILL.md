# /prd-to-prompts - Generate Feature Prompts from PRD

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
