#!/usr/bin/env bash
# Unit/integration tests for firebase-rollback.sh.
# Fake git repo + fake `firebase` (FIREBASE_BIN seam). No network, no real deploy.
# Run: bash firebase-rollback.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/firebase-rollback.sh"
PASS=0; FAIL=0
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n     %s\n' "$1" "$2"; }
aeq() { [[ "$2" == "$3" ]] && ok "$1" || bad "$1" "expected '$3' got '$2'"; }
ahas(){ [[ "$2" == *"$3"* ]] && ok "$1" || bad "$1" "'$3' not in output"; }
aabs(){ [[ "$2" != *"$3"* ]] && ok "$1" || bad "$1" "'$3' unexpectedly present"; }
abefore(){ # name haystack A B : A must appear before B
	local h="$2" a="$3" b="$4"; local ia="${h%%$a*}" ib="${h%%$b*}"
	[[ "$h" == *"$a"* && "$h" == *"$b"* && "${#ia}" -lt "${#ib}" ]] && ok "$1" || bad "$1" "'$a' not before '$b'"
}

# Fake `firebase`, kept OUTSIDE any repo so it never dirties the working tree.
FAKE_FB="$(mktemp)"
cat > "$FAKE_FB" <<'EOF'
#!/usr/bin/env bash
echo "FIREBASE-DEPLOY $*"
exit "${FIREBASE_RC:-0}"
EOF
chmod +x "$FAKE_FB"

DEPLOY_JSON_BODY='{
  "platform": "firebase",
  "projectName": "TestApp",
  "environments": {
    "staging": { "alias": "staging", "projectId": "test-staging", "nonprod": true },
    "default": { "alias": "default", "projectId": "test-prod", "prod": true }
  },
  "services": ["hosting", "functions", "firestore"],
  "testCommands": ["echo TESTS-RAN"],
  "buildCommands": {
    "nonprod": ["echo BUILD-NONPROD"],
    "prod": ["echo BUILD-PROD"]
  }
}'

# Build a fixture app. Commits: A (no indexes) → B (adds firestore.indexes.json)
# → C=HEAD. Rolling to A crosses the indexes boundary; rolling to B does not.
# DEPLOYMENTS.md lists B's sha (newest, != HEAD) for last-good.
mkapp() {
	local d; d="$(mktemp -d)"
	( cd "$d" && git init -q && git checkout -qb main
	  mkdir -p .claude
	  printf '%s\n' "$DEPLOY_JSON_BODY" > .claude/deploy.json
	  echo A > app.txt; git add -A
	  GIT_AUTHOR_DATE="2026-01-01T00:00:00" GIT_COMMITTER_DATE="2026-01-01T00:00:00" git commit -qm A
	  local sa; sa="$(git rev-parse --short HEAD)"
	  echo '{"indexes":[]}' > firestore.indexes.json; echo B > app.txt; git add -A
	  GIT_AUTHOR_DATE="2026-01-02T00:00:00" GIT_COMMITTER_DATE="2026-01-02T00:00:00" git commit -qm B
	  local sb; sb="$(git rev-parse --short HEAD)"
	  { echo "# Deployments";
	    echo "| 2026-01-01 00:00 | staging | \`$sa\` | main | hosting | A |";
	    echo "| 2026-01-02 00:00 | staging | \`$sb\` | main | hosting + functions | B |"; } > DEPLOYMENTS.md
	  echo C > app.txt; git add -A
	  GIT_AUTHOR_DATE="2026-01-03T00:00:00" GIT_COMMITTER_DATE="2026-01-03T00:00:00" git commit -qm C
	) >/dev/null 2>&1
	echo "$d"
}

sha_of() { ( cd "$1" && git rev-parse --short "$2" ); }   # <app> <rev>
run() { local d="$1"; shift; ( cd "$d" && FIREBASE_BIN="$FAKE_FB" bash "$SCRIPT" "$@" ) 2>&1; }

echo "firebase-rollback.test.sh"

# ── usage / arg parse ────────────────────────────────────────────────────────
app="$(mkapp)"
r="$(run "$app")"; aeq "no args → exit 2" "$?" "2"; ahas "no args → usage" "$r" "usage:"
r="$(run "$app" staging)"; aeq "one arg → exit 2" "$?" "2"
r="$(run "$app" staging x y)"; aeq "three args → exit 2" "$?" "2"
r="$(run "$app" --bogus staging HEAD~1)"; aeq "unknown flag → exit 2" "$?" "2"; ahas "unknown flag → msg" "$r" "unknown flag"

# ── env / target resolution ──────────────────────────────────────────────────
r="$(run "$app" nope HEAD~1)"; aeq "unknown env → exit 4" "$?" "4"; ahas "unknown env → lists keys" "$r" "staging"
r="$(run "$app" staging deadbeef)"; aeq "unknown sha → exit 4" "$?" "4"; ahas "unknown sha → msg" "$r" "no such commit"

# ── happy path: staging rollback to B (no boundary) ──────────────────────────
B="$(sha_of "$app" HEAD~1)"
r="$(run "$app" staging "$B")"; rc=$?
aeq  "staging→B exit 0" "$rc" "0"
ahas "staging→B deploy ran" "$r" "FIREBASE-DEPLOY"
ahas "staging→B project" "$r" "--project test-staging"
ahas "staging→B scope excludes firestore" "$r" "--only hosting,functions"
aabs "staging→B firestore not in scope" "$r" "hosting,functions,firestore"
ahas "staging→B build ran (HEAD recipe)" "$r" "BUILD-NONPROD"
abefore "staging→B build before deploy" "$r" "BUILD-NONPROD" "FIREBASE-DEPLOY"
aeq  "staging→B restored to main" "$(cd "$app" && git symbolic-ref --short HEAD)" "main"
aabs "staging→B tests skipped by default" "$r" "TESTS-RAN"

# ── --with-firestore includes firestore ──────────────────────────────────────
app="$(mkapp)"; B="$(sha_of "$app" HEAD~1)"
r="$(run "$app" --with-firestore staging "$B")"
ahas "--with-firestore → firestore in scope" "$r" "--only hosting,functions,firestore"

# ── --run-tests runs testCommands before build ───────────────────────────────
app="$(mkapp)"; B="$(sha_of "$app" HEAD~1)"
r="$(run "$app" --run-tests staging "$B")"
ahas "--run-tests → tests ran" "$r" "TESTS-RAN"
abefore "--run-tests → tests before build" "$r" "TESTS-RAN" "BUILD-NONPROD"

# ── data boundary: rolling to A crosses indexes.json ─────────────────────────
app="$(mkapp)"; A="$(sha_of "$app" HEAD~2)"
r="$(run "$app" staging "$A")"; rc=$?
aeq  "boundary → exit 6" "$rc" "6"
ahas "boundary → names indexes file" "$r" "firestore.indexes.json"
aabs "boundary → deploy never ran" "$r" "FIREBASE-DEPLOY"
aeq  "boundary → HEAD unchanged" "$(cd "$app" && git symbolic-ref --short HEAD)" "main"
# with --data-ack it proceeds
r="$(run "$app" --data-ack staging "$A")"; rc=$?
aeq  "boundary + --data-ack → exit 0" "$rc" "0"
ahas "boundary + --data-ack → deploy ran" "$r" "FIREBASE-DEPLOY"

# ── prod confirm guard ───────────────────────────────────────────────────────
app="$(mkapp)"; B="$(sha_of "$app" HEAD~1)"
r="$(run "$app" default "$B")"; aeq "prod no --confirm → exit 9" "$?" "9"; ahas "prod → asks for token" "$r" "--confirm test-prod"
r="$(run "$app" --confirm wrong default "$B")"; aeq "prod wrong token → exit 9" "$?" "9"
r="$(run "$app" --confirm test-prod default "$B")"; rc=$?
aeq  "prod correct token → exit 0" "$rc" "0"
ahas "prod → BUILD-PROD recipe" "$r" "BUILD-PROD"
ahas "prod → project" "$r" "--project test-prod"

# ── dirty tree ───────────────────────────────────────────────────────────────
app="$(mkapp)"; B="$(sha_of "$app" HEAD~1)"; echo dirty >> "$app/app.txt"
r="$(run "$app" staging "$B")"; rc=$?
aeq  "dirty no --stash → exit 5" "$rc" "5"
aabs "dirty → no deploy" "$r" "FIREBASE-DEPLOY"
r="$(run "$app" --stash staging "$B")"; rc=$?
aeq  "dirty --stash → exit 0" "$rc" "0"
ahas "dirty --stash → stashed msg" "$r" "stashed dirty tree"
ahas "dirty --stash → deploy ran" "$r" "FIREBASE-DEPLOY"

# ── deploy failure rc propagates + branch restored ───────────────────────────
app="$(mkapp)"; B="$(sha_of "$app" HEAD~1)"
r="$( cd "$app" && FIREBASE_RC=1 FIREBASE_BIN="$FAKE_FB" bash "$SCRIPT" staging "$B" 2>&1 )"; rc=$?
aeq  "deploy rc=1 → propagated" "$rc" "1"
ahas "deploy fail → reported" "$r" "deploy FAILED (rc=1)"
aeq  "deploy fail → restored to main" "$(cd "$app" && git symbolic-ref --short HEAD)" "main"

# ── sha == HEAD → redeploy in place ──────────────────────────────────────────
app="$(mkapp)"; H="$(sha_of "$app" HEAD)"
r="$(run "$app" staging "$H")"; rc=$?
aeq  "sha==HEAD → exit 0" "$rc" "0"; ahas "sha==HEAD → in place" "$r" "redeploying in place"

# ── last-good picks newest DEPLOYMENTS sha != HEAD (= B) ──────────────────────
app="$(mkapp)"; B="$(sha_of "$app" HEAD~1)"
r="$(run "$app" staging last-good)"; rc=$?
aeq  "last-good → exit 0" "$rc" "0"; ahas "last-good → deploy ran" "$r" "FIREBASE-DEPLOY"

# ── dry-run: prints plan, executes nothing ───────────────────────────────────
app="$(mkapp)"; B="$(sha_of "$app" HEAD~1)"
r="$(run "$app" --dry-run staging "$B")"; rc=$?
aeq  "dry-run → exit 0" "$rc" "0"
ahas "dry-run → checkout line" "$r" "git checkout --detach"
ahas "dry-run → deploy command text" "$r" "deploy --only hosting,functions --project test-staging"
aabs "dry-run → nothing executed" "$r" "FIREBASE-DEPLOY"
aeq  "dry-run → HEAD unchanged" "$(cd "$app" && git symbolic-ref --short HEAD)" "main"

# ── version-skew: build recipe comes from HEAD, not the target commit ─────────
app="$(mktemp -d)"
( cd "$app" && git init -q && git checkout -qb main && mkdir .claude
  printf '%s' '{"platform":"firebase","environments":{"staging":{"projectId":"vs","nonprod":true}},"services":["hosting"],"buildCommands":{"nonprod":["echo BUILD-FROM-TARGET"]}}' > .claude/deploy.json
  echo A>app.txt; git add -A; git commit -qm A
  # HEAD changes the build recipe:
  printf '%s' '{"platform":"firebase","environments":{"staging":{"projectId":"vs","nonprod":true}},"services":["hosting"],"buildCommands":{"nonprod":["echo BUILD-FROM-HEAD"]}}' > .claude/deploy.json
  echo B>app.txt; git add -A; git commit -qm B
  ) >/dev/null 2>&1
TA="$(sha_of "$app" HEAD~1)"
r="$(run "$app" staging "$TA")"
ahas "version-skew → HEAD build recipe used" "$r" "BUILD-FROM-HEAD"
aabs "version-skew → target recipe NOT used" "$r" "BUILD-FROM-TARGET"

# ── schema drift: services null → derive from firebase.json ──────────────────
app="$(mktemp -d)"
( cd "$app" && git init -q && git checkout -qb main && mkdir .claude
  printf '%s' '{"platform":"firebase","environments":{"staging":{"projectId":"d","nonprod":true}},"services":null,"buildCommands":{"staging":["echo BUILD-STAGING"]}}' > .claude/deploy.json
  printf '%s' '{"hosting":{},"functions":[],"firestore":{},"emulators":{}}' > firebase.json
  echo A>app.txt; git add -A; git commit -qm A
  echo B>app.txt; git add -A; git commit -qm B ) >/dev/null 2>&1
T="$(sha_of "$app" HEAD~1)"
r="$(run "$app" staging "$T")"; rc=$?
aeq  "services null → exit 0" "$rc" "0"
ahas "services null → scope from firebase.json (firestore excluded)" "$r" "--only functions,hosting"
ahas "env-keyed buildCommands used" "$r" "BUILD-STAGING"

# ── no-build warning: empty build + gitignored hosting output → WARN ─────────
app="$(mktemp -d)"
( cd "$app" && git init -q && git checkout -qb main && mkdir .claude
  printf '%s' '{"platform":"firebase","environments":{"dev":{"projectId":"d","nonprod":true}},"services":["hosting"],"buildCommands":{"nonprod":[],"prod":[]}}' > .claude/deploy.json
  printf '%s' '{"hosting":{"public":"dist"}}' > firebase.json
  echo "dist/" > .gitignore; mkdir dist; echo x > dist/index.html
  echo A>app.txt; git add -A; git commit -qm A
  echo B>app.txt; git add -A; git commit -qm B ) >/dev/null 2>&1
T="$(sha_of "$app" HEAD~1)"
r="$(run "$app" dev "$T")"; rc=$?
aeq  "empty build + built hosting → exit 0" "$rc" "0"
ahas "empty build + built hosting → warns" "$r" "WARNING: no buildCommands"
ahas "empty build + built hosting → still deploys" "$r" "FIREBASE-DEPLOY"

# ── no-build but committed-static hosting → NO warning (MediaTracker case) ────
app="$(mktemp -d)"
( cd "$app" && git init -q && git checkout -qb main && mkdir .claude
  printf '%s' '{"platform":"firebase","environments":{"dev":{"projectId":"d","nonprod":true}},"services":["hosting"],"buildCommands":{"nonprod":[],"prod":[]}}' > .claude/deploy.json
  printf '%s' '{"hosting":{"public":"public"}}' > firebase.json
  mkdir public; echo x > public/index.html
  echo A>app.txt; git add -A; git commit -qm A
  echo B>app.txt; git add -A; git commit -qm B ) >/dev/null 2>&1
T="$(sha_of "$app" HEAD~1)"
r="$(run "$app" dev "$T")"; rc=$?
aeq  "committed static → exit 0" "$rc" "0"
aabs "committed static → no false warning" "$r" "WARNING: no buildCommands"
ahas "committed static → deploys" "$r" "FIREBASE-DEPLOY"

# ── delegate mode: deployCommands present → run them, not firebase deploy ────
mkdelegate() {
	local d; d="$(mktemp -d)"
	( cd "$d" && git init -q && git checkout -qb main && mkdir .claude
	  printf '%s' '{"platform":"firebase","environments":{"staging":{"projectId":"del","nonprod":true},"production":{"projectId":"delp","prod":true}},"deployCommands":{"staging":["echo DELEGATE-RAN staging"],"production":["echo DELEGATE-RAN prod"]}}' > .claude/deploy.json
	  echo A>app.txt; git add -A; git commit -qm A
	  echo B>app.txt; git add -A; git commit -qm B ) >/dev/null 2>&1
	echo "$d"
}
app="$(mkdelegate)"; B="$(sha_of "$app" HEAD~1)"
r="$(run "$app" staging "$B")"; rc=$?
aeq  "delegate → exit 0" "$rc" "0"
ahas "delegate → runs deployCommands" "$r" "DELEGATE-RAN staging"
aabs "delegate → no assembled firebase deploy" "$r" "FIREBASE-DEPLOY"
ahas "delegate → reports via deployCommands" "$r" "via deployCommands"
aeq  "delegate → restored to main" "$(cd "$app" && git symbolic-ref --short HEAD)" "main"
# dry-run shows delegate method
r="$(run "$app" --dry-run staging "$B")"
ahas "delegate dry-run → method" "$r" "method=delegate"
ahas "delegate dry-run → deploy line" "$r" "deploy: echo DELEGATE-RAN staging"
# delegate failure propagates + restores branch
app="$(mkdelegate)"; B="$(sha_of "$app" HEAD~1)"
( cd "$app" && printf '%s' '{"platform":"firebase","environments":{"staging":{"projectId":"del","nonprod":true}},"deployCommands":{"staging":["exit 4"]}}' > .claude/deploy.json && git commit -qam patch ) >/dev/null 2>&1
B="$(sha_of "$app" HEAD~1)"
r="$(run "$app" staging "$B")"; rc=$?
aeq  "delegate fail → rc propagated" "$rc" "4"
aeq  "delegate fail → restored to main" "$(cd "$app" && git symbolic-ref --short HEAD)" "main"

# ── platform guard ───────────────────────────────────────────────────────────
app="$(mktemp -d)"
( cd "$app" && git init -q && git checkout -qb main && mkdir .claude
  printf '%s' '{"platform":"gcp-run","environments":{}}' > .claude/deploy.json
  echo A>a; git add -A; git commit -qm A ) >/dev/null 2>&1
r="$( cd "$app" && bash "$SCRIPT" staging HEAD 2>&1 )"; aeq "non-firebase platform → exit 3" "$?" "3"

echo ""
echo "firebase-rollback.test.sh: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
