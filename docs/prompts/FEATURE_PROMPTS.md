# coding-agents — Feature Prompts

## Table of Contents
- ⏳ [Feature 1 — Central Firebase drift gate for /deploy](#feature-1--central-firebase-drift-gate-for-deploy)

## Dependency Tree
```
⏳ F1 Central Firebase drift gate (no dependencies)
```

---

# Feature 1 — Central Firebase drift gate for /deploy

**Why:** HabitTracker's (`scripts/check-firestore-indexes.js`) and MediaTracker's (`scripts/check-firestore-indexes.mjs`) index-drift checks only run from their Windows `scripts/deploy.ps1` (HabitTracker :213, MediaTracker :159); Linux `/deploy` never calls either. PlaylistModifier has none. KaeMe has the strongest checker (`conversational-assistant/scripts/check-firebase-drift.mjs`: firestore rules, storage rules, composite indexes and field overrides, judged against the branch's git lineage). See DEC-002.

**Scope (locked 2026-11-16):**
- `/deploy` runs the central drift check before the upload for every `kind: "firebase"` project whose deploy includes Firestore: HabitTracker, MediaTracker, PlaylistModifier_v2. Hosting-only deploys skip it.
- One-time audit of all five live projects (HabitTracker staging + prod, MediaTracker dev + prod, PlaylistModifier) and reconciliation of any drift *before* the step blocks.
- Out of scope: Insem (its `scripts/deploy.sh` already gates), Chini (no index file), KaeMe deploys (its npm `predeploy:rules:*` hook already gates; only its path changes).

**"Includes Firestore" defined:** the step keys on `deploy.json.services` containing `firestore`. `/deploy` Step 4 deploys every listed service, so all three in-scope projects always run it today; a project (or future `--only hosting` path) whose services omit `firestore` skips it and says so in the step note.

**Build/buy:** buy (internal) — adopt KaeMe's `check-firebase-drift.mjs`. Master copy moves to this repo; `/deploy` runs it from `~/projects/coding-agents/scripts/` directly (no sync step).

**Prerequisite (kwaku):** generate a service-account key for PlaylistModifier at `~/.gcp/playlist-modifier.json` (Firebase Console → Project Settings → Service accounts). Until it exists, PlaylistModifier deploys stop with exit 3 (credentials missing); the Task 1.4 audit run records that exit as evidence.

## Known Failure Rules
- `[node-esm] [WIRING]` entry-point guard compares unresolved argv[1] with the realpathed module (Insem `.claude/known-failures.md`): the KaeMe script's guard had this bug; replaced with realpath-both-sides.
- CONFIG-AS-CODE DRIFT deploy-time diff rule (project CLAUDE.md files): the gate must fail closed — every non-zero exit blocks, including "couldn't check" (2–6).

## Task 1.0 — Tracer Path
- Entry: `/deploy staging` in HabitTracker.
- Output: a Pre-Deploy Checks line naming the drift result (`No drift` / `DRIFT DETECTED` / `check-firebase-drift FAILED: …`) before the upload starts.
- Seams (in call order):
  - **S1** `/deploy` Step 3 firebase block → `node ~/projects/coding-agents/scripts/check-firebase-drift.mjs --project <alias> --repo <project root>`
  - **S2** script entry guard → `main()` (must survive a symlinked launch path)
  - **S3** project root = `--repo` or cwd → `.firebaserc` / `firestore.rules` / optional `storage.rules` / `firestore.indexes.json` reads, and the git lineage runner, all in that root (never the script's own location)
  - **S4** `.firebaserc` alias → project ID
  - **S5** `~/.gcp/<id>.json` → OAuth token
  - **S6** rules + index REST reads → `evaluateDrift`
  - **S7** exit code → `/deploy` pass / fail
  - **S8** KaeMe `predeploy:rules:*` npm hook → central path (Task 1.2)
- Test: `tests/cli.test.ts` runs the real script against a scratch project with stubbed `fetch` + throwaway key, asserting exit 0 / 1 / 2 / 3 and a result line (S2–S7).

## Task 1.1 — Move the master into coding-agents ✅
- [x] Copy `check-firebase-drift.mjs` + its unit tests into `scripts/` + `tests/`; KaeMe's real `firestore.rules` becomes `tests/fixtures/kaeme.firestore.rules`. (KaeMe's f63 npm-hook test stays in KaeMe: it tests KaeMe's own wiring, S8.)
- [x] Minimal `package.json` + vitest; layer added to `.claude/test-commands.md`.
- [x] Re-root (S3): `--repo <dir>`, default cwd; `readLocalFile` and the git runner use that root.
- [x] `storage.rules` optional: absent → section `skipped`, never drift, lineage skips the file.
- [x] Entry guard realpaths both sides (S2).
- [x] Tests (red against KaeMe's original, green after; the guard test also red with only the guard reverted).

## Task 1.2 — Repoint KaeMe (S8)
- [ ] `check:drift:*` npm scripts call `../coding-agents/scripts/check-firebase-drift.mjs --repo .`; delete KaeMe's copy and its moved unit test.
- [ ] Update KaeMe's f63 wiring test to run the central script, and add a case: `coding-agents` checkout missing → `npm run deploy:rules:dev` fails and the stub `firebase` never runs.

## Task 1.3 — /deploy step (S1, S7)
- [ ] In `~/.claude/skills/deploy/SKILL.md` Step 3 (`kind: "firebase"`), when `services` includes `firestore`, run the check with the target env's alias and `--repo <project root>`; any non-zero exit fails Pre-Deploy Checks with the script's first failure line.
- [ ] Central script missing → stop with "drift gate unavailable: clone coding-agents to ~/projects/coding-agents".
- [ ] HabitTracker's and MediaTracker's `deploy.ps1` calls stay as-is (Windows path; no Linux call exists to remove).

## Task 1.4 — Audit, then block
- [ ] Run the check read-only against all five projects; record each exit + summary.
- [ ] Reconcile each drift (pull console changes into the repo's `firestore.indexes.json` / `firestore.rules`, PR per project). Re-run until every project exits 0 (PlaylistModifier: exit 3 until its key exists).
- [ ] Only then land Task 1.3's blocking step.

## Tests to Write First (scenario summary)
**Compare (S6)**
- [Unit|H] rules + indexes match baseline → no drift (existing KaeMe suite, 101 cases)
- [Unit|U] live index missing from file → drift with the JSON to paste (existing)
- [Unit|E] no storage.rules, nothing live → `skipped`, no drift
- [Unit|E] no storage.rules, live bucket rules exist → `skipped` "not managed by this repo", no drift
- [Unit|E] skipped section renders with its own icon
- [Int|E] live = file at an earlier branch commit → pass (existing lineage cases)

**Root + args (S3, S4)**
- [Unit|H] `--repo <dir>` parsed; absent → undefined
- [Int|H] `--repo <project>` → that project's ID in the report, exit 0
- [Int|H] no `--repo`, cwd = project → same
- [Int|U] project without `.firebaserc` → exit 2 naming the project dir

**Guard (S2)**
- [Int|E] launched through a symlinked scripts dir → main() runs, exit 0

**Credentials + network (S5, S6)**
- [Int|U] no key for the project → exit 3
- [Int|U] live rules edited in console → exit 1, "DRIFT DETECTED"
- [Unit|U] network failure → exit 5 (existing `classifyHttpError` cases)

**KaeMe wiring (S8)**
- [Int|H] `npm run deploy:rules:dev` → central check runs, then the stub `firebase deploy`
- [Int|U] coding-agents checkout missing → npm run fails, `firebase deploy` never runs

**/deploy (S1, S7) — manual QA (skill text, no harness)**
- [E2E|H] `/deploy staging` on HabitTracker → "No drift" line before the upload
- [E2E|U] drift present (or PlaylistModifier without its key) → Pre-Deploy Checks fails, nothing uploaded
- [E2E|U] `~/projects/coding-agents` missing → stops with "drift gate unavailable"
- [E2E|E] prod alias (`default`) → resolves the prod project ID, same behaviour
- [E2E|E] a project whose services omit `firestore` → step skipped, note says why

**Audit (Task 1.4)** — manual QA: five recorded runs, each exit 0 (or PlaylistModifier exit 3 pending its key) before blocking lands.
