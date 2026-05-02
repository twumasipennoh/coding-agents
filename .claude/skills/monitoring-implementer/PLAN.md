# Monitoring Implementer — Implementation Plan

Status: **STEPS 1-7 COMPLETE** (as of 2026-04-21). Gap analyses written; actual script generation pending user review.

---

## What Changes

**Today:** The pipeline validates that a monitoring spec document exists and is filled out. Features deploy with no monitoring infrastructure. The HabitTracker feature-monitoring-enforcer skill and the monitoring-spec-validator agent both only look at the document.

**After:** The pipeline has a dedicated step that reads the monitoring spec and produces real infrastructure — GCP alert policy scripts, log-based metric definitions, client-side instrumentation in the feature code, and deploy hook wiring. The monitoring-spec-validator gains a second mode that verifies the implementation matches the spec. The HabitTracker monitoring enforcer skill is removed (its responsibilities are absorbed).

---

## Implementation Sequence

### 1. Create the shared global skill (`~/.claude/skills/monitoring-implementer/`)

The skill defines the methodology — what the agent must produce given a monitoring spec. It includes:

- Reference scripts modeled on Insem's working `scripts/monitoring/` pattern (setup orchestrator, per-tier modules, helpers, dry-run support)
- Templates for common monitoring patterns (error rate alerts, latency alerts, heartbeat checks, log-based metrics, notification channels)
- A scaffold generator that reads a `monitoring_spec.md` and produces a project-specific `scripts/monitoring/` directory
- Instructions for client-side instrumentation patterns (error reporting hooks, metric emission)
- Backfill mode instructions: gap analysis first, then implementation with user review

### 2. Create per-project agent (`monitoring-implementer.md`) for each project

Each project gets an agent that inherits the skill's methodology but knows:

- The project's GCP project ID and environment (from CLAUDE.md)
- The metric namespace convention (e.g., `insem/*`, `habittracker/*`)
- Notification email and channels
- Existing monitoring scripts to extend rather than overwrite (Insem)
- Project-specific patterns (Firebase Cloud Functions vs Cloud Run, Firestore vs other backends)

Deploy to: HabitTracker, Insem, MediaTracker, conversational-assistant, and any other project with a monitoring spec.

### 3. Update the pipeline definition in each project's feature-implementer

Insert monitoring-implementer as a step after feature-creator (implementation) and before the parallel gates:

```
requirements → monitoring-spec-validator (early) → pre-flight → tests → implementation → monitoring-implementer → [PARALLEL gates including monitoring-spec-validator (late)] → test-suite → doc-sync → user-gate → commit
```

### 4. Enhance the monitoring-spec-validator agent

Add a "late pass" / "implementation verification" mode. When invoked in the gates (after monitoring-implementer has run), it checks:

- `scripts/monitoring/` exists and has setup scripts covering every spec entry
- Client-side instrumentation exists for entries that require it
- Deploy hook is wired to run the monitoring setup
- Dry-run of the setup scripts passes without errors

The early pass (spec document quality) stays unchanged.

### 5. Update per-project CLAUDE.md files

Add a monitoring conventions section documenting:

- Metric namespace for the project
- Notification channel configuration
- Where monitoring scripts live (`scripts/monitoring/`)
- Deploy hook pattern

### 6. Remove HabitTracker's feature-monitoring-enforcer skill

Delete `~/.claude/skills/feature-monitoring-enforcer/` (or HabitTracker's local copy). Its responsibilities (enforce spec existence, validate completeness, provide template) are now split between the monitoring-spec-validator (validation) and monitoring-implementer (implementation + template).

### 7. Backfill existing projects

Run the monitoring-implementer agent in backfill mode against each project:

- **HabitTracker:** Reads `monitoring_spec.md`, produces gap analysis, generates monitoring scripts and client-side instrumentation after review.
- **Insem:** Lighter backfill pass — the agent verifies its existing `scripts/monitoring/` covers its spec and flags any gaps. No full regeneration.
- **MediaTracker:** Full backfill — reads `monitoring_spec.md`, produces gap analysis, generates `scripts/monitoring/` and client-side instrumentation after review.
- **conversational-assistant:** Full backfill — reads `monitoring_spec.md`, produces gap analysis, generates `scripts/monitoring/` and client-side instrumentation after review.
