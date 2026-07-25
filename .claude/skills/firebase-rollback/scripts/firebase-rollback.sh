#!/usr/bin/env bash
# firebase-rollback.sh — code-only rollback of a Firebase app to a prior deploy.
#
# Model (mirrors conversational-assistant/scripts/aide-rollback.sh, deploy
# primitive swapped): pick a target commit → git checkout → redeploy from
# .claude/deploy.json → restore the original branch. Redeploy is either
# DELEGATE (run deploy.json's deployCommands, e.g. Insem's scripts/deploy.sh) or
# ASSEMBLE (run buildCommands then `firebase deploy --only`), mirroring /deploy.
# Reverts CODE ONLY. Firestore rules/indexes/data are NOT rolled back (default
# scope excludes firestore); if the span crossed a rules/indexes/migration
# change the script BLOCKS until you pass --data-ack.
#
# Dumb + LLM-independent by design: run it straight from a shell in an outage.
#
# Usage: firebase-rollback.sh [options] <env> <sha | last-good>
#   <env>            environment key from .claude/deploy.json (e.g. staging, default)
#   <sha|last-good>  target commit; last-good = newest successful deploy in
#                    DEPLOYMENTS.md whose commit isn't current HEAD.
#
# Options:
#   --stash            stash a dirty working tree before checkout
#   --with-firestore   include firestore (rules+indexes) in the deploy scope
#                      (default: firestore EXCLUDED — hosting+functions only;
#                       ignored in delegate mode, where deployCommands set scope)
#   --data-ack         acknowledge a schema/data boundary was crossed; required
#                      to proceed when the span touches rules/indexes/migrations
#   --confirm <TOKEN>  required for a prod env; TOKEN must equal the projectId
#   --run-tests        run deploy.json testCommands before deploy (assemble mode)
#   --dry-run          resolve + print the checkout/build/deploy commands, run nothing
#   -h | --help
#
# Exit codes:
#   0 ok · 2 usage · 3 no repo / no deploy.json · 4 unresolved target/env ·
#   5 dirty tree · 6 data boundary (needs --data-ack) · 7 checkout failed ·
#   8 build/tests failed · 9 prod confirm missing/wrong ·
#   (the deploy step's own rc is propagated when the deploy itself fails).
#
# Test seams (override in firebase-rollback.test.sh):
#   ROLLBACK_DEPLOY_JSON   path to deploy.json    (default <repo>/.claude/deploy.json)
#   ROLLBACK_DEPLOYMENTS   DEPLOYMENTS.md path     (default <repo>/DEPLOYMENTS.md)
#   ROLLBACK_FIREBASE_JSON path to firebase.json  (default <repo>/firebase.json)
#   FIREBASE_BIN           firebase CLI            (default: firebase)
set -uo pipefail

say()  { printf '%s\n' "$*" >&2; }
die()  { local code="$1"; shift; say "firebase-rollback: $*"; exit "$code"; }

usage() {
	cat >&2 <<'EOF'
usage: firebase-rollback.sh [options] <env> <sha | last-good>
  Code-only rollback of a Firebase app: checkout target → rebuild → firebase deploy.
  <env>            environment key from .claude/deploy.json (e.g. staging, default)
  <sha|last-good>  target commit (last-good = newest DEPLOYMENTS.md deploy != HEAD)
options:
  --stash            stash a dirty tree before checkout
  --with-firestore   include firestore rules+indexes in the deploy (default: excluded)
  --data-ack         acknowledge a crossed schema/data boundary
  --confirm <TOKEN>  required for prod (TOKEN must equal the projectId)
  --run-tests        run testCommands before deploy (default: skip)
  --dry-run          print the resolved commands, run nothing
EOF
}

# ── arg parse ────────────────────────────────────────────────────────────────
STASH=0; WITH_FS=0; DATA_ACK=0; RUN_TESTS=0; DRY=0; CONFIRM=""
ENV_KEY=""; TARGET=""
positional=()
while (($#)); do
	case "$1" in
		--stash) STASH=1 ;;
		--with-firestore) WITH_FS=1 ;;
		--data-ack) DATA_ACK=1 ;;
		--run-tests) RUN_TESTS=1 ;;
		--dry-run) DRY=1 ;;
		--confirm) shift; [[ $# -gt 0 ]] || { usage; exit 2; }; CONFIRM="$1" ;;
		-h|--help) usage; exit 2 ;;
		--) shift; while (($#)); do positional+=("$1"); shift; done; break ;;
		-*) say "unknown flag '$1'"; usage; exit 2 ;;
		*) positional+=("$1") ;;
	esac
	shift
done
((${#positional[@]} == 2)) || { usage; exit 2; }
ENV_KEY="${positional[0]}"; TARGET="${positional[1]}"

# ── repo + deploy.json ───────────────────────────────────────────────────────
REPO="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[[ -n "$REPO" ]] || die 3 "not inside a git repository"
DEPLOY_JSON="${ROLLBACK_DEPLOY_JSON:-$REPO/.claude/deploy.json}"
DEPLOYMENTS="${ROLLBACK_DEPLOYMENTS:-$REPO/DEPLOYMENTS.md}"
FIREBASE_BIN="${FIREBASE_BIN:-firebase}"
[[ -f "$DEPLOY_JSON" ]] || die 3 "no deploy.json at $DEPLOY_JSON"
command -v jq >/dev/null 2>&1 || die 3 "jq is required but not installed"

jqr() { jq -r "$@" "$DEPLOY_JSON" 2>/dev/null; }

PLATFORM="$(jqr '.platform // empty')"
[[ "$PLATFORM" == "firebase" ]] || die 3 "deploy.json platform is '${PLATFORM:-unset}', not 'firebase'"

# ── resolve env → projectId, prod flag, build key ────────────────────────────
PROJECT_ID="$(jqr --arg e "$ENV_KEY" '.environments[$e].projectId // empty')"
[[ -n "$PROJECT_ID" ]] || die 4 "no environment '$ENV_KEY' in deploy.json (have: $(jqr '.environments|keys|join(", ")'))"
IS_PROD="$(jqr --arg e "$ENV_KEY" '.environments[$e].prod // false')"
BUILD_KEY=nonprod; [[ "$IS_PROD" == "true" ]] && BUILD_KEY=prod

# prod guard
if [[ "$IS_PROD" == "true" ]]; then
	[[ -n "$CONFIRM" ]] || die 9 "env '$ENV_KEY' is PROD — pass --confirm $PROJECT_ID to proceed"
	[[ "$CONFIRM" == "$PROJECT_ID" ]] || die 9 "prod confirm token mismatch (expected the projectId)"
fi

# ── resolve target commit ────────────────────────────────────────────────────
resolve_last_good() {
	[[ -f "$DEPLOYMENTS" ]] || return 1
	local head_short; head_short="$(git rev-parse --short HEAD 2>/dev/null)"
	# Table rows: | date | env | `sha`(dirty?) | branch | services | notes |
	# Newest is at the bottom → walk rows bottom-up, first sha != HEAD wins.
	local shas; shas="$(awk -F'|' '
		/^\|/ && $2 ~ /[0-9]{4}-[0-9]{2}-[0-9]{2}/ {
			s=$4; gsub(/`/,"",s); gsub(/\(dirty\)/,"",s); gsub(/[[:space:]]/,"",s);
			if (s ~ /^[0-9a-fA-F]{7,40}$/) print s
		}' "$DEPLOYMENTS")"
	[[ -n "$shas" ]] || return 1
	local s
	while IFS= read -r s; do [[ -n "$s" ]] && printf '%s\n' "$s"; done <<< "$shas" \
		| tac | while IFS= read -r s; do
			local rs; rs="$(git rev-parse --verify --quiet "${s}^{commit}" 2>/dev/null || true)"
			[[ -z "$rs" ]] && continue
			[[ "$(git rev-parse --short "$rs")" == "$head_short" ]] && continue
			printf '%s\n' "$rs"; return 0
		  done
	return 1
}

if [[ "$TARGET" == "last-good" ]]; then
	TARGET_SHA="$(resolve_last_good || true)"
	[[ -n "$TARGET_SHA" ]] || die 4 "last-good: no prior successful deploy found in DEPLOYMENTS.md — pass an explicit sha"
else
	TARGET_SHA="$(git rev-parse --verify --quiet "${TARGET}^{commit}" 2>/dev/null || true)"
	[[ -n "$TARGET_SHA" ]] || die 4 "no such commit/tag: '$TARGET'"
fi
HEAD_SHA="$(git rev-parse HEAD 2>/dev/null || true)"
TARGET_SHORT="$(git rev-parse --short "$TARGET_SHA")"

# ── data-boundary detection (rules / indexes / migrations in target..HEAD) ───
BOUNDARY_FILES="$(git diff --name-only "$TARGET_SHA" "$HEAD_SHA" -- \
	firestore.rules firestore.indexes.json \
	'*migrations/*' 'scripts/migrations/*' 'functions/**/migrations/*' 2>/dev/null || true)"

# ── resolve deploy method: delegate vs assemble (mirror what /deploy does) ────
# If deploy.json defines deployCommands for this env (kind=local-script, e.g.
# Insem's scripts/deploy.sh), the rollback checks out the target and runs THOSE
# — they do the env-swap + build + firebase deploy as one unit, single source of
# truth. Otherwise assemble the deploy from services + buildCommands (HabitTracker,
# MediaTracker). No deploy.json transcription needed either way.
mapfile -t DEPLOY_CMDS < <(jqr --arg e "$ENV_KEY" '.deployCommands[$e][]?')
mapfile -t TEST_CMDS   < <(jqr '.testCommands[]?')
DELEGATE=0; ((${#DEPLOY_CMDS[@]})) && DELEGATE=1

ONLY=""; NO_BUILD_WARN=""; BUILD_CMDS=()
if (( ! DELEGATE )); then
	# deploy.json.services is the source of truth; if null/absent, derive the
	# deployable targets from firebase.json's top-level keys (Insem leaves it null,
	# but Insem is delegate-mode so this only bites a genuinely-misconfigured app).
	mapfile -t SERVICES < <(jqr '.services[]?')
	if ((${#SERVICES[@]} == 0)); then
		FIREBASE_JSON="${ROLLBACK_FIREBASE_JSON:-$REPO/firebase.json}"
		[[ -f "$FIREBASE_JSON" ]] && mapfile -t SERVICES < <(jq -r \
			'keys[] | select(. == "hosting" or . == "functions" or . == "firestore" or . == "storage")' \
			"$FIREBASE_JSON" 2>/dev/null)
	fi
	only_parts=()
	for s in "${SERVICES[@]}"; do
		if [[ "$s" == "firestore" ]]; then (( WITH_FS )) && only_parts+=("firestore"); else only_parts+=("$s"); fi
	done
	((${#only_parts[@]})) || die 4 "no deployable services resolved from deploy.json"
	ONLY="$(IFS=,; echo "${only_parts[*]}")"

	# buildCommands may be keyed by env-name or by nonprod/prod — env-name first.
	mapfile -t BUILD_CMDS < <(jqr --arg e "$ENV_KEY" --arg k "$BUILD_KEY" '(.buildCommands[$e] // .buildCommands[$k] // [])[]?')

	# No build recipe + a hosting target whose public dir is a git-IGNORED build
	# output = risk of shipping stale hosting. Only warn then — committed static
	# assets (MediaTracker) or no hosting in scope is fine empty.
	if ((${#BUILD_CMDS[@]} == 0)) && [[ ",$ONLY," == *",hosting,"* ]]; then
		FIREBASE_JSON="${ROLLBACK_FIREBASE_JSON:-$REPO/firebase.json}"
		pub=""
		[[ -f "$FIREBASE_JSON" ]] && pub="$(jq -r '(.hosting | if type=="array" then .[0] else . end | .public) // empty' "$FIREBASE_JSON" 2>/dev/null)"
		if [[ -n "$pub" ]] && git check-ignore -q "$pub" 2>/dev/null; then
			NO_BUILD_WARN="WARNING: no buildCommands for '$ENV_KEY' but hosting.public ('$pub') is a git-ignored build output — this deploy may ship STALE hosting. Populate deploy.json.buildCommands, or rebuild manually before rolling back."
		fi
	fi
	DEPLOY_CMD="$FIREBASE_BIN deploy --only $ONLY --project $PROJECT_ID --non-interactive"
fi

# ── dry-run: print the plan, run nothing ─────────────────────────────────────
if (( DRY )); then
	echo "# firebase-rollback --dry-run"
	echo "env=$ENV_KEY project=$PROJECT_ID prod=$IS_PROD target=$TARGET_SHORT method=$([[ $DELEGATE == 1 ]] && echo delegate || echo assemble)"
	echo "git checkout --detach $TARGET_SHORT"
	if (( DELEGATE )); then
		for c in "${DEPLOY_CMDS[@]}"; do echo "deploy: $c"; done
	else
		if (( RUN_TESTS )); then for c in "${TEST_CMDS[@]}"; do echo "test: $c"; done; fi
		for c in "${BUILD_CMDS[@]}"; do echo "build: $c"; done
		[[ -n "$NO_BUILD_WARN" ]] && echo "$NO_BUILD_WARN"
		echo "$DEPLOY_CMD"
	fi
	if [[ -n "$BOUNDARY_FILES" ]]; then
		echo "DATA-BOUNDARY: span touches — $(echo "$BOUNDARY_FILES" | tr '\n' ' ')(needs --data-ack for a real run)"
	fi
	exit 0
fi

# ── data-boundary block ──────────────────────────────────────────────────────
if [[ -n "$BOUNDARY_FILES" && "$DATA_ACK" != "1" ]]; then
	say "DATA BOUNDARY: rolling $TARGET_SHORT..HEAD crosses schema/data-shaping files:"
	while IFS= read -r f; do [[ -n "$f" ]] && say "    $f"; done <<< "$BOUNDARY_FILES"
	say "Rolling code back over these may break live data (e.g. an older indexes.json"
	say "redeploy DELETES newer indexes). Audit the diff, then re-run with --data-ack."
	exit 6
fi

# ── dirty-tree guard ─────────────────────────────────────────────────────────
if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
	if (( STASH )); then
		git stash push -u -m "firebase-rollback-$(git rev-parse --short HEAD)" >&2 \
			|| die 5 "stash failed"
		say "stashed dirty tree — recover later with 'git stash pop'"
	else
		say "working tree is dirty — commit or stash first (or pass --stash):"
		git status --porcelain >&2
		exit 5
	fi
fi

# ── save current ref; restore it on ANY exit (deploy failure, SIGINT, etc.) ──
ORIG_REF="$(git symbolic-ref -q --short HEAD 2>/dev/null || git rev-parse HEAD 2>/dev/null)"
restore() { local r=$?; [[ -n "$ORIG_REF" ]] && git checkout -q "$ORIG_REF" 2>/dev/null; return $r; }
trap restore EXIT INT TERM

# ── checkout target ──────────────────────────────────────────────────────────
if [[ "$TARGET_SHA" == "$HEAD_SHA" ]]; then
	say "already at $TARGET_SHORT — redeploying in place"
else
	git checkout -q --detach "$TARGET_SHA" 2>/dev/null || die 7 "checkout of $TARGET_SHORT failed"
fi

# ── deploy: delegate to the project's deploy commands, or assemble it here ────
if (( DELEGATE )); then
	rc=0
	for c in "${DEPLOY_CMDS[@]}"; do say "+ deploy: $c"; bash -c "$c" >&2 || { rc=$?; break; }; done
else
	if (( RUN_TESTS )); then
		for c in "${TEST_CMDS[@]}"; do say "+ test: $c"; bash -c "$c" >&2 || die 8 "tests failed: $c"; done
	fi
	[[ -n "$NO_BUILD_WARN" ]] && say "$NO_BUILD_WARN"
	for c in "${BUILD_CMDS[@]}"; do say "+ build: $c"; bash -c "$c" >&2 || die 8 "build failed: $c"; done
	say "+ $DEPLOY_CMD"
	"$FIREBASE_BIN" deploy --only "$ONLY" --project "$PROJECT_ID" --non-interactive >&2
	rc=$?
fi

# ── report (branch is restored by the trap on exit) ──────────────────────────
echo ""
if (( rc == 0 )); then
	if (( DELEGATE )); then
		echo "firebase-rollback: deployed $ENV_KEY ($PROJECT_ID) at $TARGET_SHORT via deployCommands"
	else
		echo "firebase-rollback: deployed $ENV_KEY ($PROJECT_ID) at $TARGET_SHORT — scope: $ONLY"
	fi
else
	echo "firebase-rollback: deploy FAILED (rc=$rc) at $TARGET_SHORT — see output above"
fi
echo "firebase-rollback: back on '$ORIG_REF'. FIRESTORE DATA WAS NOT rolled back."
(( ! DELEGATE )) && [[ "$WITH_FS" != "1" ]] && echo "firebase-rollback: firestore rules/indexes were left as-is (not in scope)."
exit "$rc"
