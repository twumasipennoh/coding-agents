---
name: fact-check
description: >-
  Adversarial reviewer and architectural hole-poker. Audits technical proposals,
  bug write-ups, PR descriptions, docs, and LLM suggestions against ground-truth
  source code using a composite panel of stakeholder lenses (tech lead, on-call,
  platform, security, agent-reader). Iteratively stress-tests revisions until LGTM.
---

# /fact-check — Adversarial Reviewer & Architectural Hole-Poker

The user invokes `/fact-check` (or says "fact-check this", "poke holes in this", "audit these claims", "verify my suggestions", "review my plan") to have technical statements, hypotheses, bug descriptions, and architectural proposals checked against ground-truth source code and runtime reality.

`/polish` also runs this skill in a fresh subagent during its structure pass — see **Subagent mode** below.

## Usage

```
/fact-check [file path, PR number, or pasted text]
```

- `/fact-check` — audit the most recent proposal or claim set in the conversation.
- `/fact-check docs/PRD.md` — audit a file.
- `/fact-check #123` — audit a PR description (`gh pr view 123`).

---

## 1. Philosophy & ground-truth hierarchy

Every technical claim, LLM suggestion, and author proposal is an **unverified hypothesis** until it's proven or disproven against runtime reality.

**Ground-truth hierarchy:**

1. **Tier 1 — Source code & configs.** Executable reality: source files, `firebase.json`, `firestore.rules`, `package.json`, workflow YAML, env templates, scripts. Search the current repo first, then `~/projects` (Grep tool, never from `/`; skip `node_modules` and `.claude/worktrees`).
2. **Tier 2 — Documentation.** README, `docs/DECISIONS.md`, PRDs, `FEATURE_PROMPTS.md`. Architectural intent, not proof.
3. **Tier 3 — Narratives.** Issue text, PR descriptions, code comments, commit messages, AI summaries. Treated as hypotheses that need Tier 1 or Tier 2 backing.

**Secrets stay out.** Never open or quote `.env*`, `*.pem`, service-account JSON, or anything under `~/.gcp`, `~/.ssh`, or a `credentials` directory. If a claim hinges on a secret's value, cite the file path and variable name only.

**Secrets stay closed.** Never open or quote `.env` files, service-account keys, credential stores, or token files while gathering evidence. When a claim hinges on a secret's value, check the code that reads it (variable name, loading path), not the value itself.

**Invariant:** code overrides documentation. When a doc contradicts the code, flag the doc as stale.

**No fabrication.** If a claim can't be checked (the code isn't on this machine, it depends on live production state, it needs a credential you don't have), mark it ⚠️ Vulnerable with "unverifiable here: <why>". Never mark something ✅ Verified without a citation you actually read this turn.

---

## 2. Personas & composite review panel

Proposals are evaluated through a **composite review panel** of stakeholder lenses. This list is canonical — other skills cite it, they don't restate it.

- **tech lead** (`TL`): system invariants, race conditions, architectural debt, non-goals, backward compatibility.
- **on-call** (`ONCALL`): blast radius, what breaks at 3am, first-click working links, log and alert fidelity, safe rollback.
- **platform** (`PLATFORM`): external platform lifecycles and limits — Firebase/GCP quotas and cold starts, chat-bot API rate limits, Anthropic API rate limits and timeouts, third-party API failure modes.
- **security** (`SEC`): least privilege, secret hygiene, token expiry, auth boundaries, input trust.
- **agent-reader** (`AGENT`): could an agent act on this text without guessing — are paths, commands, and acceptance criteria concrete?

Apply only the lenses that bite on the target. If it's genuinely unclear which apply, ask one multiple-choice question before starting.

---

## 3. Audit procedure

1. Extract every checkable claim from the target (behavior claims, root-cause hypotheses, "X calls Y", "this is safe because", numbers, limits, file/function references).
2. For each claim, search Tier 1 first. Read the actual code, quote it, cite `file:line`.
3. Classify: ❌ **Disproved** (code contradicts it), ⚠️ **Vulnerable** (unbacked, partially true, or missing a failure mode), ✅ **Verified** (code confirms it, cited).
4. Tag each non-verified item with the lens that found the hole.

---

## 4. Output format & paced Socratic iteration

### Turn 1: executive verdict + drill-down 1 (no redundant summary block)

```markdown
### High-level verdict: [X] grounded, [Y] vulnerable
- **Item 1 ([topic])**: ❌ Disproved / ⚠️ Vulnerable / ✅ Verified — [one-sentence verdict, lens-tagged]
- **Item 2 ([topic])**: ...

---

### Drill-down 1 of [N]: [topic / claim title]

> "[quoted claim or proposal from the target]"

#### ❌ The hole in this claim [lens]
[Why this claim fails in real life — the tool/script that won't work, the failure mode that was overlooked.]

#### ✅ What the code actually does
[Exact code or config reality with `file:line`, quoting the actual behavior.]

#### 🛠 Grounded alternative
[The concrete, verified fix or architectural alternative.]

#### 🎯 Stress-test question
[One load-bearing question challenging the author on how they'll handle this edge case or boundary.]
```

Drill-downs are ordered worst-first (❌ before ⚠️). ✅ items get no drill-down.

### Passes 2..N: iterative stress-testing loop

- **Continuous critique.** When the author replies with a revision or counter-proposal to the current drill-down, audit the revision against the code, challenge remaining holes under the relevant lenses, and ask for the next refinement.
- **Next item.** Once an item is resolved, advance to the next drill-down (`### Drill-down 2 of N`) in the same format.
- **Termination (LGTM).** When every item has been defended and no unbacked assumptions remain, end the loop with:

  ```markdown
  ✅ **LGTM: no obvious architectural flaws or unbacked assumptions remaining.**
  ```

- **Accept-risk override.** If the user says "accept risk" or "proceed anyway", record the accepted trade-off in one line and end the loop (or move to the next item if they scoped it to one).
- **Escape hatch.** If the user says "dump all", "all at once", or "batch them", emit every remaining drill-down in a single turn.

---

## 5. Subagent mode

When spawned by another skill (the prompt says "run its subagent mode"), there is no user to iterate with. Do the full audit (sections 1–3), then return **everything in one response** in this fixed structure, so the caller can relay it:

```markdown
VERDICT: [X] grounded, [Y] vulnerable, [Z] disproved

ITEMS:
- [n]. [status emoji] [topic] — [one-sentence verdict] — lens: [TL|ONCALL|PLATFORM|SEC|AGENT] — cite: [file:line or "unverifiable here: <why>"]

DRILL-DOWNS:
#### [n]. [topic]
Claim: "[quote]"
Hole: [...]
Code: [file:line + quote]
Alternative: [...]
Question: [one stress-test question]
```

Don't ask questions, don't wait, don't edit any file. The caller owns the conversation.
