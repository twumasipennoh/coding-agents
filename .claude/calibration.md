# Calibration Lessons

Persistent record of how to pitch explanations for specific topics.
Written automatically by `/explain` on calibration misses; synced to
all projects via `sync-agents.sh`. Per-project additions go in
`<project>/.claude/calibration-local.md` (never synced).

Edit the global at `~/.claude/calibration.md`; vendored copies are
clobbered on sync.

---

### Investing / Finance
- **Wrong pitch**: contract/legal jargon, abstract instrument mechanics (pro-rata, dilution, MFN, conversion)
- **Right approach**: first principles with concrete numeric scenarios — dollar amounts, percentages, who-wins-who-loses for each clause
- **Learned**: 2026-05 — reviewing a SAFE, /explain on valuation cap terminology

### Git branching / history
- **Wrong pitch**: SHA identifiers, "common ancestor," "squash-merged under a different SHA," merge-strategy names
- **Right approach**: scenario walkthrough — what does my local repo think? what does GitHub think? where did they split? what's the fix? Use the "two notebooks" mental model
- **Learned**: 2026-06 — /explain after SHA-heavy diverged-history reply

### Claude reply composition / tool mechanics
- **Wrong pitch**: "final assistant turn," "mid-turn," "MCP stdio server," "registered in mcpServers," "PreToolUse hook" — named abstractions without grounding
- **Right approach**: step-by-step scenario from each actor's view — Claude composes → openclaw sees → telegram gets. Name abstractions only after the scenario has landed
- **Learned**: 2026-05 — /explain on cedit replacement discussion and MCP registration options

### openclaw / aide internals
- **Wrong pitch**: code paths, scanner functions, store names, parser internals ("ScheduleScanner.tick," "parseStreamJsonOutput," "LLMUnavailableError")
- **Right approach**: open with the user-visible action or symptom, trace the chain in observable terms, THEN reference code paths. For tier/fallback systems, frame each tier as "what aide attempts on your behalf at this layer"
- **Learned**: 2026-05 — multiple /explain invocations across pipeline, reminder, tier-fallback, and diagnostic-capability discussions
