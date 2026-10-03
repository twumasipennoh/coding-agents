---
name: polish
description: >-
  Iteratively polishes technical writing — docs (PRDs, DECISIONS.md and
  FEATURE_PROMPTS.md entries), PR descriptions, GitHub issue/bug write-ups, and
  READMEs — in the user's own voice. Default pass walks the text section by
  section, asks how the user would say it, learns their voice patterns, applies
  them to the rest, and saves them to a persistent voice profile. On request,
  runs a graded structure pass backed by an independent /fact-check subagent.
---

# /polish — Technical Writing Polisher in Your Voice

The user invokes `/polish` (or says "polish this", "polish this doc", "grade my doc", "review my PR description", "clean up this issue", "help me word this") to refine a piece of technical writing.

## Usage

```
/polish [file path, PR number, issue number, or pasted text] [structure]
```

- `/polish README.md` — voice pass on a file.
- `/polish #123` — voice pass on a PR description (`gh pr view 123`); edits go back via `gh pr edit` only after the user approves.
- `/polish docs/PRD.md structure` — graded structure pass.
- `/polish` — target the most recent draft in the conversation.

Never write changes to a file, PR, or issue without the user approving the final text.

---

## 1. Modes

Infer the mode from the target. If it's ambiguous, ask one multiple-choice question.

- **`doc`** — PRDs, `docs/DECISIONS.md` entries, `FEATURE_PROMPTS.md` entries, design notes. Checks problem/solution scoping, trade-offs, failure modes, non-goals, and how it'll be verified.
- **`pr`** — PR descriptions. Checks: what changed for the user, why, how it was tested, risk and rollback. Leads with the user-visible change, not the file list.
- **`issue`** — GitHub issue and bug write-ups. Two-paragraph pattern:
  - **Paragraph 1 — current reality and failure mode:** what the system does today, citing the file/function, and what breaks for whom.
  - **Paragraph 2 — fix and verification:** the proposed fix and the concrete check that proves it.
  - Target ~70–80 words, hard ceiling 90. Every sentence states a failure, a mechanism, or a verification step — no filler.
- **`readme`** — READMEs. Checks: what it is in one line, how to run it, copy-pasteable commands that actually work, no stale sections.

---

## 2. Default pass — the voice loop

Runs whenever the user hasn't asked for structure help.

1. **Load the voice profile.** Read `~/.claude/voice-profile.md`. If it doesn't exist, carry on with no profile — create it on first write (step 5). Use the `## <mode>` section for the current mode plus `## general`.
2. **Start at the first section.** Not a "key" sentence — the first section (or the first paragraph, if the text has no headings). Quote it, then ask how the user would say it. If the profile already has patterns for this mode, offer a short draft in that voice they can accept or rewrite. One question, nothing else.
3. **Extract patterns from the answer.** Compare the user's wording to the original and name what they did in one line: tone, sentence length, word choice, how they open a point, formatting habits, what they cut. Only record patterns the answer actually shows — don't infer a whole style from one sentence.
4. **Apply to the rest.** Rewrite the remaining sections using the extracted patterns plus the saved profile. Show the next section's rewrite and ask the user to confirm or reword it. Their rewording is another sample — repeat step 3.
5. **Save patterns.** After each extraction, append new patterns under `## <mode>` (or `## general` when they clearly apply across modes) in `~/.claude/voice-profile.md`. Create the file with a `# Voice profile` header if it's missing. Dedupe against what's already there; when a new sample contradicts an old pattern, replace the old one.
6. **Finish.** When every section is done (or the user says stop), present the full polished text once, then ask before writing it back to the file, PR, or issue.

Keep each turn to one section and one question.

---

## 3. Structure pass — graded scorecard

Runs when the user asks for structure, a grade, or a review.

1. **Independent fact-check (mandatory, first).** Spawn a fresh `general-purpose` subagent with the Agent tool. Give it the full target text and this instruction: "Read ~/.claude/skills/fact-check/SKILL.md and run its subagent mode against the text below." The subagent never sees any rewrite you've drafted — that independence is the point. Don't run the fact-check inline.
2. **Score.** Grade the text across seven dimensions. Present the scorecard as a bulleted list, not a table:

   ```markdown
   ### /polish structure pass
   **Target:** [file or context] · **Mode:** [doc | pr | issue | readme] · **Audience:** [who reads it]
   **Overall:** [grade] ([score]/100) [🟢 | 🟡 | 🔴]

   - **High-level design** — [A–F]: [is the architecture, invariant, or data flow clear before the weeds?]
   - **Decision clarity** — [A–F]: [are key trade-offs and forks stated and prominent?]
   - **Audience fit** — [A–F]: [calibrated to who reads it and how long they'll spend?]
   - **Concision** — [A–F]: [filler, zombie nouns, repeated points?]
   - **Voice & tone** — [A–F]: [matches the saved voice profile, active voice?]
   - **Visual structure** — [A–F]: [headings, scannability, code blocks?]
   - **Evidence rigor** — [A–F]: [anchored to the fact-check verdict]
   ```

3. **Priority action items.** Fact-check ❌ and ⚠️ items come first, each tagged with the lens the subagent reported (lens definitions live in `/fact-check`, not here). Then the lowest-graded dimensions, one concrete fix each.
4. **Relay questions.** The subagent's stress-test questions are relayed one per turn, worst item first. Audit each answer against the subagent's cited code; when all are answered, offer to run the voice loop on the revised text.

---

## 4. Pacing

- Default reply is the first beat only: in the voice loop, the first section and its question; in the structure pass, the scorecard plus the top action item.
- If the user says "all at once", "batch them", or "just dump it", deliver everything remaining in one turn.
