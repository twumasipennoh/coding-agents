# Memory Review

> **Pipeline announcements required.** This is a multi-step pipeline. Announce steps via `~/.claude/scripts/pipeline-step.sh` per the rule in `~/.claude/CLAUDE.md § "Pipeline step announcements"`. Use pipeline-id `memory-review`, display name `Memory Review`. Call `begin memory-review "Memory Review" --total 3` at kickoff, `start`/`done`/`fail`/`skip` around each non-interactive step below, and `end memory-review --status ok|fail` on completion. Skip interactive steps (user gates, clarification phases) — they self-announce. **Final output ordering (critical):** call `end` *before* emitting your final user-facing response. Your last message must be the deliverable itself (summary, report, PR link, etc.) with **no tool calls after it** — `--output-format json` returns only the final turn's text, so any deliverable emitted before a subsequent tool call is silently dropped.

Perform a comprehensive health check of all persistent project knowledge — agent memory, CLAUDE.md, DECISIONS.md, and monitoring_spec.md — and produce actionable recommendations.

Delegate to the **memory-curator** agent (`.claude/agents/memory-curator.md`).

## Steps

1. Run the memory-curator agent with a full analysis. The curator returns its full structured report (categorized findings, recommendations, action items) internally — keep it in scope; do NOT dump it in chat yet.
2. **Default chat reply: 3-bullet top findings + yield.** Summarize the curator's report as the three most load-bearing findings (one bullet each, one line each), then yield with "want the full review?". Pattern:

       memory review:
       - <top finding 1, one line>
       - <top finding 2, one line>
       - <top finding 3, one line>
       want the full review?

   Pick the three by impact: capacity at risk, the strongest promotion candidate, the freshest staleness/conflict, or whatever the user most needs to act on. If a category is empty (no candidates, no stale entries), skip that bullet — three is a ceiling, not a quota.

3. **If the user says yes / "full review" / "show me" / similar, dump the full curator report verbatim** (categorized findings, recommendations, action items — exactly as the curator returned it). If the user instead picks one finding to drill into, expand just that one and stay quiet on the rest.

4. If promotion candidates exist, suggest running `/memory-promote` for the top candidate — this can ride along with either the 3-bullet summary or the full dump.

The full structured report is **opt-in only** — never lead with it. The curator's work isn't wasted; it's gated behind the ask. This applies to all `--quick` / `--stale` / `--candidates` / `--docs` variants too: summarize first, expand on request.

## Failure Knowledge Audit Pass

In addition to the standard memory-curator analysis, the full review includes a **failure knowledge** pass. This audits the known-failures knowledge base for health and effectiveness.

### What it checks

1. **Staleness**: rules that haven't been matched by any recent fix commit (check git log for fix/patch commits in the last 90 days and whether they map to existing rules). Flag rules older than 6 months with no recent match as potentially stale.
2. **Deduplication**: rules in the global sidecar (`~/.claude/known-failures.md`) that overlap or could be consolidated. Rules in per-project sidecars that are effectively identical.
3. **Cross-project promotion candidates**: rules in `<cwd>/.claude/known-failures.md` that also appear (same root cause, different wording) in another project's sidecar. Propose promotion to global.
4. **Filtering accuracy**: compare recent fix/patch commits (last 30 days) against existing known-failure rules. If a fix landed for a failure mode that already had a rule, flag it as a filtering miss — the rule existed but wasn't surfaced during implementation. Track the miss rate.
5. **Completeness**: check `docs/lessons.md` for entries that describe a generalizable failure pattern but haven't been promoted to a known-failures rule yet. Propose promotion.
6. **Rule quality**: flag rules missing any of the three required fields (trigger, failure mode, prevention) as incomplete.

### Output

Include a `Failure Knowledge` section in the curator's report:
```
## Failure Knowledge
- Rules: N global, M per-project
- Stale (>6 months, no match): [list or "none"]
- Duplicates: [list or "none"]
- Promotion candidates: [list or "none"]
- Filtering misses (last 30 days): [count] — [details]
- Lessons → rules candidates: [list or "none"]
- Incomplete rules: [list or "none"]
```

## Arguments

- `/memory-review` — Full review (default): capacity, promotion candidates, stale entries, consolidation, conflicts, project docs health, failure knowledge, recommendations
- `/memory-review --quick` — Summary only: line counts, health status, top 3 candidates
- `/memory-review --stale` — Focus on stale/outdated entries only
- `/memory-review --candidates` — Show only promotion candidates (scored entries)
- `/memory-review --docs` — Project docs health only: CLAUDE.md, DECISIONS.md, monitoring_spec.md analysis
- `/memory-review --failures` — Failure knowledge audit only: staleness, dedup, promotion, filtering accuracy, completeness

## When to Use

- After completing a major feature (post doc-updater)
- When memory files are getting long (over 150 lines)
- Before starting a new project phase or sprint
- After a refactor that may have made memory entries stale
- Periodically, to prevent memory rot
- When CLAUDE.md feels bloated or outdated
- After merging many architectural decisions
