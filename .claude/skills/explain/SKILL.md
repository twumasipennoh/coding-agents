---
name: explain
description: Re-explain the previous assistant message (or an optional quoted snippet), recalibrated to the user's actual level using their auto-memory profile. Also updates memory so future replies are better calibrated without needing /explain again.
---

# /explain — Recalibrate to the user's level

The user invokes `/explain` (or says natural-language equivalents like "explain in simpler terms," "in plain English," "what does that mean," "ELI5," "dumb this down," "I don't follow," "wait, what?") when a prior reply was pitched above their level.

**The skill is a correction, not just a rewrite.** Every invocation is a signal that calibration failed for a topic, so the skill must update memory so it doesn't fail the same way again.

## Usage

```
/explain [optional quoted phrase or topic]
```

- `/explain` — recalibrate the most recent assistant message.
- `/explain "post-money valuation cap"` — recalibrate just that phrase (plus minimal surrounding context if needed for sense).

## Steps

1. **Identify what to recalibrate.**
   - If an arg was provided, focus only on that phrase or topic.
   - Otherwise, take the previous assistant message as the target.
   - If there is no previous assistant message (this is the first turn), do not fabricate a rewrite. Respond: "Nothing to recalibrate yet — share what you want explained, or invoke me after my next reply." Stop here.
   - If the previous reply is already plain (a one-line answer, no jargon, no abstract concepts), do not rewrite noise. Ask: "What part was unclear?" and stop. Do NOT update memory in this case — there is no calibration signal yet.

2. **Identify the topic** (one to three words: "OAuth," "SAFE valuation caps," "Kubernetes networking," "Rust lifetimes"). You will use this to find or create the right memory file.

3. **Consult the user's profile.** Read `MEMORY.md` and any `user_*` / `feedback_*` memory files relevant to the topic. Especially honor entries that name a calibration preference (e.g., `user_investing_experience.md` says "explain jargon from first principles with numeric scenarios" — that lens applies to any finance topic).

4. **Rewrite at the user's level.** Use plain language, concrete examples, and analogies grounded in things the user is already known to understand (from their user memories). Don't restate the original — produce a fresh explanation. Match the existing memory's preferred lens if one is recorded.

5. **Update memory — the load-bearing step.** This is what makes the skill compound over time.
   - Look for an existing `user_*` or `feedback_*` memory file that covers this topic. If one exists, **update it** with the new calibration cue (what level worked, what didn't, the lens that landed).
   - If no relevant memory exists, **create a new one**. Use the auto-memory format (frontmatter with name/description/type, body covering the calibration signal). For a knowledge-level note, use `type: user`. For a "how to explain this to me" rule, use `type: feedback` with **Why:** and **How to apply:** lines.
   - If you create a new file, add a one-line pointer to `MEMORY.md`. If you only updated an existing file, do NOT add a duplicate pointer.
   - **Never** create a generic file like `user_explain_log.md` or `feedback_calibration.md` that accumulates everything. Memory must stay semantically organized by topic, per the auto-memory rules.

6. **Confirm the side-effect in one short sentence at the end.** Examples:
   - "Updated my notes on SAFE caps — I'll lead with a dollar example next time."
   - "Added a new memory on OAuth — recorded that flow diagrams land better than RFC terminology."
   - This single line proves the memory write happened. Don't expand into a summary.

## When to skip the memory update

- The previous reply was already simple and the user only wanted clarification on one specific term (rare — usually still a signal).
- The user explicitly said something like "no, I get it, I just want it rephrased for someone else" — in that case the calibration isn't about them, so don't write a memory.
- Otherwise: always update memory. Silent invocations are wasted signal.

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

- Don't dumb down condescendingly. The user is technically fluent in many areas (software, GCP, Firebase, deploys). The miscalibration is usually domain-specific (finance, OAuth, ML, etc.) — recalibrate the topic, not the person.
- Don't write generic "user wants simpler explanations" memories. Calibration is per-topic.
- Don't skip the memory update because the recalibration "felt easy." Every invocation is a data point.
- Don't create a new memory file when an existing one already covers the topic — update in place.
- Don't add anything to `MEMORY.md` when only updating an existing memory.
- Don't fabricate a rewrite when there's nothing to recalibrate (first-turn case).

## Loop case — `/explain` after `/explain`

If the user invokes `/explain` again on a reply that was *itself* produced by `/explain`, go simpler still: shorter sentences, more concrete analogies, smaller conceptual chunks. Update the relevant memory to reflect "needs even simpler than initial calibration suggested" so the bar shifts permanently.
