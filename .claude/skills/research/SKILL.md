# /research — Generalized Research

Standalone research skill. Covers solution shopping, concept research, competitive/UX surveys, and open-ended exploration. Asks for mode at invocation (or accepts a `mode` arg from a caller skill), then runs cross-project grep + WebSearch, then returns a structured options list with constraint notes per option.

Generalization of `/requirements-clarifier` Phase 1b without the build/buy gate. Invokable directly by the user AND programmatically by other skills (`/investigate`'s optional delegation, future Phase 1b refactor).

> **Pipeline announcements.** Announce `begin` and `end` via `~/.claude/scripts/pipeline-step.sh` using pipeline-id `research`, display name `Research`. Inner steps mostly interactive — no per-step announcements.

> **Final output ordering.** The structured options output IS the deliverable. Do all `pipeline-step.sh end` calls BEFORE the final assistant turn.

> **Pacing:** multi-part deliverables follow `~/.claude/references/one-beat-per-turn.md`.

<!-- LEAN_OUTPUT_SUMMARY_START -->
## Lean output rules (canonical summary — auto-synced from `~/.claude/references/lean-output.md`)

- **Compact one-liner format by default.** Each item is one line:
  `name — 1-sentence summary (constraints in parens)`. Drill-down only
  on explicit user request ("expand", "full details", "show me X").
- **Padding-killers.** Never restate prior answers. Never preamble the
  next item ("Now I'll cover…", "Moving on to…"). A turn ending in two
  question marks is a bug — pick the load-bearing question, let the
  answer tee up the next turn.
- **Load-bearing first.** For lists of 3+ items, deliver the most
  load-bearing one first — the option you'd recommend, the worst
  finding, the user-facing change. Don't bury the lede.
- **Coverage tally for long lists.** Open with `N items: X top, Y
  secondary, Z edge` so the user can scan distribution before reading.
- **Side-channel instrumentation.** Log rule applications to
  `~/.claude/state/rule-hits.jsonl` via
  `~/.claude/scripts/log-rule-hit.sh lean-output <rule>` — don't cite
  rules inline in user-facing replies.
<!-- LEAN_OUTPUT_SUMMARY_END -->

> **Rule consultation.** Before any user-facing deliverable, read `~/.claude/references/lean-output.md` and `~/.claude/calibration.md`. Apply matching entries (where **Wrong pitch** matches your planned output shape) by formatting per the **Right approach**. Don't cite rules inline. Call `~/.claude/scripts/log-rule-hit.sh <family> <entry-slug> research` for each rule applied, BEFORE the final assistant turn. **Compact-format for this skill:** options-list items as `name — 1-sentence summary (license, size, maintenance status, fit/misfit in parens)`; explainer paragraphs as scenario walkthroughs; matrix cells as ✓ / ✗ / partial / 1-word note.

## Usage

```
/research <query>
```

A query is required.

## Internal-invocation contract

Other skills may invoke `/research` programmatically with:

- `query` (string, required) — the research question.
- `mode` (string, optional) — one of `solution` | `concept` | `competitive` | `other`. If omitted, `/research` runs the interactive mode-ask flow.
- `project_context` (path, optional) — if provided, `/research` runs in project-aware mode and factors the project's stack/sidecars into the output.

**Return shape (programmatic use):** structured options list. Each option:

- `name`
- `summary` (1-2 sentence what-it-is)
- `constraint_notes` (size, license, maintenance, fit/misfit against context)
- `source_url` (if external)

The caller decides how to display, gate, filter, or wrap the list. The caller is responsible for any downstream gates (e.g., Phase 1b's build/buy decision).

## Steps

### 0. Pipeline kickoff

`~/.claude/scripts/pipeline-step.sh begin research "Research" --total 5`

### 1. Mode-ask (interactive, unless caller passed `mode`)

Ask the user to pick the research mode:

- **solution** — "is there an existing package/tool/app for X?" Returns ranked options with tradeoffs.
- **concept** — "how does X work in general?" Returns explainer paragraphs, no options table.
- **competitive** — "what are other tools doing for X?" Returns feature matrix across N alternatives.
- **other** — free-form; user describes the desired output shape.

If the caller passed `mode`, skip the ask.

### 2. Project-awareness check (auto)

If invoked inside a project directory (CWD contains a `.claude/` subdirectory, OR a `project_context` arg was passed), read stack hints from any of: `<project>/.claude/clarifier-context.md`, `<project>/.claude/patterns.md`, `<project>/package.json`, `<project>/requirements.txt`. Use these to filter and tag options ("compatible with your TS+Vite stack" vs "Python-only — not a fit").

If invoked outside a project, run in general mode (no stack filtering).

### 3. Cross-project grep

Iterate `~/projects/*` for directories containing `.git/`. For each, grep the keywords from the query against the project's working tree. Skip `node_modules/`, `dist/`, `build/`, `.next/`, `coverage/`, `.claude/worktrees/`. Note hits with project name + file path + 1-line summary.

**Scaling cap:** if `~/projects/*` exceeds ~30 projects, scope to projects modified in the last 90 days unless the query is broad enough to warrant the full sweep. Document this scoping decision in the output.

### 4. WebSearch

Run WebSearch for relevant packages, libraries, apps, or implementations in the problem space. For each candidate worth raising, capture: name, what it does, size/deps, license, maintenance status (recent commits, last release, open issues at a glance).

If WebSearch is unavailable (offline, hook denied), report that and continue with cross-project grep findings only — don't fail the skill.

### 5. Surface options

Format per the mode:

- **solution** — flat list with constraint notes per option. No ranking unless the user explicitly asks.
- **concept** — explainer paragraphs synthesized from grep + WebSearch findings, structured by sub-question.
- **competitive** — feature matrix (column per alternative, row per dimension). Cells: ✓ / ✗ / partial / note.
- **other** — shape per user's specified preference.

If nothing relevant turned up: state plainly. *"No prior art across `~/projects/*`, no obvious package — build path is the realistic default."* Don't pad.

### 6. Close

`~/.claude/scripts/pipeline-step.sh end research` BEFORE the final assistant turn. The final message is the structured options output (or explainer, or matrix).

## Notes

- **Trivial-skip exit.** If the query is obviously trivial (one-line lookup, a definition like "what does PKCE stand for"), say so at the start and offer to short-circuit. Don't run cross-project grep for trivia.
- **Cross-project grep scaling.** Documented limitation past ~30 projects (inherited from Phase 1b). Time-bounded fallback applied above.
- **Programmatic vs interactive return.** Programmatic callers receive the structured list as a return value. Interactive users see the formatted display. The data is the same; the shell differs.
- **No build/buy gate.** That gate belongs to `/requirements-clarifier` Phase 1b (which wraps this skill via the contract above). `/research` itself is decision-free — it surveys and surfaces options without prescribing action.
