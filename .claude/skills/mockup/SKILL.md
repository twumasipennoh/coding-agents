# /mockup - Generate UI Mockup

> **Pipeline announcements required.** This is a multi-step pipeline. Announce steps via `~/.claude/scripts/pipeline-step.sh` per the rule in `~/.claude/CLAUDE.md § "Pipeline step announcements"`. Use pipeline-id `mockup`, display name `Mockup`. Call `begin mockup "Mockup" --total 6` at kickoff, `start`/`done`/`fail`/`skip` around each non-interactive step below, and `end mockup --status ok|fail` on completion. Skip interactive steps (user gates, clarification phases) — they self-announce. **Final output ordering (critical):** call `end` *before* emitting your final user-facing response. Your last message must be the deliverable itself (summary, report, PR link, etc.) with **no tool calls after it** — `--output-format json` returns only the final turn's text, so any deliverable emitted before a subsequent tool call is silently dropped.

Run the **mockup-designer** agent to generate a standalone HTML mockup with Tailwind CSS v4, then capture screenshots at mobile and desktop widths.

## Usage

```
/mockup <feature or screen name>
```

If no name is given, ask the user which feature or screen to mockup.

## Variants Mode

If the user asks for multiple variants, options, versions, or alternatives ("3 takes on...", "compare A/B for...", "show me variants of..."), the agent produces N separate HTML files instead of one composite, and the skill sends THREE separate telegram albums (one per viewport) so each form factor compares at full resolution.

### Step overrides in variants mode

- **HTML step:** `mockup-designer` writes `docs/mockups/<feature>-variant-{a,b,c,…}.html` (one file per variant, lowercase letters in order). See the agent's "Variants Mode" section for content requirements.
- **Lint step (if this skill defines one):** Run `lint-mockup.sh` **once per variant file**. Any blocking failure in any variant blocks the whole batch.
- **Screenshot step:** Run `generate-mockup.js` once per variant HTML. Produces `<feature>-variant-{a,b,c}-{iphone12,iphone14pro,desktop}.png` (N × 3 PNGs total). When a viewport's rendered page exceeds Telegram's 20:1 photo-aspect cap, the tool auto-slices into `<feature>-variant-{letter}-{viewport}-part-{N}.png` chunks so each chunk fits the cap and album sends succeed.
- **Telegram step:** Send THREE albums instead of one — one per viewport — so each form factor tiles cleanly. The globs use `*` after the viewport name so they catch any auto-sliced `-part-N.png` chunks the screenshot tool produced:
  ```bash
  ~/.claude/scripts/telegram-send-media.sh -m "<feature> variants — iPhone 12" \
    docs/mockups/<feature>-variant-*-iphone12*.png
  ~/.claude/scripts/telegram-send-media.sh -m "<feature> variants — iPhone 14 Pro" \
    docs/mockups/<feature>-variant-*-iphone14pro*.png
  ~/.claude/scripts/telegram-send-media.sh -m "<feature> variants — desktop" \
    docs/mockups/<feature>-variant-*-desktop*.png
  ```
  If any album send still gets rejected, `telegram-send-media.sh` auto-falls-back to per-file sends so each photo retries via the `sendPhoto → sendDocument` chain.
- **Commit/PR step:** `git add docs/mockups/<feature>-variant-*.{html,png}` catches all N HTMLs and 3N PNGs. Branch: `mockup/<feature>-variants`. Commit: `docs: add <feature> UI mockup variants`.

Single-mockup mode (one design, no variants) is unchanged — keep the existing single-file flow.

## Steps

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

After screenshots are captured, ship them to the bound telegram chat as an album so they're previewable inline without leaving the conversation:

```bash
~/.claude/scripts/telegram-send-media.sh \
  -m "<feature-name> mockup" \
  docs/mockups/<feature-name>-*.png
```

The helper auto-derives the chat from `OPENCLAW_CHAT_ID` (or the cwd) and exits 0 silently if no chat is bound (IDE sessions). Always call it — no conditional needed. The PR link in step 5 still goes out, so this augments rather than replaces the existing reply.

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

The structured multi-line block (PR URL + each PNG path + "Does this
look right?" prompt) is **opt-in only** — emit it only if the user asks
for "the full paths" or "expand". Don't lead with it. For reference,
the opt-in shape:

```
Mockup generated, committed, and PR created:
  PR:      <pr-url>
  HTML:      docs/mockups/<feature-name>.html
  iPhone 12: docs/mockups/<feature-name>-iphone12.png
  iPhone 14: docs/mockups/<feature-name>-iphone14pro.png
  Desktop:   docs/mockups/<feature-name>-desktop.png

Does this look right? Approve to proceed to implementation, or describe changes needed.
```

## Notes
- Default final reply is one line. Multi-line PR-and-paths block is opt-in only.
- This skill is BLOCKING for visual UI changes — do not proceed to test-creator or feature-creator until the user approves the mockup.
- Always auto-commit, auto-PR, and send the PR link. Never prompt about committing or PR creation.
- Match Tailwind v4 conventions from the frontend codebase where possible.
- If the screenshot tool fails, note the error and ask the user to open the HTML file in a browser.
