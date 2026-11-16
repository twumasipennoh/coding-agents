# Architectural Decisions

## DEC-001: Frontend UX Standards — 6 Mandatory Patterns (2026-03-24)
- **Context**: Cross-project audit of HabitTracker and Insem revealed 6 UX patterns that should be standard: skeleton loaders, tap feedback, floating toasts with undo, infinite scroll, responsive typography, and PWA support.
- **Decision**: Codified as mandatory standards in CLAUDE.md "FRONTEND UX STANDARDS". All new frontend work must follow. Existing features grandfathered but should adopt when modified.
- **Affects**: All frontend files, frontend-design-reviewer agent, pattern-enforcer agent.

## DEC-002: One central Firebase drift gate, run by /deploy (2026-11-16)
- **Context**: HabitTracker's index-drift check only ran from the Windows `deploy.ps1`, so Linux `/deploy` deploys never checked; MediaTracker's check also only ran from its Windows `deploy.ps1`; PlaylistModifier never had one. KaeMe's `check-firebase-drift.mjs` is the strongest existing checker (rules + storage + indexes + field overrides, judged against branch lineage).
- **Decision**: Adopt KaeMe's script as the single master in this repo (`scripts/check-firebase-drift.mjs`). `/deploy` runs it directly from `~/projects/coding-agents` before any Firestore upload for `kind: "firebase"` projects; KaeMe's npm hooks point at it too. Rejected: a global unversioned copy in `~/.claude/scripts` (no history for a deploy-blocking script), per-project copies (they drift, as Insem's and HabitTracker's index checkers already had), and syncing from KaeMe (couples every project to KaeMe's repo).
- **Tradeoffs**: deploys now depend on a sibling checkout, so a missing checkout blocks rather than skips. The check also covers security rules, not just indexes. Blocking turned on after a one-time read-only audit (2026-11-16): HabitTracker staging + prod and MediaTracker dev + prod had no drift, so nothing needed reconciling. **PlaylistModifier is pending**: its audit exited 3 (no `~/.gcp/playlist-modifier.json`), so its deploys stop at the gate until kwaku adds the key and its audit line passes.
- **Affects**: `~/.claude/skills/deploy/SKILL.md`, KaeMe `package.json` + tests, HabitTracker / MediaTracker / PlaylistModifier deploys.
