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
- **Learned**: 2026-06 — /explain after SHA-heavy diverged-history reply. Recurred 2026-06-23: branch cleanup plan used same jargon despite this entry existing

### Claude reply composition / tool mechanics
- **Wrong pitch**: "final assistant turn," "mid-turn," "MCP stdio server," "registered in mcpServers," "PreToolUse hook" — named abstractions without grounding
- **Right approach**: step-by-step scenario from each actor's view — Claude composes → openclaw sees → telegram gets. Name abstractions only after the scenario has landed
- **Learned**: 2026-05 — /explain on cedit replacement discussion and MCP registration options

### openclaw / aide internals
- **Wrong pitch**: code paths, scanner functions, store names, parser internals ("ScheduleScanner.tick," "parseStreamJsonOutput," "LLMUnavailableError"), Map lookups, field-level guard conditions, line numbers. Also: describing feature-completion benefits in build terms ("parser patterns + executeIntent cases, half a day") instead of what the user gains
- **Right approach**: open with the user-visible action or symptom, trace the chain in observable terms, THEN reference code paths. For tier/fallback systems, frame each tier as "what aide attempts on your behalf at this layer." For catalog/registry bugs, explain as "aide's directory had two entries with the same name, it grabbed the wrong one" not "entries.get() resolved the Smithery entry because !existing.transportKind was false." For "what does shipping X get me" questions AND bug-fix explanations, answer with scenarios: "you said X, aide did Y, here's why, here's what changes"
- **Learned**: 2026-05 — multiple /explain invocations across pipeline, reminder, tier-fallback, and diagnostic-capability discussions. 2026-06 — Gmail OAuth mount bug diagnosed with Map keys and cleanup guard conditions instead of user-journey trace. 2026-06 — patch benefit + catalog seed bug both explained in implementation terms instead of user-experience scenarios. 2026-06 — evaluation risk/mitigation pitched as abstract system concern ("auto-scope mapping incomplete") instead of user failure story. 2026-06 — integration-runner crash diagnosis pitched as "discoverFromDir throws IntegrationRegistryError when pickIntegrationExport returns null" instead of "aide's helper crashes on startup because it trips over a file it shouldn't be loading"

### Internal API design
- **Wrong pitch**: leading with the proposed API shape, type signatures, or implementation mechanics
- **Right approach**: lead with who calls the code and what they do with the return value, then frame changes as caller impact
- **Learned**: 2026-05 — feedback on internal-API change proposals

### Test / CI infrastructure
- **Wrong pitch**: describing helper APIs, test-runner internals, config object shapes
- **Right approach**: developer-experience walkthrough — "you add X, here's what tomorrow looks like" — show what changes for the person writing tests, not how the plumbing works
- **Learned**: 2026-05 — feedback on test-infra change explanations

### Design decisions / option presentation
- **Wrong pitch**: bundled numbered options that conflate independent choices ("Option 1: A+B+C, Option 2: A+D+E")
- **Right approach**: present each design axis as a separate choice point — let the user mix and match independently
- **Learned**: 2026-05 — feedback on multi-axis design proposals
