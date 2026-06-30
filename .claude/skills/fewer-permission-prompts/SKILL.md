---
name: fewer-permission-prompts
description: Override of the built-in /fewer-permission-prompts. Scans transcripts for ALL tool calls (read AND write Bash, MCP, Read/Write/Edit) and adds a prioritized, safety-filtered allowlist to project .claude/settings.json.
---

# Fewer Permission Prompts (override — covers all tool calls)

> **Pipeline announcements required.** This is a multi-step pipeline. Announce steps via `~/.claude/scripts/pipeline-step.sh` per the rule in `~/.claude/CLAUDE.md § "Pipeline step announcements"`. Use pipeline-id `fewer-permission-prompts`, display name `Fewer Permission Prompts`. Call `begin fewer-permission-prompts "Fewer Permission Prompts" --total 10` at kickoff, `start`/`done`/`fail`/`skip` around each non-interactive step below, and `end fewer-permission-prompts --status ok|fail` on completion. Skip interactive steps (user gates, clarification phases) — they self-announce. **Final output ordering (critical):** call `end` *before* emitting your final user-facing response. Your last message must be the deliverable itself (summary, report, PR link, etc.) with **no tool calls after it** — `--output-format json` returns only the final turn's text, so any deliverable emitted before a subsequent tool call is silently dropped.

> **Note:** This is a user-side override of the built-in skill of the same name. Whether it shadows the built-in depends on Claude Code's skill resolution order. If invoking `/fewer-permission-prompts` still gives the read-only-only behavior, use `/fewer-prompts-all` instead — it has identical body to this file.

> **Final output ordering (critical):** the deliverable of this skill is a markdown table (prioritized allowlist) plus the report block. Do the settings.json Edit *before* emitting that final text. Your last assistant message must contain the table + report together with **no tool calls after it** — `--output-format json` returns only the final turn's text, so any text emitted before a subsequent tool call is silently dropped. Steps 1–7 are analysis (Read transcripts), step 9 is the Edit, steps 8 + 10 are the final text — present them together as the closing turn.

This skill extends the read-only built-in to cover **every** tool call you make — Bash (read AND write), MCP tools, plus Read/Write/Edit/Glob/Grep — and proposes a prioritized allowlist for `.claude/settings.json`. Safety filtering is stricter than the built-in because we're now allowing mutations.

The format for permissions is: `Bash(foo*)`, `Bash(foo)`, `Bash(foo bar *)`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `mcp__slack__slack_read_thread`, etc.

## Steps

1. **Locate transcripts.** Session transcripts live at `~/.claude/projects/<sanitized-cwd>/*.jsonl`. Each line is a JSON object. Tool calls appear as `assistant` messages with `message.content[]` entries of `type: "tool_use"`. The `name` field identifies the tool (e.g. `"Bash"`, `"Read"`, `"Edit"`, `"Write"`, `"mcp__slack__slack_read_thread"`); for Bash, `input.command` is the shell string.

   Scan recent transcripts across the user's projects dir — not just the current project — so the allowlist reflects actual usage. Cap at 50 most-recently-modified JSONL files for speed.

2. **Extract tool-call frequencies.**
   - For `Bash` calls: parse `input.command`, take the leading command token (handling `sudo`, `timeout`, pipes, `&&`, env-var prefixes). Record the command + first subcommand pair (e.g. `git commit`, `git add`, `npm install`, `mkdir`, `gh pr create`).
   - For non-Bash built-in tools (`Read`, `Write`, `Edit`, `Glob`, `Grep`, `NotebookEdit`, etc.): record the bare tool name. These are typically permitted as a single tool-level entry.
   - For MCP calls: record the full tool name (e.g. `mcp__slack__slack_read_thread`, `mcp__claude_ai_Gmail__create_draft`).
   - Count occurrences across the scanned transcripts.

3. **Filter out dangerous patterns.** Drop anything that grants arbitrary code execution OR could destroy data without an undo:

   **Always drop (never allowlist these):**
   - `Bash(rm *)`, `Bash(rm -rf *)`, `Bash(rmdir *)`, `Bash(unlink *)`
   - `Bash(git push --force*)`, `Bash(git push -f*)`, `Bash(git reset --hard*)`, `Bash(git clean -f*)`, `Bash(git clean -fd*)`, `Bash(git checkout -- *)`, `Bash(git restore *)` (when used to discard), `Bash(git branch -D *)`
   - `Bash(sudo *)`, `Bash(su *)`
   - `Bash(dd *)`, `Bash(mkfs *)`, `Bash(fdisk *)`, `Bash(parted *)`
   - `Bash(curl * | sh)`, `Bash(wget * | sh)`, `Bash(curl * | bash)`, etc. (piping to interpreter)
   - `Bash(docker run*)`, `Bash(docker exec*)`, `Bash(kubectl exec*)` — arbitrary code execution

   **Arbitrary code execution wildcards — never as wildcard, exact forms only when frequent:**
   - Interpreters: `python`/`python3`, `node`, `bun`, `deno`, `ruby`, `perl`, `php`, `lua`
   - Shells: `bash`, `sh`, `zsh`, `fish`, `eval`, `exec`, `ssh`
   - Package runners: `npx`, `bunx`, `uvx`, `uv run`
   - Task-runner wildcards: `npm run *`, `yarn run *`, `pnpm run *`, `bun run *`, `make *`, `just *`, `cargo run *`, `go run *`
   - `gh api *` (POST/DELETE bodies are arbitrary)

   For these categories, ONLY allowlist exact, repeatedly-observed invocations — e.g. `Bash(npm run typecheck)` or `Bash(npm run test:web)` are fine, but `Bash(npm run *)` is not.

4. **Permit writes — but with patterns, not blanket wildcards.** Common safe-mutation commands the user actually runs:
   - **Git mutations:** `Bash(git add *)`, `Bash(git commit*)`, `Bash(git checkout *)`, `Bash(git switch *)`, `Bash(git stash*)`, `Bash(git pull*)`, `Bash(git fetch*)`, `Bash(git merge --no-ff *)`, `Bash(git rebase *)`, `Bash(git push)` (plain, no `--force`), `Bash(git push origin *)`, `Bash(git tag *)`
   - **Filesystem:** `Bash(mkdir *)`, `Bash(touch *)`, `Bash(cp *)`, `Bash(mv *)`, `Bash(ln *)`, `Bash(chmod 6?? *)`, `Bash(chmod 7?? *)` — but **NOT** `Bash(chmod *)` (would allow `chmod 777` or world-writable secrets)
   - **Package managers (specific subcommands only):** `Bash(npm install*)`, `Bash(npm ci*)`, `Bash(npm uninstall*)`, `Bash(pnpm install*)`, `Bash(yarn install*)`, `Bash(pip install*)`, `Bash(bun install*)` — exclude `*` because these download and execute postinstall scripts; allowlist by intent, not blanket
   - **Test/build (exact forms when stable):** `Bash(npx vitest*)`, `Bash(npx tsc*)`, `Bash(npx playwright test*)`, `Bash(npx eslint*)`, `Bash(npm run test)`, `Bash(npm run test:web)`, `Bash(npm run build)`, `Bash(npm run lint)`, `Bash(npm run typecheck)` — list each observed exact form rather than `npm run *`
   - **Firebase / GCP (deploy is a side effect — be specific):** `Bash(npx firebase deploy --only hosting:staging*)`, `Bash(npx firebase emulators:start*)`, `Bash(gh pr create*)`, `Bash(gh pr merge*)`, `Bash(gh pr comment*)`, `Bash(gh issue create*)`
   - **MCP write tools:** allowlist verbatim (they're already specific): `mcp__claude_ai_Gmail__create_draft`, `mcp__claude_ai_Gmail__label_message`, `mcp__notion__create_page`, etc.
   - **Built-in Claude tools:** `Read`, `Write`, `Edit`, `Glob`, `Grep`, `NotebookEdit` — bare tool name allows all uses (the user is already accepting these implicitly; they're sandboxed to reachable filesystem paths)

5. **Drop commands Claude Code already auto-allows.** These never prompt — don't suggest them. (Source of truth: `src/tools/BashTool/readOnlyValidation.ts` and `src/utils/shell/readOnlyCommandValidation.ts` in the Claude Code repo.)
   - **Always auto-allowed (any args):** `cal`, `uptime`, `cat`, `head`, `tail`, `wc`, `stat`, `strings`, `hexdump`, `od`, `nl`, `id`, `uname`, `free`, `df`, `du`, `locale`, `groups`, `nproc`, `basename`, `dirname`, `realpath`, `cut`, `paste`, `tr`, `column`, `tac`, `rev`, `fold`, `expand`, `unexpand`, `fmt`, `comm`, `cmp`, `numfmt`, `readlink`, `diff`, `true`, `false`, `sleep`, `which`, `type`, `expr`, `test`, `getconf`, `seq`, `tsort`, `pr`, `echo`, `printf`, `ls`, `cd`, `find`.
   - **Auto-allowed with zero args only:** `pwd`, `whoami`, `alias`.
   - **All git read-only subcommands** (`git status`, `git log`, `git diff`, `git show`, `git blame`, `git branch`, etc.).
   - **All gh read-only subcommands** (`gh pr view`, `gh pr list`, `gh pr diff`, etc.).
   - **Docker read-only:** `docker ps`, `docker images`, `docker logs`, `docker inspect`.

6. **Pick the pattern form.** Use the narrowest pattern that still covers observed usage:
   - Many variants of one root command (`git commit -m ...`, `git commit --amend`, `git commit -a -m ...`): use `Bash(git commit*)`.
   - A single exact invocation common: use `Bash(foo)` no wildcard.
   - For non-Bash built-in tools (`Read`, `Write`, `Edit`): the bare name is fine.
   - For MCP: use the full tool name verbatim, no wildcard.
   - **Never widen** beyond the rules in step 3 — no arbitrary code execution, no destructive wildcards.

7. **Prioritize.** Rank by count descending. Drop entries that appeared fewer than ~3 times. Cap at top ~30.

8. **Present the prioritized list to the user** as a markdown table with columns: rank, pattern, count, category (read/write/mcp/tool), one-line notes. Show 2-3 entries you intentionally dropped with the reason.

9. **Merge into `.claude/settings.json`** in the current project (not `~/.claude/settings.json`, not `.claude/settings.local.json`). Create the file if it doesn't exist. Preserve existing keys and existing `permissions.allow` entries; de-duplicate; don't remove anything; don't reorder unrelated fields.

   If the project has the user's `/permissions` skill backup at `.claude/.permissions-backup.json`, leave it alone — that file represents the pre-profile baseline.

10. **Report back.** Tell the user what was added, what was already in the allowlist, what was dropped and why. Reminder: review with `/permissions status` and that they can revert by editing `.claude/settings.json` directly.

Do not add anything to `permissions.deny` or `permissions.ask`. Do not touch any other settings field. Do not write to `~/.claude/settings.json` — this is project-scoped only.
