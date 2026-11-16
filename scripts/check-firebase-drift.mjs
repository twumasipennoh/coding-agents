#!/usr/bin/env node
/**
 * check-firebase-drift — hard-blocking pre-deploy diff for the Firebase
 * config-as-code surfaces: `firestore.rules`, `storage.rules`, and
 * `firestore.indexes.json`.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * `.claude/CLAUDE.md` § CONFIG-AS-CODE DRIFT — DEPLOY-TIME DIFF RULE: when a
 * repo file mirrors runtime state, a deploy can silently DELETE server-side
 * state that someone added via the console, or silently FAIL TO CREATE state
 * in one environment so that features there run degraded forever. Both failure
 * modes are invisible: the deploy exits 0 either way.
 *
 * `firebase deploy --only firestore:rules,storage:rules,firestore:indexes`
 * reconciles the live project to these three files. So before it runs, we
 * fetch what is ACTUALLY deployed, normalize it, and ask one question:
 *
 *   IS THE LIVE STATE A VERSION THIS BRANCH'S LINEAGE PRODUCED?
 *
 * The acceptable versions of each file (rules AND indexes, every surface) are:
 *   (a) the file at the baseline ref — `origin/main` by default, overridable
 *       with `--baseline <ref>` or env `DRIFT_BASELINE_REF`;
 *   (b) the file at every commit in `git log <baseline>..HEAD -- <file>` — this
 *       branch's own earlier versions, so a branch that already deployed one
 *       slice's rules can deploy the next slice's later;
 *   (c) the version the baseline replaced (one step back on its first-parent
 *       history) — so deploying from main right after a rules PR merges
 *       (live = the pre-merge version, <baseline>..HEAD empty) passes. Older
 *       versions still block: live rolled back further is a real change;
 *   (d) the working-tree file itself (a no-op redeploy).
 * Live matching any of them (after the normalization below) passes, and the
 * report says which one matched and — informationally — what this deploy will
 * CHANGE. Live matching none is DRIFT (exit 1): someone edited the live project
 * in the console, or another branch deployed. Pull that change back into the
 * repo before shipping over it.
 *
 * Comparing against the working tree alone (the pre-F63 behaviour) made every
 * INTENDED rules change read as drift, so no deliberate deploy could pass.
 * If git is unavailable or the baseline ref is missing (never fetched), the
 * script fails closed with exit 2 — it never falls back to that old check.
 *
 * ---------------------------------------------------------------------------
 * CREDENTIALS
 * ---------------------------------------------------------------------------
 * Per the global CLAUDE.md convention, the service-account JSON lives at
 * `~/.gcp/<firebase-project-id>.json`. This script reads it ONLY to mint a
 * short-lived OAuth access token. It never logs, echoes, or copies the key,
 * and no field of the key (including `client_email`) is printed.
 *
 * ---------------------------------------------------------------------------
 * USAGE
 * ---------------------------------------------------------------------------
 *   node scripts/check-firebase-drift.mjs --project dev
 *   node scripts/check-firebase-drift.mjs --project prod
 *   node scripts/check-firebase-drift.mjs --project dev --baseline origin/some-branch
 *   DRIFT_BASELINE_REF=<ref> npm run deploy:rules:dev
 *
 * Exit codes (all non-zero codes block a deploy):
 *   0  no drift — safe to deploy (includes the nothing-deployed-yet case)
 *   1  DRIFT — live matches no version this branch's lineage produced
 *   2  usage / local config error (bad alias, malformed local file, git
 *      unavailable, baseline ref missing — run `git fetch origin`)
 *   3  credentials missing or rejected
 *   4  permission denied, or a required Google API is disabled
 *   5  network failure
 *   6  unexpected / malformed API response
 */

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EXIT = {
	OK: 0,
	DRIFT: 1,
	USAGE: 2,
	CREDENTIALS: 3,
	PERMISSION: 4,
	NETWORK: 5,
	BAD_RESPONSE: 6,
};

const SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const RULES_API = "https://firebaserules.googleapis.com/v1";
const FIRESTORE_API = "https://firestore.googleapis.com/v1";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DATABASE_ID = "(default)";

// The project being checked is `--repo <dir>` or the cwd — never this script's
// own location: the master copy lives in coding-agents and checks other repos.

/**
 * A failure we can explain. `code` is the process exit code; `hint` is the
 * actionable next step. Per the repo's NoopTracer diagnostic lesson, the real
 * cause has to be legible at the TOP of the output — so every one of these
 * carries its own wording rather than bubbling a generic stack trace.
 */
export class DriftCheckError extends Error {
	constructor(message, { code = EXIT.BAD_RESPONSE, hint = null } = {}) {
		super(message);
		this.name = "DriftCheckError";
		this.code = code;
		this.hint = hint;
	}
}

// ---------------------------------------------------------------------------
// argv + .firebaserc
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
	const out = { alias: null, baseline: null };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--repo") {
			out.repo = argv[i + 1] ?? null;
			i += 1;
		} else if (arg.startsWith("--repo=")) {
			out.repo = arg.slice("--repo=".length);
		} else if (arg === "--project" || arg === "-P") {
			out.alias = argv[i + 1] ?? null;
			i += 1;
		} else if (arg.startsWith("--project=")) {
			out.alias = arg.slice("--project=".length);
		} else if (arg === "--baseline") {
			out.baseline = argv[i + 1] ?? null;
			i += 1;
		} else if (arg.startsWith("--baseline=")) {
			out.baseline = arg.slice("--baseline=".length);
		} else if (arg === "--help" || arg === "-h") {
			out.help = true;
		} else {
			throw new DriftCheckError(`unknown argument: ${arg}`, { code: EXIT.USAGE });
		}
	}
	return out;
}

/**
 * Resolve an alias (`dev` / `prod`) to a real project ID through `.firebaserc`.
 * Never hardcode the IDs — `.firebaserc` is the only place they're declared,
 * and prod's ID is a permanent artifact of the pre-rename era (S0.1).
 */
export function resolveProjectId(firebaserc, alias) {
	if (!alias) {
		throw new DriftCheckError("missing --project <alias>", {
			code: EXIT.USAGE,
			hint: "usage: check-firebase-drift.mjs --project dev|prod",
		});
	}
	const projects = firebaserc?.projects;
	if (!projects || typeof projects !== "object") {
		throw new DriftCheckError(".firebaserc has no `projects` map", { code: EXIT.USAGE });
	}
	const id = projects[alias];
	if (typeof id !== "string" || id.length === 0) {
		const known = Object.keys(projects)
			.filter((k) => k !== "default")
			.sort()
			.join(", ");
		throw new DriftCheckError(`.firebaserc has no project alias "${alias}"`, {
			code: EXIT.USAGE,
			hint: `known aliases: ${known || "(none)"}`,
		});
	}
	return id;
}

// ---------------------------------------------------------------------------
// auth — mint a token from ~/.gcp/<project-id>.json, never read it aloud
// ---------------------------------------------------------------------------

export function keyPathFor(projectId, homeDir = os.homedir()) {
	return path.join(homeDir, ".gcp", `${projectId}.json`);
}

function loadServiceAccountKey(projectId) {
	const keyPath = keyPathFor(projectId);
	if (!fs.existsSync(keyPath)) {
		throw new DriftCheckError(`service-account key not found: ${keyPath}`, {
			code: EXIT.CREDENTIALS,
			hint:
				"The convention is ~/.gcp/<firebase-project-id>.json (mode 0600). " +
				"See ~/.gcp/README.md. Do not substitute GOOGLE_APPLICATION_CREDENTIALS.",
		});
	}
	let key;
	try {
		key = JSON.parse(fs.readFileSync(keyPath, "utf8"));
	} catch {
		// Deliberately does NOT include the parse error or any file content —
		// a malformed key file can leak key material through an error message.
		throw new DriftCheckError(`service-account key at ${keyPath} is not valid JSON`, {
			code: EXIT.CREDENTIALS,
			hint: "Regenerate with `rotate-secret rotate gcp-sa <project-id> --commit`.",
		});
	}
	if (key.type !== "service_account" || !key.private_key || !key.client_email) {
		throw new DriftCheckError(`${keyPath} is not a service_account key file`, {
			code: EXIT.CREDENTIALS,
		});
	}
	return key;
}

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

async function mintAccessToken(key) {
	const iat = Math.floor(Date.now() / 1000);
	const unsigned = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url({
		iss: key.client_email,
		scope: SCOPE,
		aud: TOKEN_URL,
		iat,
		exp: iat + 3600,
	})}`;
	const sig = crypto.createSign("RSA-SHA256").update(unsigned).sign(key.private_key, "base64url");

	let res;
	try {
		res = await fetch(TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
				assertion: `${unsigned}.${sig}`,
			}),
		});
	} catch (err) {
		throw asNetworkError(err, "oauth2.googleapis.com");
	}
	if (!res.ok) {
		// The body here is Google's OAuth error, not our key. Safe to surface;
		// it's the difference between "clock skew" and "deleted service account".
		const body = await safeText(res);
		throw new DriftCheckError(`credential rejected by Google (HTTP ${res.status}): ${body}`, {
			code: EXIT.CREDENTIALS,
			hint:
				"Common causes: the service account was deleted, the key was revoked, " +
				"or the local clock is skewed. Check with `rotate-secret status`.",
		});
	}
	const json = await res.json();
	if (!json.access_token) {
		throw new DriftCheckError("token exchange returned no access_token", {
			code: EXIT.CREDENTIALS,
		});
	}
	return json.access_token;
}

// ---------------------------------------------------------------------------
// HTTP plumbing + error classification
// ---------------------------------------------------------------------------

async function safeText(res) {
	try {
		return (await res.text()).slice(0, 600);
	} catch {
		return "<unreadable body>";
	}
}

export function asNetworkError(err, host) {
	const cause = err?.cause?.code ?? err?.code ?? "";
	return new DriftCheckError(`network failure talking to ${host}${cause ? ` (${cause})` : ""}`, {
		code: EXIT.NETWORK,
		hint: "Check connectivity and retry. This is NOT drift — nothing was compared.",
	});
}

/**
 * Turn an HTTP failure into something a human can act on in one read.
 * Distinguishes the four cases that actually happen: API-not-enabled,
 * permission-denied, unauthenticated, and everything else.
 */
export function classifyHttpError(status, bodyText, what) {
	const body = String(bodyText ?? "");
	if (status === 403 && /SERVICE_DISABLED|has not been used in project|is disabled/i.test(body)) {
		const api = /([a-z]+\.googleapis\.com)/i.exec(body)?.[1] ?? "the required Google API";
		return new DriftCheckError(`${api} is not enabled for this project (needed for ${what})`, {
			code: EXIT.PERMISSION,
			hint: `Enable ${api} in the Google Cloud console, then re-run.`,
		});
	}
	if (status === 403) {
		return new DriftCheckError(`permission denied reading ${what} (HTTP 403)`, {
			code: EXIT.PERMISSION,
			hint:
				"The service account authenticated but lacks the role. Firestore rules/indexes " +
				"need roles/firebaserules.viewer + roles/datastore.viewer (or Editor) on the project.",
		});
	}
	if (status === 401) {
		return new DriftCheckError(`not authenticated reading ${what} (HTTP 401)`, {
			code: EXIT.CREDENTIALS,
			hint: "The access token was rejected. The key may be revoked — see `rotate-secret status`.",
		});
	}
	return new DriftCheckError(`unexpected HTTP ${status} reading ${what}: ${body.slice(0, 300)}`, {
		code: EXIT.BAD_RESPONSE,
	});
}

/**
 * GET a JSON resource. Returns `null` on 404 so callers can tell
 * "nothing deployed yet" apart from "we failed to look".
 */
async function getJson(url, token, what) {
	let res;
	try {
		res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	} catch (err) {
		throw asNetworkError(err, new URL(url).host);
	}
	if (res.status === 404) return null;
	if (!res.ok) throw classifyHttpError(res.status, await safeText(res), what);
	try {
		return await res.json();
	} catch {
		throw new DriftCheckError(`${what} returned a non-JSON body`, { code: EXIT.BAD_RESPONSE });
	}
}

// ---------------------------------------------------------------------------
// NORMALIZERS — rules
// ---------------------------------------------------------------------------

/**
 * Whitespace-normalize a `.rules` source so a trailing newline or a CRLF
 * checkout doesn't read as drift.
 */
export function normalizeRulesSource(text) {
	return String(text ?? "")
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line) => line.replace(/[ \t]+$/, ""))
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * Strip `//` and block comments from a `.rules` source, quote-aware so a
 * `//` inside a string literal survives.
 *
 * Why comments get their own pass instead of being part of the whitespace
 * normalizer: the question this gate asks is "does the LIVE AUTHORIZATION
 * BEHAVIOUR match the repo?" A comment cannot widen access, so a comment-only
 * difference must not block a deploy. But it is still worth SAYING — a live
 * ruleset whose prose lags the repo is a stale ruleset. So the comparison runs
 * on the comment-stripped form (that decides pass/fail) and the verbatim form
 * is checked separately to produce a non-blocking `cosmetic` note.
 *
 * This is not hypothetical: Firebase auto-provisions a default deny-all
 * ruleset when a Firestore database is created. Its RULES are byte-identical
 * to this repo's, but it carries none of the repo's explanatory header — so a
 * comment-sensitive gate would block the very first `deploy:rules:dev`.
 */
export function stripRulesComments(text) {
	const out = [];
	let inBlock = false;
	for (const rawLine of String(text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
		let line = "";
		let quote = null;
		for (let i = 0; i < rawLine.length; i += 1) {
			const c = rawLine[i];
			const next = rawLine[i + 1];
			if (inBlock) {
				if (c === "*" && next === "/") {
					inBlock = false;
					i += 1;
				}
				continue;
			}
			if (quote) {
				line += c;
				if (c === "\\") {
					line += next ?? "";
					i += 1;
				} else if (c === quote) {
					quote = null;
				}
				continue;
			}
			if (c === '"' || c === "'") {
				quote = c;
				line += c;
				continue;
			}
			if (c === "/" && next === "/") break;
			if (c === "/" && next === "*") {
				inBlock = true;
				i += 1;
				continue;
			}
			line += c;
		}
		out.push(line);
	}
	return normalizeRulesSource(out.join("\n"));
}

/**
 * Compare two rulesets. `"drift"` means the authorization logic differs and
 * the deploy must stop; `"cosmetic"` means only comments/whitespace differ.
 */
export function compareRules(repoSource, liveSource) {
	if (stripRulesComments(repoSource) !== stripRulesComments(liveSource)) return "drift";
	return normalizeRulesSource(repoSource) === normalizeRulesSource(liveSource)
		? "match"
		: "cosmetic";
}

// ---------------------------------------------------------------------------
// NORMALIZERS — composite indexes
// ---------------------------------------------------------------------------

// The only attributes `firestore.indexes.json` can express for a composite
// index. Anything else the Admin API returns (`name`, `state`, `density`,
// `multikey`, `shardCount`, ...) is server-side metadata with no repo-side
// counterpart; comparing it would produce permanent, un-fixable drift.
const INDEX_KEYS = new Set(["collectionGroup", "queryScope", "apiScope", "fields"]);
const INDEX_FIELD_KEYS = new Set(["fieldPath", "order", "arrayConfig", "vectorConfig"]);

/** `projects/p/databases/(default)/collectionGroups/items/indexes/CICAgOjK` → `items` */
export function collectionGroupFromName(name) {
	const m = /\/collectionGroups\/([^/]+)\//.exec(String(name ?? ""));
	if (!m) {
		throw new DriftCheckError(`could not parse a collection group out of index name: ${name}`, {
			code: EXIT.BAD_RESPONSE,
		});
	}
	return decodeURIComponent(m[1]);
}

function describeIndexField(field, where) {
	for (const key of Object.keys(field)) {
		if (!INDEX_FIELD_KEYS.has(key)) {
			throw new DriftCheckError(`${where}: unsupported index field attribute "${key}"`, {
				code: EXIT.USAGE,
				hint:
					"This checker compares fieldPath/order/arrayConfig/vectorConfig only. " +
					"A new attribute means the normalizer needs updating — failing loud rather " +
					"than silently ignoring it, which would let real drift through.",
			});
		}
	}
	if (typeof field.fieldPath !== "string" || field.fieldPath.length === 0) {
		throw new DriftCheckError(`${where}: index field is missing fieldPath`, {
			code: EXIT.USAGE,
		});
	}
	if (field.order) return { fieldPath: field.fieldPath, mode: `order=${field.order}` };
	if (field.arrayConfig) {
		return { fieldPath: field.fieldPath, mode: `array=${field.arrayConfig}` };
	}
	if (field.vectorConfig) {
		const dim = field.vectorConfig.dimension ?? "?";
		const flat = field.vectorConfig.flat ? "flat" : "";
		return { fieldPath: field.fieldPath, mode: `vector=${dim}${flat ? `:${flat}` : ""}` };
	}
	throw new DriftCheckError(`${where}: index field "${field.fieldPath}" has no order/arrayConfig/vectorConfig`, {
		code: EXIT.USAGE,
	});
}

/**
 * Drop the trailing `__name__` field IFF it is the one Firestore appends
 * implicitly — i.e. its direction matches the last real field's direction
 * (ASCENDING after an array-contains field). The Admin API always materializes
 * this field; `firestore.indexes.json` normally omits it.
 *
 * An EXPLICIT `__name__` in the opposite direction is a genuinely different
 * index, so it is kept. That's why this isn't a blanket "strip __name__".
 */
export function stripImplicitNameField(fields) {
	if (fields.length < 2) return fields;
	const last = fields[fields.length - 1];
	if (last.fieldPath !== "__name__") return fields;
	const prev = fields[fields.length - 2];
	const implied = prev.mode.startsWith("order=") ? prev.mode : "order=ASCENDING";
	return last.mode === implied ? fields.slice(0, -1) : fields;
}

/**
 * Canonical string for one composite index.
 *
 * !! FIELD ORDER IS SEMANTIC FOR FIRESTORE COMPOSITE INDEXES !!
 * `(userId ASC, createdAt DESC)` and `(createdAt DESC, userId ASC)` are two
 * DIFFERENT indexes that serve different queries. So `fields` is joined in
 * declaration order and is never sorted. Only the LIST of indexes is sorted
 * (see normalizeIndexList) — that ordering carries no meaning.
 */
export function canonicalIndex(index, where = "index") {
	for (const key of Object.keys(index)) {
		if (!INDEX_KEYS.has(key)) {
			throw new DriftCheckError(`${where}: unsupported index attribute "${key}"`, {
				code: EXIT.USAGE,
				hint:
					"The normalizer compares collectionGroup/queryScope/apiScope/fields. " +
					"Add the new attribute to INDEX_KEYS in scripts/check-firebase-drift.mjs " +
					"rather than letting it be ignored.",
			});
		}
	}
	const collectionGroup = index.collectionGroup;
	if (typeof collectionGroup !== "string" || collectionGroup.length === 0) {
		throw new DriftCheckError(`${where}: index is missing collectionGroup`, { code: EXIT.USAGE });
	}
	if (!Array.isArray(index.fields) || index.fields.length === 0) {
		throw new DriftCheckError(`${where}: index on "${collectionGroup}" has no fields`, {
			code: EXIT.USAGE,
		});
	}
	const queryScope = index.queryScope || "COLLECTION";
	const apiScope = index.apiScope || "ANY_API";
	const fields = stripImplicitNameField(
		index.fields.map((f) => describeIndexField(f, `${where} (${collectionGroup})`)),
	);
	const rendered = fields.map((f) => `${f.fieldPath}:${f.mode}`).join(", ");
	return `${collectionGroup} [${queryScope}/${apiScope}] (${rendered})`;
}

/** Index LIST order is not semantic — sort so a reordered file isn't drift. */
export function normalizeIndexList(indexes, where) {
	return indexes.map((i, n) => canonicalIndex(i, `${where}[${n}]`)).sort();
}

export function normalizeLocalIndexes(indexesJson) {
	const raw = indexesJson?.indexes;
	if (raw === undefined) return [];
	if (!Array.isArray(raw)) {
		throw new DriftCheckError("firestore.indexes.json: `indexes` must be an array", {
			code: EXIT.USAGE,
		});
	}
	return normalizeIndexList(raw, "firestore.indexes.json indexes");
}

export function normalizeDeployedIndexes(apiIndexes) {
	return normalizeIndexList(
		(apiIndexes ?? []).map((i) => ({
			collectionGroup: collectionGroupFromName(i.name),
			queryScope: i.queryScope,
			apiScope: i.apiScope,
			fields: i.fields ?? [],
		})),
		"deployed index",
	);
}

// ---------------------------------------------------------------------------
// NORMALIZERS — field overrides
// ---------------------------------------------------------------------------
//
// `fieldOverrides` ship in the SAME file and the SAME `firebase deploy --only
// firestore:indexes` call as composite indexes, so leaving them out would keep
// the exact silent-deletion hole this gate exists to close.

/** Unlike composite index FIELDS, the per-field index list has no ordering. */
export function canonicalFieldOverride(override, where) {
	const { collectionGroup, fieldPath } = override;
	if (!collectionGroup || !fieldPath) {
		throw new DriftCheckError(`${where}: field override needs collectionGroup + fieldPath`, {
			code: EXIT.USAGE,
		});
	}
	const modes = (override.indexes ?? [])
		.map((idx) => {
			const scope = idx.queryScope || "COLLECTION";
			if (idx.order) return `${scope}:order=${idx.order}`;
			if (idx.arrayConfig) return `${scope}:array=${idx.arrayConfig}`;
			return `${scope}:?`;
		})
		.sort();
	const ttl = override.ttl === true ? "ttl" : "no-ttl";
	return `${collectionGroup}.${fieldPath} [${ttl}] {${modes.join(", ")}}`;
}

export function normalizeLocalFieldOverrides(indexesJson) {
	const raw = indexesJson?.fieldOverrides;
	if (raw === undefined) return [];
	if (!Array.isArray(raw)) {
		throw new DriftCheckError("firestore.indexes.json: `fieldOverrides` must be an array", {
			code: EXIT.USAGE,
		});
	}
	return raw
		.map((o, n) => canonicalFieldOverride(o, `firestore.indexes.json fieldOverrides[${n}]`))
		.sort();
}

/**
 * The Firestore Admin `fields` API reports each override as an `indexConfig`
 * whose entries are single-field composite indexes. Flatten back to the
 * `firestore.indexes.json` shape before comparing.
 *
 * Entries with neither an explicit index config nor a TTL config are dropped:
 * they're inherited defaults, which the repo file never lists.
 */
export function normalizeDeployedFieldOverrides(apiFields) {
	const out = [];
	for (const field of apiFields ?? []) {
		const name = String(field.name ?? "");
		const m = /\/collectionGroups\/([^/]+)\/fields\/(.+)$/.exec(name);
		if (!m) {
			throw new DriftCheckError(`could not parse a field override name: ${name}`, {
				code: EXIT.BAD_RESPONSE,
			});
		}
		const collectionGroup = decodeURIComponent(m[1]);
		const fieldPath = decodeURIComponent(m[2]);
		if (fieldPath === "*") continue; // the collection-group wildcard default
		const indexes = (field.indexConfig?.indexes ?? []).map((idx) => {
			const only = (idx.fields ?? [])[0] ?? {};
			return { queryScope: idx.queryScope, order: only.order, arrayConfig: only.arrayConfig };
		});
		const ttl = field.ttlConfig !== undefined;
		if (indexes.length === 0 && !ttl) continue;
		out.push(
			canonicalFieldOverride({ collectionGroup, fieldPath, ttl, indexes }, "deployed field override"),
		);
	}
	return out.sort();
}

// ---------------------------------------------------------------------------
// DIFF RENDERING
// ---------------------------------------------------------------------------

/**
 * Line-level diff, rendered the way `diff` would. Not an LCS — for these
 * inputs (a rules file, a sorted index list) "lines only in repo" /
 * "lines only live" is the readable answer and the unambiguous one.
 */
export function formatTextDiff(repoText, liveText, { repoLabel, liveLabel }) {
	const repo = repoText.split("\n");
	const live = liveText.split("\n");
	const lines = [];
	const max = Math.max(repo.length, live.length);
	for (let i = 0; i < max; i += 1) {
		const a = repo[i];
		const b = live[i];
		if (a === b) continue;
		lines.push(`  line ${i + 1}:`);
		lines.push(`    ${repoLabel}: ${a === undefined ? "<end of file>" : JSON.stringify(a)}`);
		lines.push(`    ${liveLabel}: ${b === undefined ? "<end of file>" : JSON.stringify(b)}`);
	}
	return lines;
}

export function formatSetDiff(repoItems, liveItems) {
	const liveSet = new Set(liveItems);
	const repoSet = new Set(repoItems);
	const lines = [];
	for (const item of repoItems) {
		if (!liveSet.has(item)) lines.push(`  + only in repo (would be CREATED):  ${item}`);
	}
	for (const item of liveItems) {
		if (!repoSet.has(item)) lines.push(`  - only live (would be DELETED):     ${item}`);
	}
	return lines;
}

// ---------------------------------------------------------------------------
// LINEAGE — the versions of each file this branch produced (git)
// ---------------------------------------------------------------------------

export const DEFAULT_BASELINE_REF = "origin/main";

/**
 * The git seam. `readLineageVersions` only ever calls `git(args)` and reads
 * `{ status, stdout, stderr, error }`, so tests hand in a fake runner.
 */
export function defaultGitRunner(repoRoot = process.cwd()) {
	return (args) => {
		const r = spawnSync("git", args, {
			cwd: repoRoot,
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		});
		return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error };
	};
}

const NO_FALLBACK =
	"The gate needs git to know which versions this branch produced; it refuses to fall " +
	"back to a working-tree-only comparison.";

function gitOrThrow(git, args, what) {
	const r = git(args);
	if (r.error) {
		throw new DriftCheckError(`git is unavailable (${r.error.code ?? r.error.message})`, {
			code: EXIT.USAGE,
			hint: `Install git / run from a git checkout. ${NO_FALLBACK}`,
		});
	}
	if (r.status !== 0) {
		throw new DriftCheckError(`git ${what} failed: ${String(r.stderr).trim().slice(0, 300)}`, {
			code: EXIT.USAGE,
			hint: NO_FALLBACK,
		});
	}
	return r.stdout;
}

/** The file's content at `rev`, or `null` when it doesn't exist there. */
function fileAt(git, rev, file) {
	const listed = gitOrThrow(git, ["ls-tree", "--name-only", rev, "--", file], `ls-tree ${rev}`);
	if (listed.trim() === "") return null;
	return gitOrThrow(git, ["show", `${rev}:${file}`], `show ${rev}:${file}`);
}

/**
 * For each file, the versions this branch's lineage produced: the file at the
 * baseline ref (labelled with the ref name), the file at every commit in
 * `<baseline>..HEAD` that touched it (labelled `<shortsha> (this branch)`,
 * newest first), then the version the baseline replaced — the second commit
 * touching the file on the baseline's first-parent history (labelled
 * `<shortsha> (previous on <baseline>)`). A version only an unmerged branch
 * produced, or anything older, is in none of these, so it still reads as drift. The working tree is NOT included — evaluateDrift always
 * checks it first on its own.
 *
 * A file absent at the baseline (a new surface) just contributes no version.
 * A missing ref or missing git is a hard USAGE error — never a fallback.
 */
export function readLineageVersions(files, { baseline = DEFAULT_BASELINE_REF, git = defaultGitRunner() } = {}) {
	if (typeof baseline !== "string" || baseline.length === 0 || baseline.startsWith("-")) {
		throw new DriftCheckError(`invalid baseline ref: ${JSON.stringify(baseline)}`, {
			code: EXIT.USAGE,
			hint: "usage: --baseline <git ref> (default origin/main)",
		});
	}
	const probe = git(["rev-parse", "--verify", "--quiet", `${baseline}^{commit}`]);
	if (probe.error) {
		throw new DriftCheckError(`git is unavailable (${probe.error.code ?? probe.error.message})`, {
			code: EXIT.USAGE,
			hint: `Install git / run from a git checkout. ${NO_FALLBACK}`,
		});
	}
	if (probe.status !== 0) {
		throw new DriftCheckError(`baseline ref "${baseline}" not found in this checkout`, {
			code: EXIT.USAGE,
			hint:
				`Run \`git fetch origin\` and retry (or pass --baseline <ref> / DRIFT_BASELINE_REF). ` +
				NO_FALLBACK,
		});
	}
	const baseSha = probe.stdout.trim();
	const out = {};
	for (const file of files) {
		const versions = [];
		const atBase = fileAt(git, baseSha, file);
		if (atBase !== null) versions.push({ label: baseline, source: atBase });
		const shas = gitOrThrow(
			git,
			["log", "--format=%H", `${baseSha}..HEAD`, "--", file],
			`log ${baseline}..HEAD`,
		)
			.split("\n")
			.map((s) => s.trim())
			.filter(Boolean);
		for (const sha of shas) {
			const source = fileAt(git, sha, file);
			if (source !== null) versions.push({ label: `${sha.slice(0, 7)} (this branch)`, source });
		}
		// The version the baseline replaced. Without it, deploying from main right
		// after a rules PR merges reads as drift: <baseline>..HEAD is empty and
		// live still holds the pre-merge version. Only ONE version back, on the
		// first-parent line: an older ruleset in live (a console rollback, a stale
		// deploy) must still block rather than be silently overwritten.
		const previous = gitOrThrow(
			git,
			["log", "--first-parent", "-n", "2", "--format=%H", baseSha, "--", file],
			`log ${baseline}`,
		)
			.split("\n")
			.map((s) => s.trim())
			.filter(Boolean)[1];
		if (previous) {
			const source = fileAt(git, previous, file);
			if (source !== null) versions.push({ label: `${previous.slice(0, 7)} (previous on ${baseline})`, source });
		}
		out[file] = versions;
	}
	return out;
}

// ---------------------------------------------------------------------------
// COMPARISON (pure — this is what the tests drive)
// ---------------------------------------------------------------------------

/**
 * @param {object} state
 * @param {{source: string, deployed: string|null, acceptable?: Array<{label: string, source: string}>}} state.firestoreRules
 * @param {{source: string, deployed: Array<{bucket: string, source: string}>, acceptable?: Array<{label: string, source: string}>}} state.storageRules
 * @param {{local: string[], deployed: string[]|null, acceptable?: Array<{label: string, local: string[]}>}} state.indexes
 * @param {{local: string[], deployed: string[]|null, acceptable?: Array<{label: string, local: string[]}>}} state.fieldOverrides
 * @returns {{drift: boolean, sections: Array<{name: string, status: string, lines: string[]}>}}
 *
 * `source` / `local` is the WORKING TREE — always acceptable, checked first.
 * `acceptable` is the rest of the branch's lineage (baseline ref + this
 * branch's earlier commits — see readLineageVersions). Live matching the
 * working tree is `match` / `cosmetic`; matching an older lineage version is
 * `change` (a pass — the deploy moves live forward); matching none is `drift`.
 *
 * `deployed: null` means NOTHING IS DEPLOYED YET. That is explicitly not
 * drift — reporting it as drift would block the very first deploy, which is
 * the state a fresh project is always in.
 */
function ruleSection(name, repoSource, liveSource, acceptable = []) {
	const status = compareRules(repoSource, liveSource);
	if (status === "match") return { name, status, lines: ["  live = working tree"] };
	if (status === "cosmetic") {
		return {
			name,
			status,
			lines: [
				"  live = working tree — rule logic is identical; only comments/formatting differ.",
				"  NOT blocking — a comment cannot widen access. Deploying refreshes the text.",
			],
		};
	}
	const diff = formatTextDiff(stripRulesComments(repoSource), stripRulesComments(liveSource), {
		repoLabel: "repo",
		liveLabel: "live",
	});
	const known = acceptable.find((v) => compareRules(v.source, liveSource) !== "drift");
	if (known) {
		return {
			name,
			status: "change",
			lines: [`  live = ${known.label} — this deploy will CHANGE the live rules:`, ...diff],
		};
	}
	return { name, status: "drift", lines: [unknownLiveLine(acceptable), ...diff] };
}

function unknownLiveLine(acceptable) {
	const labels = ["working tree", ...acceptable.map((v) => v.label)];
	return `  live matches NONE of the ${labels.length} versions this branch's lineage produced (${labels.join(", ")})`;
}

const sameList = (a, b) => {
	const x = [...a].sort();
	const y = [...b].sort();
	return x.length === y.length && x.every((item, i) => item === y[i]);
};

export function evaluateDrift(state) {
	const sections = [];

	// --- Firestore rules ---
	{
		const { source, deployed, acceptable } = state.firestoreRules;
		if (deployed === null) {
			sections.push({
				name: "firestore.rules",
				status: "first-deploy",
				lines: ["  no Firestore ruleset deployed yet — this would be the first"],
			});
		} else {
			sections.push(ruleSection("firestore.rules", source, deployed, acceptable));
		}
	}

	// --- Storage rules (one release per bucket; all compare to the one file) ---
	{
		const { source, deployed, acceptable } = state.storageRules;
		if (source === null) {
			const live = deployed?.length ?? 0;
			sections.push({
				name: "storage.rules",
				status: "skipped",
				lines: [
					live === 0
						? "  no storage.rules in this repo and none live — nothing to compare"
						: `  no storage.rules in this repo — ${live} live bucket ruleset${live === 1 ? "" : "s"} not managed by this repo (this deploy won't touch them)`,
				],
			});
		} else if (!deployed || deployed.length === 0) {
			sections.push({
				name: "storage.rules",
				status: "first-deploy",
				lines: ["  no Storage ruleset deployed yet — this would be the first"],
			});
		} else {
			const perBucket = deployed.map((b) => ({
				bucket: b.bucket,
				...ruleSection("", source, b.source, acceptable),
			}));
			const lines = [];
			for (const b of perBucket) {
				lines.push(`  bucket ${b.bucket}:`);
				lines.push(...b.lines);
			}
			const has = (s) => perBucket.some((b) => b.status === s);
			sections.push({
				name: "storage.rules",
				status: has("drift")
					? "drift"
					: has("change")
						? "change"
						: has("cosmetic")
							? "cosmetic"
							: "match",
				lines,
				note: `${deployed.length} bucket${deployed.length === 1 ? "" : "s"}`,
			});
		}
	}

	// --- Composite indexes + field overrides ---
	for (const [name, key] of [
		["firestore.indexes.json → indexes", "indexes"],
		["firestore.indexes.json → fieldOverrides", "fieldOverrides"],
	]) {
		const { local, deployed, acceptable = [] } = state[key];
		if (deployed === null) {
			sections.push({
				name,
				status: "first-deploy",
				lines: [
					`  ${state[key].reason ?? "no Firestore database provisioned yet"} — nothing to compare against`,
				],
			});
			continue;
		}
		const note = `${local.length} in repo, ${deployed.length} live`;
		if (sameList(local, deployed)) {
			sections.push({ name, status: "match", lines: ["  live = working tree"], note });
			continue;
		}
		if (deployed.length === 0) {
			sections.push({
				name,
				status: "first-deploy",
				lines: [`  none deployed yet — this deploy would create ${local.length}`],
			});
			continue;
		}
		const diff = formatSetDiff(local, deployed);
		const known = acceptable.find((v) => sameList(v.local, deployed));
		if (known) {
			sections.push({
				name,
				status: "change",
				lines: [`  live = ${known.label} — this deploy will CHANGE the live set:`, ...diff],
				note,
			});
			continue;
		}
		sections.push({ name, status: "drift", lines: [unknownLiveLine(acceptable), ...diff], note });
	}

	return { drift: sections.some((s) => s.status === "drift"), sections };
}

export function formatReport(projectId, alias, result, { baseline } = {}) {
	const out = [];
	out.push(`Firebase config drift check — ${alias} (${projectId})`);
	if (baseline) out.push(`baseline: ${baseline} + the version it replaced + this branch's commits since it + working tree`);
	out.push("");
	const icon = { match: "✓", cosmetic: "~", change: "→", "first-deploy": "·", skipped: "-", drift: "✗" };
	for (const section of result.sections) {
		const note = section.note ? ` — ${section.note}` : "";
		out.push(`${icon[section.status] ?? "?"} ${section.name}: ${section.status}${note}`);
		out.push(...section.lines);
	}
	out.push("");
	if (result.drift) {
		out.push("DRIFT DETECTED — refusing to deploy.");
		out.push(
			"The live project matches no version this branch's lineage produced — someone edited it",
			"in the console, or another branch deployed. Pull the live change back into the repo (or",
			"rebase onto the branch that shipped it), then re-run. A `+ only in repo` line will be",
			"CREATED by the deploy; a `- only live` line will be DELETED.",
		);
	} else if (result.sections.some((s) => s.status === "change")) {
		out.push("No drift. Safe to deploy — the `→` surfaces above will CHANGE on this deploy.");
	} else {
		out.push("No drift. Safe to deploy.");
	}
	return out.join("\n");
}

// ---------------------------------------------------------------------------
// FETCHERS (network — never exercised by the unit tests)
// ---------------------------------------------------------------------------

async function fetchRulesetSource(token, projectId, rulesetName) {
	const json = await getJson(
		`${RULES_API}/${rulesetName}`,
		token,
		`ruleset ${rulesetName.split("/").pop()} for ${projectId}`,
	);
	if (!json) return null;
	const files = json.source?.files ?? [];
	if (files.length === 0) {
		throw new DriftCheckError(`deployed ruleset ${rulesetName} has no source files`, {
			code: EXIT.BAD_RESPONSE,
		});
	}
	// A Firebase ruleset for one service is a single file. If a future ruleset
	// ever carries includes, concatenating by name keeps the comparison total
	// rather than silently comparing only the first file.
	if (files.length === 1) return files[0].content ?? "";
	return files
		.slice()
		.sort((a, b) => String(a.name).localeCompare(String(b.name)))
		.map((f) => f.content ?? "")
		.join("\n");
}

async function fetchReleases(token, projectId) {
	const releases = [];
	let pageToken;
	do {
		const url = new URL(`${RULES_API}/projects/${projectId}/releases`);
		url.searchParams.set("pageSize", "100");
		if (pageToken) url.searchParams.set("pageToken", pageToken);
		const json = await getJson(url.toString(), token, `rules releases for ${projectId}`);
		if (!json) return [];
		releases.push(...(json.releases ?? []));
		pageToken = json.nextPageToken;
	} while (pageToken);
	return releases;
}

/**
 * "The Cloud Firestore API is not enabled on this project" is the most
 * complete form of "nothing is deployed yet" there is — there is no database,
 * so there are no indexes to have drifted from. Failing the gate on it would
 * block the very first `deploy:rules:prod`, and it cannot mask a bad deploy:
 * `firebase deploy --only firestore:indexes` against a project with the API
 * disabled fails on its own, with its own message.
 *
 * Narrow on purpose — ONLY a disabled firestore.googleapis.com. A 403 from a
 * missing IAM role still hard-blocks, because that one CAN hide real drift.
 */
export function isFirestoreNotProvisioned(err) {
	return (
		err instanceof DriftCheckError &&
		err.code === EXIT.PERMISSION &&
		/firestore\.googleapis\.com is not enabled/.test(err.message)
	);
}

async function fetchIndexes(token, projectId) {
	const indexes = [];
	let pageToken;
	do {
		const url = new URL(
			`${FIRESTORE_API}/projects/${projectId}/databases/${DATABASE_ID}/collectionGroups/-/indexes`,
		);
		// NO pageSize: against the `-` (all collection groups) wildcard the
		// Admin API answers `Invalid page size. Only 0 is supported.` and 400s.
		// It returns everything in one page; the pageToken loop is belt-and-braces.
		if (pageToken) url.searchParams.set("pageToken", pageToken);
		const json = await getJson(url.toString(), token, `composite indexes for ${projectId}`);
		// 404 = the (default) database has never been provisioned.
		if (!json) return null;
		indexes.push(...(json.indexes ?? []));
		pageToken = json.nextPageToken;
	} while (pageToken);
	return indexes;
}

async function fetchFieldOverrides(token, projectId) {
	const fields = [];
	let pageToken;
	do {
		const url = new URL(
			`${FIRESTORE_API}/projects/${projectId}/databases/${DATABASE_ID}/collectionGroups/-/fields`,
		);
		// Without this filter the API refuses the request; it also keeps
		// inherited-default fields out of the response.
		url.searchParams.set("filter", "indexConfig.usesAncestorConfig=false");
		// No pageSize — same wildcard-collection-group restriction as indexes above.
		if (pageToken) url.searchParams.set("pageToken", pageToken);
		const json = await getJson(url.toString(), token, `field overrides for ${projectId}`);
		if (!json) return null;
		fields.push(...(json.fields ?? []));
		pageToken = json.nextPageToken;
	} while (pageToken);
	return fields;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function readLocalFile(root, rel, { json = false, optional = false } = {}) {
	const abs = path.join(root, rel);
	if (!fs.existsSync(abs)) {
		if (optional) return null;
		throw new DriftCheckError(`missing local file: ${rel} (in ${root})`, { code: EXIT.USAGE });
	}
	const text = fs.readFileSync(abs, "utf8");
	if (!json) return text;
	try {
		return JSON.parse(text);
	} catch (err) {
		throw new DriftCheckError(`${rel} is not valid JSON: ${err.message}`, { code: EXIT.USAGE });
	}
}

/**
 * Normalize every lineage version of firestore.indexes.json into the two
 * surfaces evaluateDrift compares. A version that doesn't parse fails loud —
 * silently skipping it would shrink the acceptable set without saying so.
 */
export function indexLineage(versions) {
	return versions.map(({ label, source }) => {
		let json;
		try {
			json = JSON.parse(source);
		} catch (err) {
			throw new DriftCheckError(`firestore.indexes.json at ${label} is not valid JSON: ${err.message}`, {
				code: EXIT.USAGE,
			});
		}
		return {
			label,
			indexes: normalizeLocalIndexes(json),
			fieldOverrides: normalizeLocalFieldOverrides(json),
		};
	});
}

export async function main(argv, { git, env = process.env, cwd = process.cwd() } = {}) {
	const args = parseArgs(argv);
	if (args.help) {
		console.log(
			"usage: node check-firebase-drift.mjs --project <alias> [--repo <dir>] [--baseline <ref>]",
		);
		return EXIT.OK;
	}
	const root = path.resolve(cwd, args.repo || ".");
	git = git ?? defaultGitRunner(root);
	const projectId = resolveProjectId(readLocalFile(root, ".firebaserc", { json: true }), args.alias);

	const firestoreRulesSource = readLocalFile(root, "firestore.rules");
	// Optional: a project with no storage.rules doesn't deploy Storage, so there
	// is nothing of ours to compare (MediaTracker, PlaylistModifier).
	const storageRulesSource = readLocalFile(root, "storage.rules", { optional: true });
	const indexesJson = readLocalFile(root, "firestore.indexes.json", { json: true });

	// Read the lineage BEFORE touching the network: a missing ref is a local
	// problem with a local fix (`git fetch origin`), and must never degrade to
	// the old working-tree-only comparison.
	const baseline = args.baseline || env.DRIFT_BASELINE_REF || DEFAULT_BASELINE_REF;
	const lineage = readLineageVersions(
		["firestore.rules", ...(storageRulesSource === null ? [] : ["storage.rules"]), "firestore.indexes.json"],
		{ baseline, git },
	);
	const indexVersions = indexLineage(lineage["firestore.indexes.json"]);

	const token = await mintAccessToken(loadServiceAccountKey(projectId));

	const releases = await fetchReleases(token, projectId);
	const firestoreRelease = releases.find((r) => String(r.name).endsWith("/releases/cloud.firestore"));
	const storageReleases = releases.filter((r) => /\/releases\/firebase\.storage\//.test(String(r.name)));

	const deployedFirestoreRules = firestoreRelease
		? await fetchRulesetSource(token, projectId, firestoreRelease.rulesetName)
		: null;

	const deployedStorageRules = [];
	for (const release of storageReleases) {
		const source = await fetchRulesetSource(token, projectId, release.rulesetName);
		if (source === null) continue;
		deployedStorageRules.push({
			bucket: String(release.name).split("/releases/firebase.storage/").pop(),
			source,
		});
	}

	let rawIndexes = null;
	let rawFields = null;
	let firestoreReason;
	try {
		rawIndexes = await fetchIndexes(token, projectId);
		if (rawIndexes === null) firestoreReason = "no Firestore database provisioned yet";
		else rawFields = await fetchFieldOverrides(token, projectId);
	} catch (err) {
		if (!isFirestoreNotProvisioned(err)) throw err;
		rawIndexes = null;
		firestoreReason = "the Cloud Firestore API is not enabled on this project";
	}

	const result = evaluateDrift({
		firestoreRules: {
			source: firestoreRulesSource,
			deployed: deployedFirestoreRules,
			acceptable: lineage["firestore.rules"],
		},
		storageRules: {
			source: storageRulesSource,
			deployed: deployedStorageRules,
			acceptable: lineage["storage.rules"] ?? [],
		},
		indexes: {
			local: normalizeLocalIndexes(indexesJson),
			deployed: rawIndexes === null ? null : normalizeDeployedIndexes(rawIndexes),
			acceptable: indexVersions.map((v) => ({ label: v.label, local: v.indexes })),
			reason: firestoreReason,
		},
		fieldOverrides: {
			local: normalizeLocalFieldOverrides(indexesJson),
			deployed: rawFields === null ? null : normalizeDeployedFieldOverrides(rawFields),
			acceptable: indexVersions.map((v) => ({ label: v.label, local: v.fieldOverrides })),
			reason: firestoreReason,
		},
	});

	console.log(formatReport(projectId, args.alias, result, { baseline }));
	return result.drift ? EXIT.DRIFT : EXIT.OK;
}

// Node realpaths import.meta.url but argv[1] keeps the caller's path, so compare
// realpaths: a direct compare skips main() (silent exit 0) whenever the script is
// launched through a symlink, e.g. /home/kwaku -> /home/twumasip (Insem DEC-389).
// Returns "main" (run), "import" (loaded as a module) or "unresolved" (launched
// as this script but a path couldn't be resolved — the caller must fail closed,
// never exit 0, since a deploy hook would read that as a pass).
export function entryPointKind(argv1, moduleUrl, realpath = fs.realpathSync) {
	if (!argv1) return "import";
	const self = fileURLToPath(moduleUrl);
	try {
		return realpath(argv1) === realpath(self) ? "main" : "import";
	} catch {
		return path.basename(argv1) === path.basename(self) ? "unresolved" : "import";
	}
}

const entry = entryPointKind(process.argv[1], import.meta.url);
if (entry === "unresolved") {
	console.error(`\ncheck-firebase-drift FAILED: couldn't resolve ${process.argv[1]} to decide whether to run`);
	process.exit(EXIT.USAGE);
}

if (entry === "main") {
	main(process.argv.slice(2))
		.then((code) => process.exit(code))
		.catch((err) => {
			if (err instanceof DriftCheckError) {
				// Real cause FIRST — per the repo's NoopTracer diagnostic lesson,
				// a reader must not have to dig past a stack trace to find it.
				console.error(`\ncheck-firebase-drift FAILED: ${err.message}`);
				if (err.hint) console.error(`  → ${err.hint}`);
				process.exit(err.code);
			}
			console.error(`\ncheck-firebase-drift FAILED (unexpected): ${err?.message ?? err}`);
			process.exit(EXIT.BAD_RESPONSE);
		});
}
