---
name: rule-status
description: Read the rule-hits.jsonl and rule-misses.jsonl logs and report which output rules fired — and which were violated — across recent sessions. Use when debugging "is the auto-rule system actually working?" or "am I still running long?"
---

# /rule-status — Audit Log Readout

Reports aggregate stats from two side-channel logs:

- `~/.claude/state/rule-hits.jsonl` — written by skills when they **apply** a
  calibration or lean-output rule (self-reported successes).
- `~/.claude/state/rule-misses.jsonl` — written by the turn-length `Stop` hook
  and by `/shorten` when an output rule is **violated** (a turn ran too long,
  or a multi-part answer was chunked-then-dumped instead of paced).

Hits alone only prove skills *claim* compliance; misses are the counter-signal
that catches overflow the hit log can't see. Always report both — a healthy
system trends toward more hits and fewer misses. This skill exists so the
machinery is **debuggable without polluting user-facing replies** (per the
side-channel-instrumentation rule).

## Usage

```
/rule-status                  → last 7 days aggregate
/rule-status 30d              → last 30 days
/rule-status all              → all-time aggregate
/rule-status <skill>          → filter to one skill (e.g. /rule-status research)
/rule-status by-entry         → top entries across all skills
/rule-status misses           → violations only (overflows + chunk-then-dumps)
/rule-status raw              → tail the last 20 lines of the log verbatim
```

## Steps

### 1. Locate the log

`LOG=$HOME/.claude/state/rule-hits.jsonl`

If the file doesn't exist, report:
"No rule hits logged yet. Skills haven't applied any calibration or lean-output rules,
or the system isn't wired up. Check `~/.claude/scripts/log-rule-hit.sh` exists and
is executable, and that at least one skill has run since the rule-rollout."

If the file exists but is empty, report: "Log file present but empty — same diagnosis."

### 2. Parse the args

- No arg → window=`7d`, mode=`aggregate`
- `7d`, `30d`, `90d`, `all` → window=that, mode=`aggregate`
- A skill name matching `~/.claude/skills/*/` → window=`7d`, mode=`by-skill`, filter=skill
- `by-entry` → window=`7d`, mode=`by-entry`
- `misses` → window=`7d`, mode=`misses`
- `raw` → window=`7d`, mode=`raw`

### 3. Build the readout

Use `jq` if available, otherwise a Bash + awk pipeline. Compute:

- **Aggregate mode:** total hits in window, count by rule_family (calibration vs lean-output),
  count by skill (top 5), count by entry (top 5). **Also** read
  `rule-misses.jsonl` for the same window and append a one-line misses tally:
  total misses, split by `source` (hook vs shorten) and by `entry`
  (length-overflow vs chunk-then-dump). If misses > 0, note the largest
  `words` value seen ("worst overflow: 412 words"). This contrast line is
  the load-bearing signal — surface it high.
- **By-skill mode:** total hits for this skill in window, count by entry within this skill.
- **By-entry mode:** total hits per entry across all skills in window, sorted descending.
- **Misses mode:** read only `rule-misses.jsonl`. Total in window, split by
  `source` and `entry`, top offending `context` values, and the distribution
  of `words` (min/median/max) for `length-overflow` entries. This is the
  "am I still running long?" view — lead with the worst overflow.
- **Raw mode:** last 20 log lines pretty-printed.

### 4. Format the output per lean-output rules

Compact one-liners. Open with a coverage tally line. Most-load-bearing first
(highest-frequency entry, or the skill firing the most rules).

Example aggregate output:

```
last 7d: 23 hits · calibration 8 / lean-output 15 · 5 skills · top entry: options-list-deliverables (6 hits)

top skills:
  research — 9 (calibration 3 / lean-output 6)
  investigate — 7 (calibration 4 / lean-output 3)
  pr — 4 (calibration 0 / lean-output 4)
  deploy — 2 (calibration 1 / lean-output 1)
  patch — 1 (calibration 0 / lean-output 1)

top entries:
  lean-output:padding-killers — 7
  calibration:options-list-deliverables — 6
  lean-output:compact-one-liner — 4
  calibration:design-decisions — 3
  lean-output:load-bearing-first — 3

drill down: /rule-status <skill-name>  ·  /rule-status by-entry  ·  /rule-status raw
```

### 5. Close

This skill has no pipeline announcement — it's a one-shot readout, output IS the deliverable.
Don't call `log-rule-hit.sh` from this skill (would create a feedback loop).

## Notes

- Skip filtering test entries (`rule_family=test-family` or `entry=test-entry`) — those
  are smoke-test artifacts.
- The log is reaped at 30 days by the existing pipeline cron. If `all` mode shows
  surprisingly few old entries, that's why — not data loss.
- If `jq` isn't available, fall back to `awk -F'"' '...'` parsing. The JSONL format
  is sane enough that field positions are stable.
- This skill is read-only and side-effect-free — safe to run any time.
