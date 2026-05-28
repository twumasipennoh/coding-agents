# Memory Status

Quick overview of the project's memory health across all memory files.

## Steps

### 1. Count Lines in All Memory Files
- Read every file in `.claude/agent-memory/` subdirectories
- Read `docs/lessons.md` if it exists

### 2. Check CLAUDE.md Size
- Count lines in `.claude/CLAUDE.md`

### 3. Quick Stale Check
- For each file path mentioned in memory entries, verify the file still exists
- Count stale references

### 4. Reply format

**Default chat reply: 1 line, no template, lead with the highest-
pressure file + overall status.** Pattern:

    Memory: N/200 lines | CLAUDE.md: N lines | [Healthy/Warning/Critical]

If something needs more than one line (e.g. multiple memory files in
Warning/Critical, or several stale references that need cleanup),
apply the one-beat rule from `~/.claude/CLAUDE.md § "Multi-part
answers — one beat per turn"` — open with the count, deliver the most
urgent piece, offer the rest if asked.

The structured dashboard (per-file line counts, stale reference list,
recommendations block) is **opt-in only** — emit it only when the
user explicitly asks for "the full breakdown", "expand", "details",
or invokes `/memory-status --full`. Don't lead with it.

Thresholds per memory file:
| Lines | Status |
|-------|--------|
| < 120 | Healthy |
| 120-180 | Warning -- consider `/memory-review` |
| > 180 | Critical -- run `/memory-review` now |

If asked to expand, use this template:

```
Memory Status:
  feature-engineer/MEMORY.md:  N/200 lines  [Healthy/Warning/Critical]
  fix-advocate/MEMORY.md:      N/200 lines  [Healthy/Warning/Critical]
  docs/lessons.md:             N lines      (or "not found")

  CLAUDE.md:                   N lines      [Healthy if <200]

  Stale references:            N (paths that no longer exist)

  Recommendations:
  - [actionable suggestion if any threshold exceeded]
```

## Arguments

- `/memory-status` — One-line summary (default).
- `/memory-status --full` — Full dashboard with per-file breakdown, stale references, and recommendations.
- `/memory-status --brief` — Alias for default one-line summary.
