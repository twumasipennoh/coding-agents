# Reference: Insem Monitoring Pattern

This documents the proven pattern from `Insem_SocialMediaAggregator/scripts/monitoring/`
as the canonical reference for the monitoring-implementer skill.

## Directory Structure

```
scripts/monitoring/
├── setup-monitoring.js   # CLI orchestrator (--tier, --project, --dry-run)
├── helpers.js            # GCP API wrappers (idempotent, retry, dry-run)
├── critical.js           # Critical tier: uptime, error rate, latency, escalation
├── high.js               # High tier: log-based metrics, transformation/ingestion
├── medium.js             # Medium tier: per-feature escalation, email failures
├── low.js                # Low tier: profile/settings, auto-close
├── package.json          # Dependencies (@google-cloud/monitoring, logging, scheduler)
└── __tests__/
    └── monitoring.test.js
```

## Key Design Decisions

1. **Tier-ordered execution**: Critical → High → Medium → Low
2. **Idempotent**: Uses display name matching — safe to re-run
3. **Dry-run first**: Every function accepts `dryRun` flag
4. **Retry with backoff**: Handles RESOURCE_EXHAUSTED (8) and UNAVAILABLE (14)
5. **Lazy singleton clients**: GCP clients created once on first use
6. **Non-blocking deploy hook**: Monitoring failure doesn't fail the deploy
7. **Escalation pattern**: `createEscalationAlerts()` generates 3-tier severity per feature
8. **Log-based metrics**: Extract structured logging fields into queryable metrics

## Dependencies

```json
{
  "@google-cloud/logging": "^11.2.0",
  "@google-cloud/monitoring": "^5.3.1",
  "@google-cloud/scheduler": "^4.3.0"
}
```

HabitTracker uses a different approach — REST API via `google-auth-library` + `node-fetch`
rather than the `@google-cloud/*` client libraries. Both work; the client library approach
(Insem) is preferred for new projects.

## Deploy Hook Pattern

### package.json scripts
```json
"monitoring:setup": "node scripts/monitoring/setup-monitoring.js --tier=all",
"monitoring:dry-run": "node scripts/monitoring/setup-monitoring.js --tier=all --dry-run"
```

### In deploy script (non-blocking)
```bash
node scripts/monitoring/setup-monitoring.js --tier=all --project="$PROJECT" \
  || echo "WARNING: Monitoring setup failed (non-blocking)"
```

## Notification Email

All projects use: `twumasi.pennoh@gmail.com`
