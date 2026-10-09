---
name: holdrun
description: Force an immediate blocking wait on a gate command (test/build/deploy/e2e) that was just launched detached (backgrounded Bash or Monitor) and looks abandoned. Use when Claude says "I'll check back once it's done" instead of actually waiting.
---

# /holdrun — force the block-and-wait, retroactively

Two other pieces already try to stop Claude from detaching a gate command and walking away: a PreToolUse hook (`check-background-gate-pretooluse.sh`) denies a backgrounded `Bash` call on a gate command outright, and a Stop hook (`check-background-gate.sh`) blocks the turn from ending if a `Monitor` call on a gate command was never followed by a real wait. `/holdrun` is the manual override for when both of those still let something through, or for a case fired before this system existed: you notice Claude backgrounded or Monitor'd a test/build/deploy/e2e run and is about to (or already did) move on without the result.

## Usage

```
/holdrun
```

No arguments. You invoke it right when you notice the stall — "kicked off, I'll report back," a `Monitor` call with no follow-up, silence after a launch.

## Steps

1. **Find the abandoned launch.** Look back through this conversation's own history (not an external transcript file — what's already in context) for the most recent `Bash` call with `run_in_background=true`, or `Monitor` call, on a gate-like command (test/build/deploy/e2e runner, or anything wrapping `longrun-tick.sh` / `holdrun.sh`) that has no later resolution — no `BashOutput`/`KillShell` for that shell id, no later blocking `Bash` call for that `Monitor` target.
   - If nothing qualifying is found, say so plainly: "Nothing looks abandoned — no unresolved backgrounded or Monitor'd gate command in this conversation." Stop here.
   - If more than one candidate exists, take the most recent.

2. **Identify how to wait on it.**
   - If the launch was wrapped in `longrun-tick.sh` or `holdrun.sh` (has a `-l <logfile>` argument), you have a log file to poll.
   - If it was a raw `Bash(run_in_background=true)` call with no log file, you have a shell id to poll via `BashOutput` instead.

3. **Block on it now, in this turn — this is the whole point of the command:**
   - **Log-file case:** run `~/.claude/scripts/longrun-wait.sh <logfile> '\[DONE rc=' <max-minutes>` as a blocking `Bash` call. This polls until the `[DONE rc=...]` marker appears or the budget expires. Pick `max-minutes` generously (the job is already running — you're not starting a fresh timer, just catching up to wherever it is).
   - **Shell-id case (no log file):** poll `BashOutput` on that shell id in a loop — check status, and if still `running`, sleep briefly (a few seconds) and check again, as repeated blocking `Bash(sleep N)` + `BashOutput` calls — until status is no longer `running`. There is no long single blocking primitive for a raw backgrounded shell the way `longrun-wait.sh` provides for a log file; that gap is exactly why `holdrun.sh`/`longrun-tick.sh` (which always produce a log) is the recommended way to launch gate commands in the first place.

4. **Report the outcome** — pass/fail, and the tail of what happened (last few log lines, or the shell's final output). Do not end the turn until this step is done; ending with "still waiting" defeats the entire purpose of `/holdrun`.

## What NOT to do

- Don't re-launch the command from scratch unless the original process is confirmed dead (checked via `BashOutput` status or the log's mtime) — you'd be duplicating work still in flight.
- Don't call `Monitor` again as the "wait" — `Monitor` returns immediately and doesn't block; see `~/.claude/CLAUDE.md` "Hold the turn."
- Don't report "still running, will check back" as the final answer to `/holdrun`. If the budget in step 3 expires before completion, say so explicitly (`longrun-wait.sh` exits 2 with `[WAIT-TIMEOUT ...]`) and ask the user whether to keep waiting with a larger budget — don't silently drop back into the detached pattern this command exists to fix.
