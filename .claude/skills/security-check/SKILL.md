# /security-check - Quick Security Audit

> **Pipeline announcements required.** This is a multi-step pipeline. Announce steps via `~/.claude/scripts/pipeline-step.sh` per the rule in `~/.claude/CLAUDE.md § "Pipeline step announcements"`. Use pipeline-id `security-check`, display name `Security Check`. Call `begin security-check "Security Check" --total 5` at kickoff, `start`/`done`/`fail`/`skip` around each non-interactive step below, and `end security-check --status ok|fail` on completion. Skip interactive steps (user gates, clarification phases) — they self-announce. **Final output ordering (critical):** call `end` *before* emitting your final user-facing response. Your last message must be the deliverable itself (summary, report, PR link, etc.) with **no tool calls after it** — `--output-format json` returns only the final turn's text, so any deliverable emitted before a subsequent tool call is silently dropped.

Scan the codebase for common security issues mapped to the SECURITY PLAN TO-DOs in CLAUDE.md.

## Steps

### 1. .gitignore Coverage
- Read `.gitignore` and verify it excludes:
  - `.env`, `.env.*`
  - `node_modules/`, `__pycache__/`, `*.pyc`
  - API key files, credentials, service account JSON
  - System logs (`*.log`, etc.)
- Flag any missing exclusions.

### 2. Hardcoded Secrets Scan
- Search for patterns that suggest hardcoded secrets:
  - `API_KEY`, `SECRET`, `TOKEN`, `PASSWORD` in string literals (not env var reads)
  - Inline credentials in config files
  - OAuth tokens or refresh tokens in source
- Exclude test fixtures and mocks from this scan.
- Flag any findings with file path and line number.

### 3. Rate Limiting Check
- Search for rate limiting middleware or decorators on API routes.
- List all API endpoints and whether they have rate limiting applied.
- Flag any state-changing endpoints (POST, PUT, DELETE) without rate limiting.

### 4. User Data Scoping
- Search database queries for user_id filtering.
- Flag any queries that could return data across users (missing user_id filter).
- Check that all list/query methods accept and filter by user_id.

### 5. CSRF Protection
- Check that state-changing endpoints (POST, PUT, DELETE) use CSRF validation.
- Flag any unprotected endpoints.

### 6. Logging Hygiene
- Search log statements for potential token/secret leakage.
- Check that OAuth tokens, passwords, and API keys are not logged.

## Reply format

**Default chat reply: 1-3 sentences, no template, lead with N
passed + top finding.** Pattern:

    security-check: N passed, M ⚠. top: <one-line finding>.
    clean / fix-now?

If multiple categories flagged issues, apply the one-beat rule from
`~/.claude/CLAUDE.md § "Multi-part answers — one beat per turn"` —
open with the count, deliver the most urgent finding, offer the rest
if asked.

The structured per-category audit format is **opt-in only** — emit
it only when the user explicitly asks for "the full breakdown",
"expand", or "details". Don't lead with it.

If asked to expand, use this template:

```
Security Audit Results:

.gitignore:       All sensitive patterns excluded (or Missing: ...)
Secrets Scan:     No hardcoded secrets found (or Found X issues)
Rate Limiting:    All endpoints covered (or X endpoints unprotected)
Data Scoping:     All queries user-scoped (or X queries need review)
CSRF:             All state-changing routes protected (or X routes exposed)
Logging:          No secrets in logs (or X potential leaks)
```

List details for any warnings.

## Notes
- Default chat reply is 1-3 sentences in one message. Structured format is opt-in only.
- This is a static analysis scan, not a penetration test.
- False positives in test files are expected — note them but don't flag as critical.
