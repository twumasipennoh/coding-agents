# Memory Review

Perform a comprehensive health check of all persistent project knowledge — agent memory, CLAUDE.md, DECISIONS.md, and monitoring_spec.md — and produce actionable recommendations.

Delegate to the **memory-curator** agent (`.claude/agents/memory-curator.md`).

## Steps

1. Run the memory-curator agent with a full analysis
2. Present the structured report to the user
3. If promotion candidates exist, suggest running `/memory-promote` for the top candidate

## Arguments

- `/memory-review` — Full review (default): capacity, promotion candidates, stale entries, consolidation, conflicts, project docs health, recommendations
- `/memory-review --quick` — Summary only: line counts, health status, top 3 candidates
- `/memory-review --stale` — Focus on stale/outdated entries only
- `/memory-review --candidates` — Show only promotion candidates (scored entries)
- `/memory-review --docs` — Project docs health only: CLAUDE.md, DECISIONS.md, monitoring_spec.md analysis

## When to Use

- After completing a major feature (post doc-updater)
- When memory files are getting long (over 150 lines)
- Before starting a new project phase or sprint
- After a refactor that may have made memory entries stale
- Periodically, to prevent memory rot
- When CLAUDE.md feels bloated or outdated
- After merging many architectural decisions
