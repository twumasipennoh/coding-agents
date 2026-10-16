# /mockup - Generate UI Mockup

> **Pipeline announcements required.** This is a multi-step pipeline. Announce steps via `~/.claude/scripts/pipeline-step.sh` per the rule in `~/.claude/CLAUDE.md § "Pipeline step announcements"`. Use pipeline-id `mockup`, display name `Mockup`. Call `begin mockup "Mockup" --total 8` at kickoff, `start`/`done`/`fail`/`skip` around each non-interactive step below, and `end mockup --status ok|fail` on completion. Skip interactive steps (user gates, clarification phases) — they self-announce. **Final output ordering (critical):** call `end` *before* emitting your final user-facing response. Your last message must be the deliverable itself (summary, report, PR link, etc.) with **no tool calls after it** — `--output-format json` returns only the final turn's text, so any deliverable emitted before a subsequent tool call is silently dropped.

Run the **mockup-designer** agent to generate a standalone HTML mockup with Tailwind CSS v4, then capture screenshots at mobile and desktop widths.

## Usage

```
/mockup <feature or screen name> [— <change summary>] [(mode: variants N | single)]
```

If no name is given, ask the user which feature or screen to mockup. The change summary (what the screen is for, what changes) feeds step 0's mode decision; callers that already locked a mode pass it in parentheses.

## Variants Mode

Variants mode runs whenever step 0 decides `mode: variants (N)` — inferred from the change summary, locked by the caller or the user, or asked for outright ("3 takes on...", "compare A/B for...", "show me variants of..."). The agent produces N separate HTML files instead of one composite, and the skill sends THREE separate telegram albums (one per viewport) so each form factor compares at full resolution.

### Step overrides in variants mode

- **HTML step:** `mockup-designer` writes `docs/mockups/<feature>-variant-{a,b,c,…}.html` (one file per variant, lowercase letters in order). See the agent's "Variants Mode" section for content requirements.
- **Lint step (if this skill defines one):** Run `lint-mockup.sh` **once per variant file**. Any blocking failure in any variant blocks the whole batch.
- **Screenshot step:** Run `generate-mockup.js` once per variant HTML. Produces `<feature>-variant-{a,b,c}-{iphone12,iphone14pro,desktop}.png` (N × 3 PNGs total). When a viewport's rendered page exceeds Telegram's 20:1 photo-aspect cap, the tool auto-slices into `<feature>-variant-{letter}-{viewport}-part-{N}.png` chunks so each chunk fits the cap and album sends succeed.
- **Telegram step:** Send THREE albums instead of one — one per viewport — so each form factor tiles cleanly. **Pass `-d`** so each PNG is uploaded via `sendDocument` (preserves the original bytes — `sendPhoto` would JPEG-re-encode and downscale to ~1280px wide, blurring the dense text and chrome in mockup screenshots). The globs use `*` after the viewport name so they catch any auto-sliced `-part-N.png` chunks the screenshot tool produced:
  ```bash
  ~/.claude/scripts/telegram-send-media.sh -d -m "<feature> variants - iPhone 12" \
    docs/mockups/<feature>-variant-*-iphone12*.png
  ~/.claude/scripts/telegram-send-media.sh -d -m "<feature> variants - iPhone 14 Pro" \
    docs/mockups/<feature>-variant-*-iphone14pro*.png
  ~/.claude/scripts/telegram-send-media.sh -d -m "<feature> variants - desktop" \
    docs/mockups/<feature>-variant-*-desktop*.png
  ```
  Run the three sends as three separate Bash calls, never chained — see step 4's **Send rules**. If any album send still gets rejected, `telegram-send-media.sh` auto-falls-back to per-file sends so each file retries through `sendDocument` directly.
- **Commit/PR step:** `git add docs/mockups/<feature>-variant-*.{html,png}` catches all N HTMLs and 3N PNGs. Branch: `mockup/<feature>-variants`. Commit: `docs: add <feature> UI mockup variants`.

Single mode runs when step 0 decides `mode: single` — the plain single-file flow below, unchanged.

## Steps

### 0. Decide mode

Every caller — requirements-clarifier Phase 2b, `/patch` Step 2, `fix-advocate`'s tail, or the user directly — hands over the feature name and, when it has one, a change summary. Decide the mode from it before any design work:

- `mode: variants (3)` — a new screen, a new component, or a substantial layout change: anything where the user would want to compare directions before committing. Default count is 3, letters a/b/c.
- `mode: single` — a tweak to an existing surface (one component state, a reflow, a copy change with layout impact): one "after" design is enough.
- An explicit choice beats inference: a mode the caller passed in (`(mode: single)`), a Phase 1 scope summary the user already flipped, or the user's own words ("3 takes on…", "just one design").
- Ambiguous — the summary could read either way, or there is none — ask one question ("variants or single?") and wait for the answer. Never default silently.

State the pick as the first line of the run, with a one-clause reason:

    mode: variants (3) — new screen
    mode: single — one component state changes

Variants mode changes the HTML, lint, screenshot, send and commit steps as listed under **Variants Mode** above. Single mode is the plain flow below.

### 1. Run mockup-designer agent

Invoke the **mockup-designer** agent with the feature/screen name. The agent will:
- Review the relevant feature spec in `FEATURE_PROMPTS.md`
- Review any PRD sections relevant to the screen
- Design a mobile-first UI consistent with the project's React/TS + Tailwind v4 design language

### 1b. Apply the frontend-design aesthetic skill

Before writing HTML, the mockup-designer agent must load `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/frontend-design/skills/frontend-design/SKILL.md` and apply its aesthetic guidance — commit to a bold direction, choose distinctive typography (no Inter/Roboto/Arial/Space Grotesk defaults), use color with intentional hierarchy, treat motion and spatial composition as first-class, build atmosphere instead of flat fills, and reject AI-slop defaults (purple-on-white, cookie-cutter cards, predictable layouts). See the agent's "Apply the frontend-design aesthetic skill (BEFORE writing HTML)" section for the full rules.

The project's `.claude/design-tokens.md` palette is still the hard constraint (`lint-mockup.sh` blocks off-palette utilities); the aesthetic skill governs expression *within* that palette, not deviation from it.

### 2. Generate standalone HTML file

Write a single self-contained HTML file at:
```
docs/mockups/<feature-name>.html
```

Requirements:
- Load Tailwind CSS via CDN (`<script src="https://cdn.tailwindcss.com"></script>`)
- **Responsive desktop layout required** — see the **mockup-designer** agent's "Responsive Layout Requirements (REQUIRED)" section. Mobile-first base, with Tailwind `md:` / `lg:` reflows so the desktop screenshot (1280px) shows a true desktop layout (sidebar nav, multi-column grids, wider cards) — not the mobile DOM centered on a wide canvas.
- No external images — use placeholder divs with `bg-gray-200` or similar
- Match the Tailwind v4 design conventions used in the frontend
- Include `<meta name="viewport" content="width=device-width, initial-scale=1">` for correct mobile rendering
- Must be fully self-contained (no separate CSS or JS files)

### 3. Capture screenshots

Run the screenshot tool:
```
node ~/projects/generate-mockup.js docs/mockups/<feature-name>.html
```

This captures three viewports (per `~/projects/generate-mockup.js`):
- **iPhone 12** at 390px → `docs/mockups/<feature-name>-iphone12.png`
- **iPhone 14 Pro** at 393px → `docs/mockups/<feature-name>-iphone14pro.png`
- **Desktop** at 1280px → `docs/mockups/<feature-name>-desktop.png`

If a viewport's rendered page is too tall for Telegram's 20:1 photo-aspect cap (common when a mockup stacks many screens vertically), the tool slices the capture into `<feature-name>-{viewport}-part-{N}.png` chunks. Use a `-{viewport}*.png` glob (not `-{viewport}.png`) when sending to telegram to catch the chunks.

### 4. Send screenshots to telegram (auto-suppressed in IDE sessions)

After screenshots are captured, ship them to the bound telegram chat as a document album so they're previewable inline without leaving the conversation. Pass `-d` so files upload via `sendDocument` — `sendPhoto` would JPEG-re-encode and downscale to ~1280px wide, blurring the dense text and chrome in mockup screenshots:

```bash
~/.claude/scripts/telegram-send-media.sh -d \
  -m "<feature-name> mockup" \
  docs/mockups/<feature-name>-*.png
```

The helper auto-derives the chat from `OPENCLAW_CHAT_ID` (or the cwd) and exits 0 silently if no chat is bound (IDE sessions). Always call it — no conditional needed. The PR link in step 5 still goes out, so this augments rather than replaces the existing reply.

**Send rules (worktree sessions).** In a worktree-isolated session, Claude Code refuses any Bash command it can't verify stays off git — chaining a send with other commands (`;`, `&&`, `| tail`, `echo rc=$?`) gets the whole send refused. So:
- Run each `telegram-send-media.sh` call as **its own plain Bash call** — nothing before or after it in the same command. Check the result from the tool's exit status, not an appended `echo`.
- Keep captions plain ASCII (`-` not `—`).
- Send before any branch switch. To re-send after the session has left the mockup branch (the PNGs are gone from disk), copy them out first with `git show mockup/<feature-name>:docs/mockups/<file>.png > /tmp/<file>.png` and send the `/tmp` copies.

### 5. Commit, PR, and present

Automatically commit the HTML file and screenshots, create a PR, and present the link. Do NOT prompt the user about any of these steps — just do them.

```bash
git checkout -b mockup/<feature-name>
git add docs/mockups/<feature-name>.html docs/mockups/<feature-name>-*.png
git commit -m "docs: add <feature-name> UI mockup and screenshots"
git push -u origin mockup/<feature-name>
gh pr create --title "Mockup: <feature-name>" --body "UI mockup for <feature-name>. Review the screenshots below."
```

**Final chat reply: one line, no recap.** The HTML, screenshots, and PR
description ARE the description — don't re-narrate what the mockup looks
like, what design choices were made, or which tokens were used. Pattern:

    shipped mockup-<feature-name> · PR #<N> · album: <telegram-album-link-or-"sent above">

The PR body, the screenshots already sent to telegram in step 4, and the
HTML file on disk carry the full artifact. The user reviews via the PR
and replies "approve" or describes changes — no prompt template needed.

If asked to expand: the structured multi-line block (PR URL + each PNG
path + "Does this look right?" prompt) is **opt-in only** — emit it only
if the user asks for "the full paths" or "expand". Don't lead with it.
For reference, the opt-in shape:

```
Mockup generated, committed, and PR created:
  PR:        <pr-url>
  HTML:      docs/mockups/<feature-name>.html
  iPhone 12: docs/mockups/<feature-name>-iphone12.png
  iPhone 14: docs/mockups/<feature-name>-iphone14pro.png
  Desktop:   docs/mockups/<feature-name>-desktop.png

Does this look right? Approve to proceed to implementation, or describe changes needed.
```

### 6. Refine (loop until approved)

The PR from step 5 is the review surface. Read each user reply as one of four things:

- **Pick plus notes** ("B, tighten the header", "the second one but darker", "A's header on B's layout") → `refine <letter>`: one refined design written over that letter's files (`<feature>-variant-<letter>.html` and its PNGs; in single mode, `<feature>.html`). Re-run steps 1b-4 for that file only. A merge of two variants is a refine of the letter whose layout wins.
- **More takes on a letter** ("more takes on B", "3 more variants of A", "riff on C") → `variants-of <letter>`: a fresh a/b/c derived from that letter, written over the previous round's a/b/c files — the previous round is replaced, not kept. Re-run steps 1b-4 in variants mode.
- **Approval** — "approved", "approve", "go", "go ahead", "looks good", "ship it", "that's the one", or any reply that clearly says the current design is fine → finalize (below).
- **Anything else** — a letter that doesn't exist ("D" when there are a/b/c), a reply that could be a pick or a new direction, a question → answer it or ask one question; change no files.

Every refine or variants-of round commits to the **same mockup branch** and pushes; never open a second PR. Re-send the album(s) per step 4 so the new round is reviewable in place. Keep going until approval.

**Finalize (on approval).** Run the helper — it renames the approved letter to the plain feature name, deletes every other variant file, commits only those paths and pushes on the current branch:

    ~/.claude/scripts/mockup-finalize.sh <feature> <letter>

In single mode (no `<feature>-variant-*` files) it is a no-op and exits 0. If no mockup exists yet for the feature, say so and finalize nothing. Afterwards `docs/mockups/<feature>.html` (+ `<feature>-{iphone12,iphone14pro,desktop}[-part-N].png`) is the spec — the path requirements-clarifier Phases 3-5, `/patch` Step 3c and FEATURE_PROMPTS entries cite. Close with one line:

    approved <feature> (variant <letter>) · docs/mockups/<feature>.html · PR #<N>

## Notes
- This skill is BLOCKING for visual UI changes — do not proceed to test-creator or feature-creator until the user approves the mockup (step 6 finalize has run).
- Only the approved design survives: after finalize, `docs/mockups/` holds `<feature>.html` + its PNGs and no `<feature>-variant-*` files.
- Always auto-commit, auto-PR, and send the PR link. Never prompt about committing or PR creation.
- Match Tailwind v4 conventions from the frontend codebase where possible.
- If the screenshot tool fails, note the error and ask the user to open the HTML file in a browser.
