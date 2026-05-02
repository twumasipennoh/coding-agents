# /deploy — Automated Deploy Skill

Deploy the current project to its target environment. Defaults to nonprod.

> **Pipeline announcements required.** This skill is a multi-step pipeline. Announce every non-interactive step via `~/.claude/scripts/pipeline-step.sh` per the rule in `~/.claude/CLAUDE.md § "Pipeline step announcements"`. Use pipeline-id `deploy`, display name `Deploy`, step labels as shown in the section headings below (e.g. `Pre-Deploy Checks`, `Deploy`, `Log`, `Notify`). Wrap the run with `begin deploy "Deploy" --total 4` at Step 3 kickoff (Steps 0–1 are parse/detect, near-instant) and `end deploy --status ok|fail` after Step 6. Replace all hand-written `telegram-ping.sh` calls below with the corresponding helper subcommand.

## Usage

```
/deploy           → deploy to nonprod (staging/dev)
/deploy nonprod   → same as above
/deploy prod      → deploy to production
```

## Invocation

When `/deploy` is called, execute the full pipeline below. Do NOT prompt for confirmation — if checks pass, deploy proceeds.

## Pipeline

### Step 0 — Parse arguments

- No argument or `nonprod` → target = `nonprod`
- `prod` → target = `prod`

### Step 1 — Detect project and load config

1. Determine the current project from the working directory.
2. Look for `.claude/deploy.json` in the project root.
3. **If `deploy.json` exists:** load it, then validate (Step 1b).
4. **If `deploy.json` does not exist:** check for deployment config files (`.firebaserc`, `firebase.json`, `Dockerfile`, `vercel.json`, etc.).
   - If deployment config found → auto-generate `deploy.json` (see schema below), save it, and continue.
   - If no deployment config found → exit with: "No deployment target configured for this project."

### Step 1b — Validate deploy.json against project files

Compare `deploy.json` against the actual project config files:

- **Firebase projects:** Read `.firebaserc` and `firebase.json`.
  - Check that aliases in `deploy.json.environments` match `.firebaserc.projects`.
  - Check that services in `deploy.json.services` match what's configured in `firebase.json` (hosting, functions, firestore, storage).
  - If drift detected → auto-update `deploy.json`, note what changed in output, continue.
- **Other platforms (future):** Validate against their respective config files.

Preserve any user-customized fields (e.g., custom `testCommands`, `buildCommands`, `acknowledgedGaps`).

### Step 2 — Resolve environment

Using `deploy.json.environments`:
- If target is `nonprod` → use the environment where `"nonprod": true`.
- If target is `prod` → use the environment where `"prod": true`.

Read the resolved alias and project ID for use in subsequent steps.

### Step 3 — Pre-deploy checks

**Announce start:** `~/.claude/scripts/pipeline-step.sh begin deploy "Deploy" --total 4` (covers Steps 3, 4, 5, 6).
**Announce step:** `~/.claude/scripts/pipeline-step.sh start deploy "Pre-Deploy Checks" --index 1`

Run these in order. If any fail, call `pipeline-step.sh fail deploy "Pre-Deploy Checks" "<reason>"`, then `pipeline-step.sh end deploy --status fail`, and stop.

1. **Firebase CLI check:** Run `npx firebase-tools@latest --version` to verify firebase tools are available.
2. **Auth check:** Run `npx firebase-tools@latest projects:list --json 2>/dev/null | head -5` to verify authentication. If this fails, report the auth issue and stop.
3. **Run tests:** Execute each command in `deploy.json.testCommands` sequentially. If any test command fails, stop.
4. **Run build:** Execute each command in `deploy.json.buildCommands[<target>]` sequentially (use the target-specific build commands — `nonprod` or `prod`). If build fails, stop.
5. **Env file verification (Firebase):** If `deploy.json.envFiles` is set for this target, verify those files exist and spot-check that they reference the correct project ID (grep for the project ID in the env file).

On success: `pipeline-step.sh done deploy "Pre-Deploy Checks" --note "tests + build + env verified"`.

### Step 4 — Deploy

**Announce step:** `~/.claude/scripts/pipeline-step.sh start deploy "Deploy" --index 2 --note "<alias> (<nonprod|prod>)"`

1. **Switch alias (Firebase):** `npx firebase-tools@latest use <alias>`
2. **Deploy:** `npx firebase-tools@latest deploy --project <alias>` — this deploys all configured services. If the project uses hosting targets (see `deploy.json.hostingTarget`), use `--only hosting:<target>,functions,firestore` as appropriate.
3. **Post-deploy script (if configured):** Run `deploy.json.postDeploy[<target>]` commands (e.g., monitoring setup).

On success: `pipeline-step.sh done deploy "Deploy" --note "services deployed"`.
On failure: `pipeline-step.sh fail deploy "Deploy" "<reason>"`, then `end deploy --status fail`.

### Step 5 — Log

**Announce step:** `~/.claude/scripts/pipeline-step.sh start deploy "Log" --index 3`

Append a row to `DEPLOYMENTS.md` in the project root. Create the file if it doesn't exist. Format:

```markdown
| <date> | <alias> | <commit-short-hash> | <branch> | <services> | <status> |
```

Where:
- `<date>` = ISO date (YYYY-MM-DD HH:MM)
- `<alias>` = Firebase alias used
- `<commit-short-hash>` = `git rev-parse --short HEAD`
- `<branch>` = `git branch --show-current`
- `<services>` = comma-separated list of deployed services
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

Do nothing specific in this step beyond the helper call — the pipeline-step helper already sends a telegram message. Use the `--note` field on `end` to carry the extra context (`<project-name> to <alias>`, commit hash, branch).

- **On success:** `pipeline-step.sh done deploy "Notify"`, then `pipeline-step.sh end deploy --status ok --note "<project-name> to <alias> (<nonprod|prod>). Commit: <short-hash>, Branch: <branch>"`.
- **On failure:** `pipeline-step.sh fail deploy "Notify" "<failure-reason>"`, then `pipeline-step.sh end deploy --status fail --note "<project-name> to <alias>. <failure-reason>"`.

## deploy.json Schema

```jsonc
{
  // Auto-detected, do not edit
  "platform": "firebase",
  "projectName": "HabitTracker",

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

### Auto-generation rules

When generating `deploy.json` from project files:

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

## Non-deployable projects

If invoked in a project with no deployment configuration:
- Output: "No deployment target configured for this project. To enable deploys, add a `.firebaserc` (Firebase), `Dockerfile` (Docker), or other deployment config."
- Do not create `deploy.json`.
- Do not ping telegram.

## Notes

- Never prompt for confirmation. If checks pass, deploy.
- Never re-ask about acknowledged gaps in `deploy.json.acknowledgedGaps`.
- The `deploy.json` file should be committed to the repo — it contains no secrets.
- Use `npx firebase-tools@latest` rather than assuming `firebase` is on PATH.
- For prod deploys, include a note in the output: "Deploying to PRODUCTION" — but do not block or ask for confirmation.
- If telegram ping fails (script missing, no token), log the failure but continue the deploy — notifications are best-effort.
