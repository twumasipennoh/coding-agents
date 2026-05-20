# /design-check - Frontend Design Audit

> **Pipeline announcements required.** This is a multi-step pipeline. Announce steps via `~/.claude/scripts/pipeline-step.sh` per the rule in `~/.claude/CLAUDE.md § "Pipeline step announcements"`. Use pipeline-id `design-check`, display name `Design Check`. Call `begin design-check "Design Check" --total 7` at kickoff, `start`/`done`/`fail`/`skip` around each non-interactive step below, and `end design-check --status ok|fail` on completion. Skip interactive steps (user gates, clarification phases) — they self-announce. **Final output ordering (critical):** call `end` *before* emitting your final user-facing response. Your last message must be the deliverable itself (summary, report, PR link, etc.) with **no tool calls after it** — `--output-format json` returns only the final turn's text, so any deliverable emitted before a subsequent tool call is silently dropped.

Standalone design quality audit. Delegates to the `frontend-design-reviewer` agent for detailed analysis.

## Steps

### 1. Design Token Usage
- Find the project's design tokens (CSS variables, Tailwind theme, style constants).
- Search for hardcoded color values (`#hex`, `rgb()`, `hsl()`) that bypass tokens.
- Search for hardcoded spacing values that bypass the spacing scale.
- Flag any bypasses with file path and line number.

### 2. Accessibility Scan
- Search for interactive elements missing ARIA attributes (custom buttons, toggles, modals).
- Search for forms missing associated labels.
- Search for images missing `alt` attributes.
- Search for click/tap handlers without keyboard equivalents (`onClick` without `onKeyDown`).
- Check heading hierarchy (no skipped levels, single `h1` per page).

### 3. Responsive Design Check
- Search for fixed pixel widths that may break on small screens.
- Verify breakpoint coverage across components.
- Check for viewport meta tag configuration.

### 4. Device & Viewport Check
- Search for `vh` usage that should be `dvh`/`svh` on full-screen layouts.
- Check for missing safe-area insets on full-screen or edge-to-edge layouts.
- Verify `viewport-fit=cover` in meta tag.
- Check screen size coverage (320px through 1440px+).

### 5. UX State Coverage
- Search for async operations (fetch, API calls) without loading UI.
- Search for list/collection renders without empty state handling.
- Search for forms without disabled submit state during submission.

### 6. Touch Target Check
- Search for buttons, links, and interactive elements with dimensions below 44x44px.
- Flag cramped interactive elements without adequate spacing.

### 7. Motion Safety
- Search for CSS animations and transitions without `prefers-reduced-motion` media query.

## Output Format

```
Design Audit Results:

Token Usage:      pass or X issues
Accessibility:    pass or X issues
Responsive:       pass or X issues
Device/Viewport:  pass or X issues
UX States:        pass or X issues
Touch Targets:    pass or X issues
Motion Safety:    pass or X issues
```

List details for any issues found.

## Notes
- This is a static analysis scan, not a visual regression test.
- Delegates to the `frontend-design-reviewer` agent for the detailed checklist review.
- False positives in test files are expected — note them but don't flag as critical.
- For generating fixes or new UI that meets high design standards, use the `frontend-design` plugin (`~/.claude/plugins/.../frontend-design`) — it ensures distinctive, production-grade aesthetics and avoids generic AI patterns.
