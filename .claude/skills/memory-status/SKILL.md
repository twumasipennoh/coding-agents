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

### 4. Report

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

Thresholds per memory file:
| Lines | Status |
|-------|--------|
| < 120 | Healthy |
| 120-180 | Warning -- consider `/memory-review` |
| > 180 | Critical -- run `/memory-review` now |

## Arguments

- `/memory-status` — Full dashboard (default)
- `/memory-status --brief` — One-line summary: `Memory: N/200 lines | CLAUDE.md: N lines | [status]`
