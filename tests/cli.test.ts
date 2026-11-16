// F1 — the central gate as /deploy runs it: the master script in coding-agents,
// launched against ANOTHER project's checkout (`--repo <dir>` or that cwd).
//
// Hermetic, no network, no real credential (same pattern as KaeMe's f63 test):
//   - HOME is a temp dir holding a throwaway service-account key at
//     ~/.gcp/<project id>.json, so the key convention is honoured without ~/.gcp.
//   - NODE_OPTIONS=--import <stub> replaces global fetch: the OAuth exchange and
//     the rules/index reads are answered from a JSON "deployed state" file.
//   - The scratch project is a tiny git repo with an origin/main ref, so the
//     branch-lineage baseline resolves.

import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPTS_DIR = realpathSync(join(__dirname, "..", "scripts"));
const SCRIPT = join(SCRIPTS_DIR, "check-firebase-drift.mjs");
const PROJECT_ID = "scratch-proj-staging";

const DENY_ALL = `rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
`;
const CONSOLE_EDIT = DENY_ALL.replace("if false", "if request.auth != null");

const FETCH_STUB = `
import { readFileSync } from "node:fs";
const state = JSON.parse(readFileSync(process.env.DRIFT_STUB_STATE, "utf8"));
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = async (input) => {
  const url = String(typeof input === "string" ? input : input.url);
  if (url.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "stub-token" });
  if (url.includes("firebaserules.googleapis.com") && /\\/releases(\\?|$)/.test(url)) {
    return json({ releases: [{ name: "projects/p/releases/cloud.firestore", rulesetName: "projects/p/rulesets/stub-fs" }] });
  }
  if (url.includes("firebaserules.googleapis.com") && url.endsWith("/rulesets/stub-fs")) {
    return json({ source: { files: [{ name: "firestore.rules", content: state.firestoreRules }] } });
  }
  if (url.includes("firestore.googleapis.com")) return json({ error: "not found" }, 404);
  return json({ error: "unexpected url in drift stub: " + url }, 500);
};
`;

let tmp: string;
let project: string;
let home: string;
let statePath: string;
let stubPath: string;

function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env };
	for (const k of Object.keys(env)) if (k.startsWith("GIT_")) delete env[k];
	return { ...env, ...extra };
}

function git(...args: string[]) {
	const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], {
		cwd: project,
		encoding: "utf8",
		env: cleanEnv({ HOME: home }),
	});
	if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

function writeKey() {
	const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
	writeFileSync(
		join(home, ".gcp", `${PROJECT_ID}.json`),
		JSON.stringify({
			type: "service_account",
			client_email: "stub@stub.iam.gserviceaccount.com",
			private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
		}),
		{ mode: 0o600 },
	);
}

function run(
	args: string[],
	{ live = DENY_ALL, cwd = SCRIPTS_DIR, script = SCRIPT }: { live?: string; cwd?: string; script?: string } = {},
) {
	writeFileSync(statePath, JSON.stringify({ firestoreRules: live }));
	const r = spawnSync(process.execPath, [script, ...args], {
		cwd,
		encoding: "utf8",
		timeout: 60_000,
		env: cleanEnv({
			HOME: home,
			NODE_OPTIONS: `--import ${pathToFileURL(stubPath).href}`,
			DRIFT_STUB_STATE: statePath,
			GOOGLE_APPLICATION_CREDENTIALS: "",
			DRIFT_BASELINE_REF: "",
		}),
	});
	return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

beforeEach(async () => {
	tmp = await mkdtemp(join(tmpdir(), "central-drift-"));
	project = join(tmp, "project");
	home = join(tmp, "home");
	statePath = join(tmp, "deployed.json");
	stubPath = join(tmp, "fetch-stub.mjs");
	mkdirSync(join(home, ".gcp"), { recursive: true, mode: 0o700 });
	mkdirSync(project, { recursive: true });
	writeFileSync(stubPath, FETCH_STUB);
	writeKey();

	// A MediaTracker-shaped project: rules + indexes, NO storage.rules.
	writeFileSync(join(project, ".firebaserc"), JSON.stringify({ projects: { staging: PROJECT_ID } }));
	writeFileSync(join(project, "firestore.rules"), DENY_ALL);
	writeFileSync(join(project, "firestore.indexes.json"), JSON.stringify({ indexes: [], fieldOverrides: [] }));
	git("init", "-q");
	git("add", "-A");
	git("commit", "-q", "-m", "init");
	git("update-ref", "refs/remotes/origin/main", "HEAD");
});

afterEach(async () => {
	await rm(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

describe("central script checks the project it is pointed at", () => {
	it("[Int|H] --repo <project>: reads that project's files, storage skipped, exit 0", () => {
		const r = run(["--project", "staging", "--repo", project]);
		expect(r.out).toContain(`(${PROJECT_ID})`);
		expect(r.out).toMatch(/^- storage\.rules: skipped/m);
		expect(r.out).toContain("No drift. Safe to deploy.");
		expect(r.status).toBe(0);
	});

	it("[Int|H] no --repo: falls back to the cwd (the project /deploy runs from)", () => {
		const r = run(["--project", "staging"], { cwd: project });
		expect(r.out).toContain(`(${PROJECT_ID})`);
		expect(r.status).toBe(0);
	});

	it("[Int|E] relative --repo resolves against the cwd, not the script's location", () => {
		const r = run(["--project", "staging", "--repo", "../project"], { cwd: join(tmp, "home") });
		expect(r.out).toContain(`(${PROJECT_ID})`);
		expect(r.status).toBe(0);
	});

	it("[Int|U] live rules edited in the console → DRIFT, exit 1", () => {
		const r = run(["--project", "staging", "--repo", project], { live: CONSOLE_EDIT });
		expect(r.out).toContain("DRIFT DETECTED — refusing to deploy.");
		expect(r.status).toBe(1);
	});

	it("[Int|U] no service-account key for the project → exit 3 (fails closed)", () => {
		rmKey();
		const r = run(["--project", "staging", "--repo", project]);
		expect(r.out).toMatch(/check-firebase-drift FAILED/);
		expect(r.status).toBe(3);
	});

	it("[Int|U] project missing .firebaserc → exit 2 naming the project dir, not coding-agents", () => {
		const empty = join(tmp, "empty");
		mkdirSync(empty);
		const r = run(["--project", "staging", "--repo", empty]);
		expect(r.out).toContain(`missing local file: .firebaserc (in ${empty})`);
		expect(r.status).toBe(2);
	});

	it("[Int|E] launched through a symlinked scripts dir (/home/kwaku), main() still runs", () => {
		const linked = join(tmp, "linked-scripts");
		symlinkSync(SCRIPTS_DIR, linked, "dir");
		const r = run(["--project", "staging", "--repo", project], { script: join(linked, "check-firebase-drift.mjs") });
		expect(r.out.trim()).not.toBe("");
		expect(r.status).toBe(0);
	});
});

function rmKey() {
	spawnSync("rm", ["-f", join(home, ".gcp", `${PROJECT_ID}.json`)]);
}
