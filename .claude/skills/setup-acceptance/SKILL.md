# /setup-acceptance — Bootstrap a project for acceptance-tester

> **Pipeline announcements required.** Multi-step skill. Announce via `~/.claude/scripts/pipeline-step.sh`. Pipeline-id `setup-acceptance`, display name `Setup Acceptance`. Call `begin setup-acceptance "Setup Acceptance" --total 6` at kickoff and `end setup-acceptance --status ok|fail` on completion. **Final output ordering:** call `end` BEFORE your final user-facing summary; no tool calls after the summary.

> **Pacing:** multi-part deliverables follow `~/.claude/references/one-beat-per-turn.md`.

Scaffolds the acceptance-tester sidecar, fixtures stub, seed-script stub, and registry for a project so it can run through the new pipeline gate.

## Usage

```
/setup-acceptance
```

Run from the root of the project being onboarded. No arguments.

## What it produces

When successful, the project gains:

- `.claude/acceptance-config.md` — the per-project sidecar, partially pre-filled from auto-detected stack values, with `TODO:` markers on values that must be hand-set.
- `tests/acceptance/fixtures.<ext>` — stub fixtures module with one ephemeral example and one `@fixture` example.
- `tests/acceptance/ephemeral/.gitkeep` — placeholder so the regenerate-on-pipeline-run target dir exists.
- `tests/acceptance/.gitignore` — ignores `.acceptance-cache/` and any per-run scratch dirs.
- `scripts/seed-fixtures.<ext>` — stub seed script with TODO comments where the create/refresh logic goes.
- `.claude/scenario-registry.yaml` — initialized empty: `scenarios: []`.
- A printed checklist of TODOs the user must fill in by hand.

## Steps

### 1. Detect stack

Read project markers to classify language and runner. Priority order:

1. `package.json` exists → Node/TypeScript stack. Set `EXT=.ts`, `RUNNER_HINT=npm test or vitest`.
2. `pyproject.toml` exists → Python stack. Set `EXT=.py`, `RUNNER_HINT=pytest or uv run pytest`.
3. `Cargo.toml` exists → Rust stack. Set `EXT=.rs`, `RUNNER_HINT=cargo test`.
4. `go.mod` exists → Go stack. Set `EXT=.go`, `RUNNER_HINT=go test ./...`.
5. None of the above → ask the user which stack, or recommend dropping a `.claude/no-acceptance` opt-out marker if the project has no testable surface.

Also detect base URL hints by grepping for common patterns: `http://localhost:<port>` in `.env`, `package.json` scripts, `Procfile`, `docker-compose.yml`. If found, default `base_url_env=APP_URL` and note the detected port.

### 2. Check for prior setup

If `<cwd>/.claude/acceptance-config.md` already exists, ask the user whether to overwrite or abort. Default: abort. Never silently clobber a hand-written sidecar.

If `<cwd>/.claude/no-acceptance` exists, ask: "This project is currently opted out. Remove opt-out and proceed with setup?" Default: abort.

### 3. Scaffold the sidecar

Write `<cwd>/.claude/acceptance-config.md` using the schema from `~/.claude/agents/acceptance-tester.md` (§ "acceptance-config.md schema"). Pre-fill the values the detector resolved; leave `TODO:` on the rest.

Example for a Node/TS project:

```markdown
# Acceptance Test Config

## Driver
- kind: browser-use
- pinned_version: browser-use@0.7.0   # 0.7.0 ships the system_prompt.md templates that 0.2.0 was missing; never pin <0.7.0. Confirm latest stable before bumping.
- headless: true
- base_url_env: APP_URL   # TODO: confirm; .env hint detected port 3000
- auth_strategy: TODO: describe login flow (form login? OAuth? magic link?)

## Fixtures
- location: tests/acceptance/fixtures.ts
- lookup_convention: import { getFixture } from './fixtures'
- refresh_command_template: npm run seed:fixtures -- --user {name}

## Ephemeral Tests
- location: tests/acceptance/ephemeral/
- file_extension: .ts
- runner_command: TODO: e.g. npx vitest run tests/acceptance/ephemeral

## Scenario Source
- kind: directory
- directory: tests/acceptance/scenarios/

## Limits
- max_parallel: 3
- max_cost_usd: 5.00
- per_scenario_timeout_seconds: 180

## Graduation
- pass_streak_threshold: 3
- distinct_pipelines_threshold: 2
- playwright_target_dir: tests/e2e/acceptance/
- playwright_runner_command: TODO: e.g. npm run test:e2e -- tests/e2e/acceptance

## Pre-Run Setup
- name: app
  # Make `check` PROJECT-SPECIFIC so the emulator-coordination protocol can
  # distinguish "ours" from "another project's instance on the same port."
  # Examples:
  #   curl -sf http://localhost:5001/<this-project-id>/us-central1/<health-fn>
  #   curl -sf http://localhost:5173/<app-specific-asset>
  #   curl -sf http://localhost:4000/api/projects | grep -q "<this-project-id>"
  check: curl -sf http://localhost:3000/health
  start: TODO: e.g. npm run dev > /tmp/app.log 2>&1 &
  wait: curl -sf http://localhost:3000/health
  conflict_action: report

## Post-Run Cleanup
- name: app
  # Use a SPECIFIC argv pattern that matches only the agent-started process.
  # Don't use bare `pkill -f "vite"` — that would also kill the user's other
  # dev-session Vite servers. Match a project-specific token (project id,
  # workspace name, port, etc.).
  command: TODO: e.g. pkill -f "<project-specific-argv-pattern>"
```

Substitute `.py` / `.rs` / `.go` variants for non-Node projects, with the equivalent ecosystem commands (`uv run pytest`, `cargo test`, `go test`).

### Emulator / shared-port coordination — REQUIRED guidance

When `Pre-Run Setup` blocks govern shared-port resources (Firebase emulator, Postgres, dev API server, anything that binds a well-known port), the scaffold MUST author `check` so it distinguishes three states:

1. **`ours`** — THIS project's instance is up. Reuse it; don't restart (would disrupt the user's dev session).
2. **`none`** — port is unbound. Start the dependency.
3. **`foreign`** — port is bound but it's another project's instance. Wait up to 120s for them to free it; then BLOCK with a clear message.

The agent enforces this protocol (see `~/.claude/agents/acceptance-tester.md § "Emulator coordination protocol"`); the scaffold's job is to author `check` so it succeeds ONLY for state 1. Generic checks like `curl -sf http://localhost:8080/` cannot make the distinction and will silently let a scenario run against another project's data — that's a correctness bug.

When state `foreign` is detected, the agent does NOT pressure the user to stop the other project's instance — that other project may be actively under development. Instead, the agent emits a single notice with three reply options (`go` = keep waiting, `block` = halt this run, `skip` = mark this Pre-Run Setup step DEFERRED) and polls passively until the user replies. No automatic timeout; only a 5-minute heartbeat reminder. Authors of `Pre-Run Setup` blocks don't need to do anything special to enable this — `conflict_action: report` (the default) gets it.

When scaffolding for a Firebase project, prefer:

```
check: curl -sf http://localhost:5001/<this-project-id>/us-central1/<health-fn>
```

When scaffolding for a generic dev server, prefer a known project-specific route or asset (`/manifest.webmanifest`, `/api/version` returning a project id, etc.) over `/` or `/health`.

For `Post-Run Cleanup`, pkill patterns MUST be specific enough to kill only the agent-started process, never an externally-started instance. Include the project id, workspace flag, or another distinguishing token in the argv pattern.

### 4. Scaffold fixtures + seed stubs

Write `<cwd>/tests/acceptance/fixtures.<ext>` with one ephemeral pattern and one fixture-account pattern as examples. For Node/TS:

```ts
// Fixtures consumed by acceptance-tester.
// Each fixture is a long-lived test account with known seeded state.
// Edit this file when you need a new fixture profile.

export type Fixture = {
  email: string;
  password: string;
  seededState: string;
};

export const fixtures: Record<string, Fixture> = {
  'power-user': {
    email: 'test-power-user@example.dev',   // TODO: real test account email
    password: process.env.TEST_POWER_USER_PWD ?? '',
    seededState: 'TODO: describe what state this account has pre-loaded',
  },
};

export function getFixture(name: string): Fixture {
  const f = fixtures[name];
  if (!f) throw new Error(`Unknown fixture: ${name}`);
  if (!f.password) throw new Error(`Fixture ${name} missing password env var`);
  return f;
}
```

For Python:

```python
# Fixtures consumed by acceptance-tester.
import os
from dataclasses import dataclass

@dataclass
class Fixture:
    email: str
    password: str
    seeded_state: str

FIXTURES: dict[str, Fixture] = {
    "power-user": Fixture(
        email="test-power-user@example.dev",  # TODO: real test account email
        password=os.environ.get("TEST_POWER_USER_PWD", ""),
        seeded_state="TODO: describe what state this account has pre-loaded",
    ),
}

def get_fixture(name: str) -> Fixture:
    f = FIXTURES.get(name)
    if f is None:
        raise KeyError(f"Unknown fixture: {name}")
    if not f.password:
        raise RuntimeError(f"Fixture {name} missing password env var")
    return f
```

Write `<cwd>/scripts/seed-fixtures.<ext>` with stub logic:

```ts
// Seeds and refreshes fixture accounts. Run manually or via acceptance-tester's
// refresh_command_template. Idempotent: should be safe to run repeatedly.
// Usage: npm run seed:fixtures -- --user <name>

import { fixtures } from '../tests/acceptance/fixtures';

async function main() {
  const userArg = process.argv.find(a => a.startsWith('--user='))?.split('=')[1]
    ?? process.argv[process.argv.indexOf('--user') + 1];
  if (!userArg) throw new Error('Usage: seed-fixtures --user <name>');
  const f = fixtures[userArg];
  if (!f) throw new Error(`Unknown fixture: ${userArg}`);

  // TODO: implement against your project's API or DB:
  //   1. Look up or create the account (f.email, f.password).
  //   2. Reset its state to match f.seededState.
  //   3. Log success.

  console.log(`Seeded fixture: ${userArg}`);
}

main().catch(err => { console.error(err); process.exit(1); });
```

Python variant analogous.

### 5. Create supporting files

- `<cwd>/tests/acceptance/ephemeral/.gitkeep` (empty file).
- `<cwd>/tests/acceptance/scenarios/.gitkeep` (empty file; test-creator writes per-feature `<feature-slug>.md` scenario files here).
- `<cwd>/tests/acceptance/.gitignore` containing:

  ```
  ephemeral/*
  !ephemeral/.gitkeep
  .acceptance-cache/
  ```

- `<cwd>/.claude/scenario-registry.yaml`:

  ```yaml
  scenarios: []
  ```

If `<cwd>/.claude/no-acceptance` exists and the user confirmed proceeding (step 2), delete it.

### 6. Print the checklist

Emit the TODOs the user must fill in by hand before acceptance-tester will run cleanly. Group by file for scannability. Example:

```
Setup Acceptance complete — fill in these TODOs before running /feature:

acceptance-config.md
  - Confirm pinned browser-use version (current: TODO)
  - Describe auth_strategy
  - Set runner_command for ephemeral tests
  - Set playwright_runner_command
  - Fill in Pre-Run Setup.start and Post-Run Cleanup.command

fixtures.<ext>
  - Replace test-power-user@example.dev with a real test account
  - Add the TEST_POWER_USER_PWD env var to .env (and your secret manager)
  - Describe the seeded state for power-user

seed-fixtures.<ext>
  - Implement the create/reset logic against your project's API or DB

When done, run /feature on a small feature to validate. acceptance-tester will block on missing/invalid sidecar values until they're filled in.
```

## Rules

- Never overwrite a hand-written `.claude/acceptance-config.md` without explicit user confirmation.
- Never invent values that should come from the user (passwords, real test account emails, base URLs in production). Leave a `TODO:` marker every time.
- All scaffolded files use the project's idiomatic stack — don't drop TypeScript into a Python project.
- This skill never runs browser-use or invokes acceptance-tester. It only scaffolds files.
- If the project clearly has no UI / no testable surface (CLI-only utility), suggest the `.claude/no-acceptance` opt-out path instead of scaffolding.
