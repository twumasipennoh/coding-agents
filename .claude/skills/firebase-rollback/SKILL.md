# /firebase-rollback — Roll a Firebase app back to a prior deploy

> **Pipeline announcements.** Announce via `~/.claude/scripts/pipeline-step.sh`
> (pipeline-id `firebase-rollback`, display name `Firebase Rollback`): `begin` at
> kickoff, `start`/`done`/`fail` around the rollback step, `end` before the final
> reply. **Final output ordering:** the status readout must be the LAST turn, with
> no tool calls after it (openclaw returns only the final turn's text).

Thin discoverability wrapper over `scripts/firebase-rollback.sh` — the Firebase
analog of conversational-assistant's daemon `/rollback`. The **script is the
load-bearing recovery tool**: dumb, deterministic, LLM-independent, so if tooling
is wedged you run `.claude/skills/firebase-rollback/scripts/firebase-rollback.sh`
straight from a shell. This skill just helps pick the target and reports.

Rollback is **code-only**: it checks out the target commit, then redeploys the
way `/deploy` would — **delegate mode** (run `deploy.json`'s `deployCommands`,
e.g. Insem's `scripts/deploy.sh`, which does env-swap + build + deploy as one
unit) or **assemble mode** (run `buildCommands` then `firebase deploy --only`,
e.g. HabitTracker/MediaTracker). It uses the **current** `deploy.json` recipe
(like conv-assistant copies the current restart logic — never the target's
possibly-buggy build), then restores your branch.
Firestore **rules/indexes/data are NOT rolled back** by default; if the rollback
span crossed a schema/data-shaping file the script BLOCKS until you pass
`--data-ack` (guards the CONFIG-AS-CODE DRIFT failure — an older `indexes.json`
redeploy silently deletes newer indexes).

Requires the project's `.claude/deploy.json` (already present in every Firebase
app — same sidecar `/deploy` reads). No new config to author.

## Usage

```
/firebase-rollback <env> <sha|last-good>     # e.g. staging 7192172, or: staging last-good
/firebase-rollback                            # show recent deploys, then ask target
```

Under the hood:
```
scripts/firebase-rollback.sh [options] <env> <sha|last-good>
  --stash            stash a dirty tree before checkout
  --with-firestore   include firestore rules+indexes in the deploy (default: excluded)
  --data-ack         acknowledge a crossed schema/data boundary
  --confirm <TOKEN>  required for a prod env (TOKEN = the projectId)
  --run-tests        run testCommands before deploy (default: skip)
  --dry-run          print the resolved checkout/build/deploy commands, run nothing
```

## Steps

### 1. Pick the target (if none given)
- `git tag -l 'deploy/*' --sort=-creatordate | head` (if the project tags deploys)
  and `tail -15 DEPLOYMENTS.md` — the deploy log (date · env · commit · services · notes).
- Present newest-first, ask which commit/tag + which env, or `last-good`. For a
  slow-burn regression, pick a build from **before** the bad behavior started.
- **Always run `--dry-run` first** and show the resolved checkout/build/deploy
  commands + any data-boundary warning, so the user confirms the plan.

### 2. Run the rollback
`pipeline-step.sh start firebase-rollback "Rollback"`, then run **blocking, in-turn**
(hold the turn — never detach under `claude -p`):

```bash
scripts/firebase-rollback.sh [--stash] [--with-firestore] [--data-ack] \
  [--confirm <projectId>] <env> <target>
```

- Prod requires `--confirm <projectId>` — never roll prod back without explicit intent.
- If it exits 6 (data boundary), surface the listed files, help the user audit the
  diff, and only re-run with `--data-ack` once they confirm the plan for the data.
- It restores the original branch on exit (even on failure). `fail` the step on a
  non-zero exit; don't retry blindly.

### 3. Report
`pipeline-step.sh done firebase-rollback "Rollback"` then `end` BEFORE the final
reply. Report: env + projectId, the pinned short-sha, the deploy scope, and the
Firestore-not-rolled-back reminder. If the target crossed a boundary and you used
`--data-ack`, restate what data still needs manual attention.

## Tests
`scripts/firebase-rollback.test.sh` — fake git repo + fake `firebase` (FIREBASE_BIN
seam), no network. Run: `bash scripts/firebase-rollback.test.sh`.

## What this does NOT do
- Roll back Firestore **data** (code only — audit manually if the span crosses a migration).
- Roll back Firestore rules/indexes unless `--with-firestore` is passed.
- Force-delete branches or rewrite history.
- Run the full quality-gate pipeline (tests skipped by default; build is never skipped).
