# coding-agents — Patterns

Sidecar for `~/.claude/agents/pattern-enforcer.md`.

## Project Layout
Scaffold/planning phase as of 2026-05-02. `docs/requirements/` only — no source code yet.

When code arrives, populate this file per the schema in the global agent.

## Universal Rules Apply
The global agent's universal rules (logging hygiene, type discipline, test discipline, integration & wiring, UX) still apply when code is reviewed.

## Secrets

Managed via `rotate-secret` (see `~/.claude/CLAUDE.md` § "Secret rotation").

- No credentials in scope yet. If/when added, follow the canonical
  locations: GCP keys at `~/.gcp/<project-id>.json`, openclaw-managed
  tokens in `~/.openclaw/credentials/env`.
- Run `rotate-secret inventory` after adding any new secret so it gets
  age-tracked and surfaced in `rotate-secret status`.
- Don't commit credential files.
