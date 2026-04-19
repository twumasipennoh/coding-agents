# /mockup - Generate UI Mockup

Run the **mockup-designer** agent to generate a standalone HTML mockup with Tailwind CSS, then capture screenshots at mobile and desktop widths.

## Usage

```
/mockup <feature or screen name>
```

If no name is given, ask the user which feature or screen to mockup.

## Steps

### 1. Run mockup-designer agent

Invoke the **mockup-designer** agent with the feature/screen name. The agent will:
- Review the relevant feature spec or PRD section
- Design the screen UI

### 2. Generate standalone HTML file

Write a single self-contained HTML file at:
```
docs/mockups/<feature-name>.html
```

Requirements:
- Load Tailwind CSS via CDN (`<script src="https://cdn.tailwindcss.com"></script>`)
- No external images — use placeholder divs with `bg-gray-200` or similar
- Include `<meta name="viewport" content="width=device-width, initial-scale=1">` for correct mobile rendering
- Must be fully self-contained (no separate CSS or JS files)

### 3. Capture screenshots

Run the screenshot tool:
```
node ~/projects/generate-mockup.js docs/mockups/<feature-name>.html
```

This captures:
- **Mobile** at 375px width → `docs/mockups/<feature-name>-mobile.png`
- **Desktop** at 1440px width → `docs/mockups/<feature-name>-desktop.png`

### 4. Commit, PR, and present

Automatically commit the HTML file and screenshots, create a PR, and present the link. Do NOT prompt the user about any of these steps — just do them.

```bash
git checkout -b mockup/<feature-name>
git add docs/mockups/<feature-name>.html docs/mockups/<feature-name>-mobile.png docs/mockups/<feature-name>-desktop.png
git commit -m "docs: add <feature-name> UI mockup and screenshots"
git push -u origin mockup/<feature-name>
gh pr create --title "Mockup: <feature-name>" --body "UI mockup for <feature-name>. Review the screenshots below."
```

Then present the PR link and screenshot paths to the user for visual go/no-go:

```
Mockup generated, committed, and PR created:
  PR:      <pr-url>
  HTML:    docs/mockups/<feature-name>.html
  Mobile:  docs/mockups/<feature-name>-mobile.png
  Desktop: docs/mockups/<feature-name>-desktop.png

Does this look right? Approve to proceed to implementation, or describe changes needed.
```

## Notes
- This skill is BLOCKING for visual UI changes — do not proceed to implementation until the user approves.
- Always auto-commit, auto-PR, and send the PR link. Never prompt about committing or PR creation.
- If the screenshot tool fails, note the error and ask the user to open the HTML file in a browser.
