---
name: explain
description: Re-explain the previous assistant message (or an optional quoted snippet), recalibrated to the user's actual level using their auto-memory profile. Updates memory and the global calibration file (~/.claude/calibration.md) so future replies are better calibrated without needing /explain again.
---

# /explain — Recalibrate to the user's level

The user invokes `/explain` (or says natural-language equivalents like "explain in simpler terms," "in plain English," "what does that mean," "ELI5," "dumb this down," "I don't follow," "wait, what?") when a prior reply was pitched above their level.

**The skill is a correction, not just a rewrite.** Every invocation is a signal that calibration failed for a topic, so the skill must update memory AND the global calibration file (`~/.claude/calibration.md`) so it doesn't fail the same way again.

## Usage

```
/explain [optional quoted phrase or topic]
```

- `/explain` — recalibrate the most recent assistant message.
- `/explain "post-money valuation cap"` — recalibrate just that phrase (plus minimal surrounding context if needed for sense).

## Turn ordering — read this before anything else

This skill almost always runs inside an openclaw session, where the gateway runs Claude CLI with `--output-format json` and **returns only the final assistant turn's text to telegram**. Any tool call emitted *after* a text block creates a new turn boundary; prior text in earlier turns is silently dropped.

The naturally-tempting ordering — write the rewrite, then update memory, then write the confirmation — produces exactly three turns. Only the confirmation reaches the user. The rewrite (the actual deliverable) is dropped. This has been the recurring failure mode every time /explain has shipped only a "Updated my notes on X…" line. See CLAUDE.md "Final output ordering."

**The required ordering is:**

1. Do all **reads** (consult profile: MEMORY.md, relevant memory files, `calibration.md`).
2. Do all **writes** (Edit/Write the topic memory file, optionally Edit MEMORY.md, AND cedit_edit/cedit_write the calibration file).
3. **Then** emit the rewrite + confirmation **together as the final assistant turn**, with no tool calls after them.

The rewrite and confirmation must be in the same final assistant message. Do not emit any user-facing text before all memory tool calls have completed. If you have already emitted the rewrite as text and then catch yourself about to call Edit/Write on a memory file, stop — that order is the failure. Restart by doing the memory write first, then re-emitting the rewrite + confirmation together as the final turn.

## Steps

1. **Identify what to recalibrate.**
   - If an arg was provided, focus only on that phrase or topic.
   - Otherwise, take the previous assistant message as the target.
   - If there is no previous assistant message (this is the first turn), do not fabricate a rewrite. Respond: "Nothing to recalibrate yet — share what you want explained, or invoke me after my next reply." Stop here.
   - If the previous reply is already plain (a one-line answer, no jargon, no abstract concepts), do not rewrite noise. Ask: "What part was unclear?" and stop. Do NOT update memory in this case — there is no calibration signal yet.

2. **Identify the topic** (one to three words: "OAuth," "SAFE valuation caps," "Kubernetes networking," "Rust lifetimes"). You will use this to find or create the right memory file.

3. **Consult the user's profile.** Read `calibration.md` (in the project's `.claude/` or the global at `~/.claude/calibration.md`) for a quick-lookup entry on the topic — if one exists, honor its **Right approach** immediately. Also read `MEMORY.md` and any `user_*` / `feedback_*` memory files relevant to the topic for deeper context (e.g., `user_investing_experience.md` says "explain jargon from first principles with numeric scenarios" — that lens applies to any finance topic).

4. **Draft the rewrite internally — do NOT emit it yet.** Use plain language, concrete examples, and analogies grounded in things the user is already known to understand (from their user memories). Don't restate the original — produce a fresh explanation. Match the existing memory's preferred lens if one is recorded. Hold this draft in your working context; it will be emitted in step 6 as part of the final turn.

5. **Update memory now, before any text is emitted — the load-bearing step.** This is what makes the skill compound over time, and doing it here (not after the rewrite) is what keeps the rewrite from being dropped by the gateway. See "Turn ordering" above.
   - Look for an existing `user_*` or `feedback_*` memory file that covers this topic. If one exists, **update it** with the new calibration cue (what level worked, what didn't, the lens that landed).
   - If no relevant memory exists, **create a new one**. Use the auto-memory format (frontmatter with name/description/type, body covering the calibration signal). For a knowledge-level note, use `type: user`. For a "how to explain this to me" rule, use `type: feedback` with **Why:** and **How to apply:** lines.
   - If you create a new file, add a one-line pointer to `MEMORY.md`. If you only updated an existing file, do NOT add a duplicate pointer.
   - **Never** create a generic file like `user_explain_log.md` or `feedback_calibration.md` that accumulates everything. Memory must stay semantically organized by topic, per the auto-memory rules.
   - **Auto-promote to global calibration file.** After updating memory, also update `~/.claude/calibration.md` — the cross-project calibration lookup that syncs to all projects via `sync-agents.sh`. Read the file, find the `### <Topic>` heading that matches this topic (if any), and update its bullets. If no entry exists, append a new one:
     ```
     ### <Topic Name>
     - **Wrong pitch**: <what failed — jargon, abstractions, format>
     - **Right approach**: <what works — lens, examples, mental models>
     - **Learned**: <YYYY-MM> — <one-line context>
     ```
     Use `cedit_edit` for updates to existing entries, `cedit_write` for a full rewrite if appending. This step is mandatory — the memory file has detailed context, the calibration file has the actionable lookup entry. If you judge the calibration to be project-specific (not universal), write to `<project>/.claude/calibration-local.md` instead; otherwise always write to the global.
   - **Capture the rewrite as a voice exemplar (positive signal), gated by show-before-save.** Memory + calibration record the *rule that failed*; the exemplar records a *kept reply to imitate* — the positive half of the loop, per `~/.claude/references/voice-examples/README.md`. If this rewrite is a reusable target for its shape (bug-diagnosis, before/after, explainer), append it to the matching `~/.claude/references/voice-examples/<shape>.md` per that file's entry format, **channel-tagged** (telegram / claude-code-cli / pr-body / commit-msg). Explicit path: if kwaku supplied the exact wording he wanted, capture that verbatim. Lazy path: the rewrite you are about to emit is a *provisional* exemplar until it survives a second use without a re-flag. Show-before-save: mention the save in the confirmation so kwaku can veto it; skip the corpus write for a one-off with no reusable shape.
   - **Capture the invocation's directive (lens/shape signal).** If the `/explain` arg named *how* to frame the rewrite ("before and after", "from a system perspective", "with scenarios"), log it: `bash ~/.claude/scripts/log-directive.sh lens "<directive>" --shape <shape> --channel <channel> --source explain`. A `lens` directive routes to `calibration.md` (step 5's calibration write already handles the content); logging it here is what lets a recurring lens graduate. If the helper prints `PROMOTE`, the lens has recurred to threshold — make sure the `calibration.md` entry for that shape LEADS with it, so it's the default frame, not an occasional one.

6. **Emit the rewrite + confirmation together as the final assistant turn.** The rewrite from step 4 is the primary deliverable; the confirmation is a one-line postscript proving the memory write happened. Both go in the **same** final assistant message, with **no tool calls after**. Confirmation examples:
   - "Updated my notes on SAFE caps and the calibration file — I'll lead with a dollar example next time."
   - "Added a new memory on OAuth and a calibration entry — recorded that flow diagrams land better than RFC terminology."

   **The rewrite is the visible output of this skill.** If your final turn contains only the confirmation and not the rewrite itself, the skill has failed — that is the exact failure shape this skill's turn-ordering rule exists to prevent.

## When to skip the memory + calibration update

- The previous reply was already simple and the user only wanted clarification on one specific term (rare — usually still a signal).
- The user explicitly said something like "no, I get it, I just want it rephrased for someone else" — in that case the calibration isn't about them, so don't write a memory or calibration entry.
- Otherwise: always update both memory and calibration. Silent invocations are wasted signal.

## Natural-language triggers

This skill must also activate when the user uses any of these phrasings, *even without* the `/explain` slash command:

- "explain in simpler terms" / "simpler terms"
- "in plain English"
- "what does that mean" / "what do you mean"
- "ELI5" / "like I'm 5"
- "dumb this down" / "dumb it down"
- "I don't follow" / "I'm lost"
- "wait, what?"
- "break that down"
- And similar phrasings that signal "you were pitched above me."

When you recognize one of these phrasings in a user message, run the full skill (recalibrate + memory update + one-line confirmation), the same as if `/explain` had been invoked explicitly. Note: a question like "what does X mean?" where X is one specific term may be a literal definition request rather than a recalibration ask — use judgment. If the user has just been given a jargon-heavy reply, treat it as recalibration.

## What NOT to do

- **Don't ship only the memory-update confirmation.** The recalibrated rewrite is the deliverable; the confirmation is a postscript. A reply that says "Updated my notes on X — I'll lead with Y next time" and then moves on to other questions is the failure mode kwaku has flagged repeatedly. If your reply does not contain the rewrite, you have not run the skill. The single most common cause is wrong turn ordering — see "Turn ordering" at the top.
- **Don't emit the rewrite before doing the memory write.** Even if it's tempting to "show progress" by writing the rewrite first and updating memory after, that ordering causes the gateway to drop the rewrite. Memory writes happen first; rewrite + confirmation go in the final turn together.
- Don't dumb down condescendingly. The user is technically fluent in many areas (software, GCP, Firebase, deploys). The miscalibration is usually domain-specific (finance, OAuth, ML, etc.) — recalibrate the topic, not the person.
- Don't write generic "user wants simpler explanations" memories. Calibration is per-topic.
- Don't skip the memory update because the recalibration "felt easy." Every invocation is a data point.
- Don't create a new memory file when an existing one already covers the topic — update in place.
- Don't add anything to `MEMORY.md` when only updating an existing memory.
- Don't fabricate a rewrite when there's nothing to recalibrate (first-turn case).

## Inline case — `/explain` as one of several items in a multi-part message

kwaku often replies with a numbered list answering several open questions at once, e.g.:

```
1. I think just idle timeout
2. /explain What do you mean?
3. I think 3 is good
4. I think continue semantics works
5. Do we really need this?
```

When `/explain` (or a natural-language equivalent) appears as one bullet among several, it is **NOT** demoted to a quick acknowledgment. Run the full skill for that bullet: identify the target, consult memory, produce the rewrite, update memory, confirm. Then address the remaining bullets.

The recalibrated rewrite must appear in the reply — labeling it clearly is fine (e.g. `**Re: item 2 —**` or `**On "What do you mean?":**`). If the reply contains the memory-update confirmation but no actual rewrite, the skill has not run. This is a known recurring failure mode (kwaku flagged it on 2026-05-18, and again on 2026-05-19) — do not repeat it. The turn-ordering rule at the top applies here too: all memory writes before any text, rewrite + confirmation together as the final turn. The multi-part reply (covering items 1, 3, 4, 5 alongside the /explain item) is the final turn — its composition must respect the same rule.

## Loop case — `/explain` after `/explain`

If the user invokes `/explain` again on a reply that was *itself* produced by `/explain`, go simpler still: shorter sentences, more concrete analogies, smaller conceptual chunks. Update the relevant memory to reflect "needs even simpler than initial calibration suggested" so the bar shifts permanently.
