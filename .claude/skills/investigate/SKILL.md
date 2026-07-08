# /investigate — Triage and Understanding

Investigate a bug, alert, or open-ended "how does this work" question. Runs the shared diagnostic spine, then a tradeoff/feasibility discussion, then a CONDITIONAL gate to action skills (`/fix`, `/patch`, `/feature`) only if a concrete symptom was identified. Curiosity queries end without an action prompt.

> **Pipeline announcements.** Announce `begin` and `end` via `~/.claude/scripts/pipeline-step.sh` using pipeline-id `investigate`, display name `Investigate`. Inner steps are mostly interactive (agent ↔ user) — no per-step announcements.

> **Final output ordering.** The investigator agent's closing turn IS the deliverable. Do all `pipeline-step.sh end` calls BEFORE the agent's final summary, never after.

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
- **Deliverable-type traps (from the miss log).** A verdict, approval
  gate, or diagnosis does NOT earn 350 words (`earned-is-not-a-license`):
  compress to root-cause + fix/decision shape + the one ask. Lead with
  the load-bearing sentence, recap only if asked (`lead-not-recap`). A
  yes/no-ish or single-axis question gets the direct answer in sentence
  one plus at most one caveat (`binary-answer-first`). End on exactly
  one question (`one-ask-per-turn`).
<!-- LEAN_OUTPUT_SUMMARY_END -->

> **Rule consultation.** Before any user-facing deliverable, read `~/.claude/references/lean-output.md` and `~/.claude/calibration.md`. Apply matching entries (where **Wrong pitch** matches your planned output shape) by formatting per the **Right approach**. Don't cite rules inline. Call `~/.claude/scripts/log-rule-hit.sh <family> <entry-slug> investigate` for each rule applied, BEFORE the final assistant turn. **Compact-format for this skill:** spine steps as `Reproduce: 1-line + evidence; Locate: file:line + 1 phrase; Root cause: 1 sentence; Impact: scope + severity; Siblings: count + 1-line if any`. Tradeoff discussion as scenario walkthroughs, not abstract architecture talk.

## Usage

```
/investigate <bug-description-or-question>
```

A query is required. If none given, ask the user for one before proceeding.

## Steps

### 0. Pipeline kickoff

`~/.claude/scripts/pipeline-step.sh begin investigate "Investigate" --total 2`

### 1. Invoke the investigator agent

Invoke the `investigator` agent. The agent will:

- Read `~/.claude/references/diagnostic-spine.md` and execute all 5 spine steps (Reproduce → Locate → Root cause → Impact → Sibling sweep) with incremental-disclosure pacing.
- Tag the invocation as `mode: symptom` or `mode: curiosity` in Step 1's output. This tag drives the conditional gate at the end.
- After the spine, conduct a tradeoff/feasibility discussion with the user — surface options, name tradeoffs, assess feasibility. NOT a single proposed fix awaiting approval (that's `fix-advocate`'s role).
- Conditionally offer an action gate (`/fix`, `/patch`, `/feature`) at the end IF and ONLY IF `mode: symptom`. Curiosity mode ends with a summary turn.

The agent paces the spine across multiple turns. Do not collapse the disclosure into one wall.

### 2. Optional /research delegation

If the tradeoff discussion surfaces "is there an existing solution for this," the investigator may invoke `/research` programmatically per its internal-invocation contract (see `~/.claude/skills/research/SKILL.md`). Otherwise, the user can invoke `/research` directly.

### 3. Close

`~/.claude/scripts/pipeline-step.sh end investigate` BEFORE the agent's final summary turn. The final assistant message is the investigator's closing summary — gated for symptom mode, plain summary for curiosity mode, including cleanup decisions for any write-with-cleanup artifacts.

## Notes

- Do NOT autonomously call `/fix`, `/patch`, or `/feature` from within `/investigate`. The conditional gate is a USER prompt at the end, never an autonomous invocation.
- Write-with-cleanup discipline is enforced by the agent: probes may be created to verify hypotheses but MUST be cleaned up unless judged useful (then surfaced for the user to retain).
- For trivial Locate-only queries ("where does X live"), the spine compresses naturally — the agent can skip steps that don't apply, with explicit acknowledgment ("no Impact analysis needed for a Locate-only query").
- The conditional-gate heuristic is deterministic: gate iff Step 1's mode tag is `symptom`. No fuzzy judgment.
