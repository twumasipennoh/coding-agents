# /deploy — Automated Deploy Skill

Deploy the current project to its target environment. Defaults to nonprod.

> **Pipeline announcements required.** This skill is a multi-step pipeline. Announce every non-interactive step via `~/.claude/scripts/pipeline-step.sh` per the rule in `~/.claude/CLAUDE.md § "Pipeline step announcements"`. Use pipeline-id `deploy`, display name `Deploy`, step labels as shown in the section headings below (e.g. `Pre-Deploy Checks`, `Deploy`, `Log`, `Notify`). Wrap the run with `begin deploy "Deploy" --total 4` at Step 3 kickoff (Steps 0–1 are parse/detect, near-instant) and `end deploy --status ok|fail` after Step 6. Replace all hand-written `telegram-ping.sh` calls below with the corresponding helper subcommand. **Final output ordering (critical):** call `end deploy` *before* emitting your final user-facing summary. Your last assistant message must be the deploy summary itself (project, env, commit, branch, outcome) with **no tool calls after it** — `--output-format json` returns only the final turn's text, so any summary emitted before a subsequent tool call is silently dropped. Telegram still gets the pipeline-step pings independently, but the openclaw reply (and any in-terminal session) needs the summary as the last turn.

## Usage

```
/deploy           → deploy to nonprod (staging/dev)
/deploy nonprod   → same as above
/deploy prod      → deploy to production
```

## Deploy kinds

The skill reads `.claude/deploy.json` for project-specific config. The top-level `kind` field selects the deploy flavor:

- **`firebase`** (default when `kind` is missing — back-compat with every existing `deploy.json`) — runs the Firebase CLI flow (tests → build → `firebase deploy`).
- **`local-script`** — runs the project's own shell commands locally (no Firebase, no cloud). Use this for projects whose "deploy" is a local rebuild + daemon restart, a docker restart, or any other shell-driven flow.

Other kinds (`docker`, `vercel`, etc.) are reserved for future additions. Adding a new kind = add a branch under each step that needs it + a schema example at the bottom.

## Invocation

When `/deploy` is called, execute the full pipeline below. Do NOT prompt for confirmation — if checks pass, deploy proceeds.

## Pipeline

### Step 0 — Parse arguments

- No argument or `nonprod` → target = `nonprod`
- `prod` → target = `prod`

### Step 1 — Detect project and load config

1. Determine the current project from the working directory.
2. Look for `.claude/deploy.json` in the project root.
3. **If `deploy.json` exists:** load it. Read top-level `kind` field — default to `"firebase"` if absent (back-compat). Then validate (Step 1b).
4. **If `deploy.json` does not exist:** check for deployment config files (`.firebaserc`, `firebase.json`, `Dockerfile`, `vercel.json`, etc.).
   - If `.firebaserc` / `firebase.json` found → auto-generate `deploy.json` with `kind: "firebase"` (see Firebase schema below), save it, continue.
   - Otherwise → exit with: "No deployment target configured for this project. To enable deploys, add `.claude/deploy.json` (set `kind: \"local-script\"` for non-cloud projects) or a `.firebaserc` (Firebase)."

Note: `local-script` projects MUST have a hand-written `deploy.json` — there is no auto-detection, because the commands are project-specific.

### Step 1b — Validate deploy.json against project files

**`kind: "firebase"`:**

- Read `.firebaserc` and `firebase.json`.
- Check that aliases in `deploy.json.environments` match `.firebaserc.projects`.
- Check that services in `deploy.json.services` match what's configured in `firebase.json` (hosting, functions, firestore, storage).
- If drift detected → auto-update `deploy.json`, note what changed in output, continue.

**`kind: "local-script"`:**

- No external config to validate against. Confirm required fields are present:
  - `environments` (with at least one entry flagged `nonprod: true`)
  - `testCommands` (array, may be empty if the project has no test gate)
  - `buildCommands` (object keyed by environment name)
  - `deployCommands` (object keyed by environment name, must contain at least one command for the resolved target)
- If a required field is missing or `deployCommands[<target>]` is empty, exit with a clear error naming the missing field. Do not silently default.

Preserve any user-customized fields (e.g., custom `testCommands`, `buildCommands`, `acknowledgedGaps`).

### Step 2 — Resolve environment

Using `deploy.json.environments`:
- If target is `nonprod` → use the environment where `"nonprod": true`.
- If target is `prod` → use the environment where `"prod": true`.

For `kind: "firebase"`, read the resolved `alias` and `projectId` for subsequent steps.
For `kind: "local-script"`, the environment key itself (e.g. `"local"`) is the label used in logs + notifications — there's no cloud project ID.

### Step 3 — Pre-deploy checks

**Announce start:** `~/.claude/scripts/pipeline-step.sh begin deploy "Deploy" --total 4` (covers Steps 3, 4, 5, 6).
**Announce step:** `~/.claude/scripts/pipeline-step.sh start deploy "Pre-Deploy Checks" --index 1`

Run these in order. If any fail, call `pipeline-step.sh fail deploy "Pre-Deploy Checks" "<reason>"`, then `pipeline-step.sh end deploy --status fail`, and stop.

**`kind: "firebase"`:**

1. **Firebase CLI check:** Run `npx firebase-tools@latest --version` to verify firebase tools are available.
2. **Auth check:** Run `npx firebase-tools@latest projects:list --json 2>/dev/null | head -5` to verify authentication. If this fails, report the auth issue and stop.
3. **Run tests:** Execute each command in `deploy.json.testCommands` sequentially. If any test command fails, stop.
4. **Run acceptance-tester (final gate before shipping):** Invoke the **acceptance-tester** agent. **BLOCKING** if any Phase 4 scenario can't reach its `Then` clause. Reports `DEFERRED` if `.claude/acceptance-config.md` is missing AND `.claude/no-acceptance` is absent (note logged; deploy continues — features whose Phase 4 was passed locally during `/feature` remain trusted). Reports `SKIPPED` if the opt-out marker is present. Set `acceptance_required: true` in `deploy.json` to upgrade `DEFERRED` to `FAIL` for high-stakes targets like prod.
   - **Invocation rule:** Do NOT instruct the acceptance-tester to treat missing infrastructure as DEFERRED. The agent's own `Pre-Run Setup` blocks (defined in the project's `acceptance-config.md`) handle starting dependencies (emulators, dev servers) and detecting port conflicts — let that logic run. The correct DEFERRED state is agent-driven (config missing, user replied `skip` to a conflict prompt), not a shortcut for "infra was down when I checked."
5. **Run build:** Execute each command in `deploy.json.buildCommands[<target>]` sequentially. If build fails, stop.
6. **Env file verification:** If `deploy.json.envFiles` is set for this target, verify those files exist and spot-check that they reference the correct project ID (grep for the project ID in the env file).

**`kind: "local-script"`:**

1. **Run tests:** Execute each command in `deploy.json.testCommands` sequentially. **BLOCKING** — broken tests = no deploy. (Skip this step ONLY if `testCommands` is an empty array, signalling the project has no test gate by design.)
2. **Run acceptance-tester (final gate before shipping):** Same contract as the firebase block above.
3. **Run build:** Execute each command in `deploy.json.buildCommands[<target>]` sequentially. If build fails, stop.

On success: `pipeline-step.sh done deploy "Pre-Deploy Checks" --note "tests + build verified"`.

### Step 4 — Deploy

**Announce step:** `~/.claude/scripts/pipeline-step.sh start deploy "Deploy" --index 2 --note "<env-label> (<nonprod|prod>)"`

**`kind: "firebase"`:**

1. **Switch alias:** `npx firebase-tools@latest use <alias>`
2. **Deploy:** `npx firebase-tools@latest deploy --project <alias>` — this deploys all configured services. If the project uses hosting targets (see `deploy.json.hostingTarget`), use `--only hosting:<target>,functions,firestore` as appropriate.
3. **Post-deploy script (if configured):** Run `deploy.json.postDeploy[<target>]` commands (e.g., monitoring setup).

**`kind: "local-script"`:**

1. **Run deploy commands:** Execute each entry in `deploy.json.deployCommands[<target>]` sequentially. Any non-zero exit fails the step.
2. **Post-deploy script (if configured):** Run `deploy.json.postDeploy[<target>]` commands. Typically empty for local-script projects, but available for smoke-checks or notifications.

On success: `pipeline-step.sh done deploy "Deploy" --note "<services-or-label>"`.
On failure: `pipeline-step.sh fail deploy "Deploy" "<reason>"`, then `end deploy --status fail`.

### Step 5 — Log

**Announce step:** `~/.claude/scripts/pipeline-step.sh start deploy "Log" --index 3`

Append a row to `DEPLOYMENTS.md` in the project root. Create the file if it doesn't exist. Format:

```markdown
| <date> | <env-label> | <commit-short-hash> | <branch> | <deployed> | <status> |
```

Where:
- `<date>` = ISO date (YYYY-MM-DD HH:MM)
- `<env-label>` = Firebase alias for `kind: "firebase"`; environment key (e.g. `"local"`) for `kind: "local-script"`
- `<commit-short-hash>` = `git rev-parse --short HEAD`
- `<branch>` = `git branch --show-current`
- `<deployed>` = comma-separated services list for `kind: "firebase"`; for `kind: "local-script"`, the literal label `local-script` optionally suffixed with `:<deploy.json.label>` if the project set one (e.g. `local-script:daemon-restart`)
- `<status>` = `success` or `failed: <reason>`

If the file doesn't have a table header yet, prepend:
```markdown
# Deployments

| Date | Env | Commit | Branch | Deployed | Status |
|------|-----|--------|--------|----------|--------|
```

On completion: `pipeline-step.sh done deploy "Log" --note "<commit-short-hash>, <branch>"`.

### Step 6 — Notify

**Announce step:** `~/.claude/scripts/pipeline-step.sh start deploy "Notify" --index 4`

Do nothing specific in this step beyond the helper call — the pipeline-step helper already sends a telegram message. Use the `--note` field on `end` to carry the extra context (`<project-name> to <env-label>`, commit hash, branch, deployed URL).

**Deployed URL — always append a cache-bust query string.** Whenever you surface the deployed URL — in the `end` note, the final assistant summary, or any user-facing message after deploy — append `?v=<short-hash>` (the same `git rev-parse --short HEAD` value used in the log row). Reason: browsers + service workers + CDN edge caches frequently serve a stale HTML/JS bundle right after deploy, so kwaku clicks the link and sees the old build with no indication anything shipped. The cache-bust forces a fresh fetch every time. Examples: `https://habit-tracker-staging-3fd56.web.app/?v=a1b2c3d`, `http://localhost:3000/?v=a1b2c3d`. For `kind: "local-script"` deploys with no public URL, skip this — there's nothing to link. If the URL already has a query string, append with `&v=<short-hash>` instead.

- **On success:** `pipeline-step.sh done deploy "Notify"`, then `pipeline-step.sh end deploy --status ok --note "<project-name> to <env-label> (<nonprod|prod>). Commit: <short-hash>, Branch: <branch>. URL: <deployed-url>?v=<short-hash>"`.
- **On failure:** `pipeline-step.sh fail deploy "Notify" "<failure-reason>"`, then `pipeline-step.sh end deploy --status fail --note "<project-name> to <env-label>. <failure-reason>"`.

**Post-deploy verification checklist (success only).** After calling `end`, and before emitting the final assistant message, generate a **Verify:** section tailored to what was actually deployed.

**How to build the checklist:**

1. **Dynamic items (from the diff).** Run `git log --oneline <last-deploy-commit>..HEAD` (or `origin/main..HEAD` if no prior deploy) and `git diff --stat` for the same range. From the changed files and commit messages, generate 2-5 verification items that a human can check in under 2 minutes. Map changes to user-visible behavior:
   - Auth/login files changed → "Log out and back in, verify session works"
   - API endpoint or Cloud Function changed → "Hit the affected endpoint / trigger the function and confirm the response"
   - UI component or page changed → "Open the affected page and verify the change renders correctly"
   - Database schema/indexes changed → "Verify the affected query returns results (not FAILED_PRECONDITION)"
   - CSS/styling changed → "Open the affected page on mobile and desktop, confirm layout"
   - New feature added → "Walk through the new feature end-to-end"
   - Bug fix → "Reproduce the original bug scenario and confirm it's resolved"
   - Config/env change → "Verify the app reads the new config correctly (check logs or behavior)"
   Each item should be specific enough to act on without reading the diff. Name the page, feature, or endpoint affected.

2. **Compose the section.** Cap at 7 bullets total. Replace `{url}` with the deployed URL (including `?v=<short-hash>` cache-bust) and `{env}` with the resolved environment label in any item that uses them. Omit the section entirely only if the diff produced no actionable items.

Example output shape (a deploy that changed the feed ranker + fixed a save bug):

```
**Verify:**
- Open {url}, scroll the Discover feed, confirm new content ordering feels right (ranker change)
- Save a piece of content, navigate away and back, confirm it persists (save bug fix)
```

## deploy.json — `kind: "firebase"` schema

```jsonc
{
  // Auto-detected, do not edit
  "platform": "firebase",
  "projectName": "HabitTracker",
  "kind": "firebase",   // optional — defaults to "firebase" when absent

  // Environment map — derived from .firebaserc
  "environments": {
    "staging": {
      "alias": "staging",
      "projectId": "habit-tracker-staging-3fd56",
      "nonprod": true
    },
    "default": {
      "alias": "default",
      "projectId": "habit-tracker-54d52",
      "prod": true
    }
  },

  // Services to deploy — derived from firebase.json
  "services": ["hosting", "functions", "firestore"],

  // Optional: hosting target name (for projects using Firebase hosting targets)
  "hostingTarget": null,

  // Test commands — run before every deploy (both nonprod and prod)
  "testCommands": [
    "npm -w packages/core run test",
    "npm -w apps/web run test:run",
    "npm -w functions run test:unit"
  ],

  // Build commands — per target environment
  "buildCommands": {
    "nonprod": ["npm -w apps/web run build:staging"],
    "prod": ["npm -w apps/web run build:prod"]
  },

  // Optional: env files to verify per target
  "envFiles": {
    "nonprod": [".env.staging"],
    "prod": [".env.production"]
  },

  // Optional: post-deploy commands per target
  "postDeploy": {
    "nonprod": [],
    "prod": ["GOOGLE_APPLICATION_CREDENTIALS=~/.gcp/habit-tracker-54d52.json FIRESTORE_PROJECT=habit-tracker-54d52 node scripts/setup-monitoring.js"]
  },

  // Auto-managed: services in firebase.json that are absent — flagged once, not re-asked
  "acknowledgedGaps": []
}
```

### Firebase auto-generation rules

When generating `deploy.json` from project files (Firebase-only — `local-script` projects must be configured by hand):

**Environments:** Read `.firebaserc.projects`. Heuristic for nonprod/prod assignment:
- Alias names containing `staging`, `dev`, `development`, `test` → `nonprod: true`
- Alias names containing `prod`, `production`, `default` → `prod: true`
- If ambiguous, assign the first alias as nonprod and flag for user review.

**Services:** Read `firebase.json` top-level keys. Map:
- `hosting` key present → `"hosting"`
- `functions` key present → `"functions"`
- `firestore` key present → `"firestore"`
- `storage` key present → `"storage"`

If `firebase.json` exists but is missing commonly expected services (e.g., has hosting but no functions), note it in output: "firebase.json has no functions configured — deploying hosting + firestore only. Update firebase.json if this is incorrect." Add the missing service to `acknowledgedGaps` so this message is not repeated.

**Test commands:** Scan for test infrastructure:
- `package.json` with `test` or `test:run` scripts → include them
- `pytest.ini` or `pyproject.toml` with pytest config → include `pytest`
- Monorepo workspaces → include test commands for each workspace that has tests

**Build commands:** Scan `package.json` for build scripts:
- If environment-specific builds exist (`build:staging`, `build:prod`) → map to nonprod/prod
- If only a generic `build` script → use it for both
- If no build script (e.g., Python-only projects) → empty array

**Post-deploy:** Check `package.json` for `deploy:staging` / `deploy:prod` scripts and extract any post-firebase-deploy commands. Otherwise empty.

## deploy.json — `kind: "local-script"` schema

```jsonc
{
  "project": "conversational-assistant",
  "kind": "local-script",

  // Optional one-word descriptor that appears in the DEPLOYMENTS.md log
  // row as `local-script:<label>` — makes the deploy intent recognizable
  // at a glance (e.g. `daemon-restart`, `docker-rebuild`, `pm2-reload`).
  "label": "daemon-restart",

  // Environment map. For local-script, the env key is just a label —
  // no alias/projectId required (Firebase-shaped fields are ignored if
  // present). Same nonprod / prod booleans as the firebase schema.
  // Phase-1 single-env setups can flag the same env as both nonprod and
  // prod until a real env split exists.
  "environments": {
    "local": { "nonprod": true, "prod": true }
  },

  // Test commands — BLOCKING on any failure. Empty array = no test gate
  // (skip Step 3.1 entirely; intentional opt-out, not a missing field).
  "testCommands": ["npm test"],

  // Build commands per target environment.
  "buildCommands": {
    "local": ["npm run build"]
  },

  // Deploy commands per target environment — the local-script-specific
  // field. Each entry is a shell command; they run sequentially, any
  // non-zero exit fails the deploy.
  "deployCommands": {
    "local": ["aide daemon stop", "aide daemon start"]
  },

  // Optional post-deploy commands per target (smoke checks, etc.).
  "postDeploy": {
    "local": []
  }
}
```

## Non-deployable projects

If invoked with no `.claude/deploy.json` AND no Firebase config:
- Output: "No deployment target configured for this project. To enable deploys, add `.claude/deploy.json` (set `kind: \"local-script\"` for non-cloud projects) or a `.firebaserc` (Firebase)."
- Do not create `deploy.json`.
- Do not ping telegram.

## Notes

- Never prompt for confirmation. If checks pass, deploy.
- Never re-ask about acknowledged gaps in `deploy.json.acknowledgedGaps` (Firebase only).
- The `deploy.json` file should be committed to the repo — it contains no secrets.
- Firebase: use `npx firebase-tools@latest` rather than assuming `firebase` is on PATH.
- For prod deploys, include a note in the output: "Deploying to PRODUCTION" — but do not block or ask for confirmation.
- If telegram ping fails (script missing, no token), log the failure but continue the deploy — notifications are best-effort.
