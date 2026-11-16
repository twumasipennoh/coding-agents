// `scripts/check-firebase-drift.mjs` — normalizer + comparison tests.
//
// Everything here is PURE. The script's fetchers are deliberately not
// exercised: a test that makes a live call to firebaserules.googleapis.com
// would need a real service-account key, would be non-hermetic, and would fail
// in CI for reasons unrelated to the code. The network layer's contract is
// "hand `evaluateDrift` a shape"; these tests drive that shape directly.
//
// The cases that matter, in the order they matter:
//   1. nothing deployed yet is NOT drift        (getting this wrong blocks the
//                                                 very first deploy — the exact
//                                                 state both projects are in)
//   2. drift is detected and rendered readably
//   3. cosmetic difference is NOT drift
//   4. malformed input fails LOUD, not silently

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	canonicalFieldOverride,
	canonicalIndex,
	classifyHttpError,
	collectionGroupFromName,
	compareRules,
	EXIT,
	evaluateDrift,
	formatReport,
	formatSetDiff,
	indexLineage,
	isFirestoreNotProvisioned,
	normalizeDeployedFieldOverrides,
	normalizeDeployedIndexes,
	normalizeIndexList,
	normalizeLocalFieldOverrides,
	normalizeLocalIndexes,
	normalizeRulesSource,
	parseArgs,
	readLineageVersions,
	resolveProjectId,
	stripImplicitNameField,
	stripRulesComments,
} from "../scripts/check-firebase-drift.mjs";

const DENY_ALL = `rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
`;

/** Minimal well-formed input for evaluateDrift, with everything matching. */
function baselineState(overrides: Record<string, unknown> = {}) {
	return {
		firestoreRules: { source: DENY_ALL, deployed: DENY_ALL },
		storageRules: { source: DENY_ALL, deployed: [{ bucket: "b.appspot.com", source: DENY_ALL }] },
		indexes: { local: [] as string[], deployed: [] as string[] },
		fieldOverrides: { local: [] as string[], deployed: [] as string[] },
		...overrides,
	};
}

describe("resolveProjectId", () => {
	const firebaserc = {
		projects: {
			default: "conversational-assistant-dev",
			dev: "conversational-assistant-dev",
			prod: "conversational-assistant-2269b",
		},
	};

	it("resolves each alias through .firebaserc rather than a hardcoded id", () => {
		expect(resolveProjectId(firebaserc, "dev")).toBe("conversational-assistant-dev");
		expect(resolveProjectId(firebaserc, "prod")).toBe("conversational-assistant-2269b");
	});

	it("rejects an unknown alias with the known aliases in the hint", () => {
		try {
			resolveProjectId(firebaserc, "staging");
			expect.unreachable("should have thrown");
		} catch (err) {
			expect((err as Error).message).toContain('no project alias "staging"');
			expect((err as { code: number }).code).toBe(EXIT.USAGE);
			expect((err as { hint: string }).hint).toContain("dev, prod");
		}
	});

	it("rejects a missing --project rather than defaulting to prod", () => {
		expect(() => resolveProjectId(firebaserc, null)).toThrow(/missing --project/);
	});
});

describe("parseArgs", () => {
	it("accepts --project dev, --project=dev and -P dev", () => {
		expect(parseArgs(["--project", "dev"]).alias).toBe("dev");
		expect(parseArgs(["--project=prod"]).alias).toBe("prod");
		expect(parseArgs(["-P", "dev"]).alias).toBe("dev");
	});

	it("rejects an unknown flag instead of silently ignoring it", () => {
		expect(() => parseArgs(["--projekt", "dev"])).toThrow(/unknown argument/);
	});

	it("accepts --baseline <ref> and --baseline=<ref>, null when omitted", () => {
		expect(parseArgs(["--project", "dev", "--baseline", "origin/x"]).baseline).toBe("origin/x");
		expect(parseArgs(["--baseline=HEAD~2", "-P", "dev"]).baseline).toBe("HEAD~2");
		expect(parseArgs(["--project", "dev"]).baseline).toBeNull();
	});
});

describe("normalizeRulesSource", () => {
	it("treats CRLF, trailing whitespace and a trailing newline as equivalent", () => {
		const crlf = DENY_ALL.replace(/\n/g, "\r\n").replace(/;/g, ";   ");
		expect(normalizeRulesSource(crlf)).toBe(normalizeRulesSource(DENY_ALL.replace(/;/g, ";")));
	});

	it("collapses runs of blank lines", () => {
		expect(normalizeRulesSource("a\n\n\n\n\nb")).toBe("a\n\nb");
	});

	it("keeps comments — that separation is stripRulesComments' job, not this one", () => {
		const withComment = `// why this is deny-all\n${DENY_ALL}`;
		expect(normalizeRulesSource(withComment)).not.toBe(normalizeRulesSource(DENY_ALL));
	});

	it("keeps INTERIOR indentation significant (only trailing whitespace is stripped)", () => {
		expect(normalizeRulesSource("x\n  allow read;")).not.toBe(
			normalizeRulesSource("x\nallow read;"),
		);
	});
});

describe("stripRulesComments", () => {
	it("removes a whole-line // comment", () => {
		expect(stripRulesComments(`// header\n${DENY_ALL}`)).toBe(stripRulesComments(DENY_ALL));
	});

	it("removes a trailing // comment but keeps the code on the line", () => {
		expect(stripRulesComments("allow read; // because")).toBe("allow read;");
	});

	it("removes a multi-line /* */ block", () => {
		expect(stripRulesComments("a;\n/* one\n   two */\nb;")).toBe("a;\n\nb;");
	});

	it("removes an inline /* */ block mid-line", () => {
		expect(stripRulesComments("allow /* nope */ read;")).toBe("allow  read;");
	});

	it("does NOT strip a // that lives inside a string literal", () => {
		// `rules_version = '2';` is quoted; a path-ish string with // must survive
		// or the comparison would silently mangle the rule it is supposed to guard.
		expect(stripRulesComments(`let x = "http://a";`)).toBe(`let x = "http://a";`);
		expect(stripRulesComments("let x = 'a//b';")).toBe("let x = 'a//b';");
	});

	it("survives an escaped quote inside a string", () => {
		expect(stripRulesComments('let x = "a\\"//b"; // gone')).toBe('let x = "a\\"//b";');
	});

	it("leaves the rule body of the real deny-all ruleset intact", () => {
		expect(stripRulesComments(DENY_ALL)).toContain("allow read, write: if false;");
		expect(stripRulesComments(DENY_ALL)).toContain("rules_version = '2';");
	});
});

describe("compareRules", () => {
	const commented = `// KaeMe — Slice 0 DENY-ALL PLACEHOLDER.\n// F63 replaces this.\n${DENY_ALL}`;

	it("returns `match` for identical sources", () => {
		expect(compareRules(DENY_ALL, DENY_ALL)).toBe("match");
	});

	it("returns `cosmetic` when only comments differ — Firebase's auto-provisioned default", () => {
		// This is the REAL dev-project state: creating a Firestore database
		// auto-deploys a deny-all ruleset with none of the repo's header prose.
		// A comment-sensitive gate would block the very first deploy:rules:dev.
		expect(compareRules(commented, DENY_ALL)).toBe("cosmetic");
	});

	it("returns `cosmetic` when only whitespace differs", () => {
		expect(compareRules(DENY_ALL, `${DENY_ALL}\n\n\n`)).toBe("match");
		expect(compareRules(DENY_ALL, DENY_ALL.replace(/\n/g, "\r\n"))).toBe("match");
	});

	it("returns `drift` the moment the rule LOGIC differs, comments notwithstanding", () => {
		const loosened = commented.replace("if false", "if request.auth != null");
		expect(compareRules(commented, loosened)).toBe("drift");
	});

	it("returns `drift` for a widened rule hidden behind a matching comment header", () => {
		expect(compareRules(commented, commented.replace("if false", "if true"))).toBe("drift");
	});
});

describe("canonicalIndex — field order is semantic", () => {
	const ascThenDesc = {
		collectionGroup: "items",
		queryScope: "COLLECTION",
		fields: [
			{ fieldPath: "userId", order: "ASCENDING" },
			{ fieldPath: "createdAt", order: "DESCENDING" },
		],
	};
	const descThenAsc = {
		collectionGroup: "items",
		queryScope: "COLLECTION",
		fields: [
			{ fieldPath: "createdAt", order: "DESCENDING" },
			{ fieldPath: "userId", order: "ASCENDING" },
		],
	};

	it("produces DIFFERENT canonical forms for reordered fields", () => {
		// These are two genuinely different Firestore indexes serving two
		// different queries. Sorting fields away would silently equate them.
		expect(canonicalIndex(ascThenDesc)).not.toBe(canonicalIndex(descThenAsc));
	});

	it("renders fields in declaration order", () => {
		expect(canonicalIndex(ascThenDesc)).toBe(
			"items [COLLECTION/ANY_API] (userId:order=ASCENDING, createdAt:order=DESCENDING)",
		);
	});

	it("defaults an omitted queryScope to COLLECTION and apiScope to ANY_API", () => {
		const bare = { collectionGroup: "items", fields: [{ fieldPath: "a", order: "ASCENDING" }] };
		expect(canonicalIndex(bare)).toBe("items [COLLECTION/ANY_API] (a:order=ASCENDING)");
	});

	it("supports arrayConfig and vectorConfig fields", () => {
		expect(
			canonicalIndex({
				collectionGroup: "items",
				fields: [{ fieldPath: "tags", arrayConfig: "CONTAINS" }],
			}),
		).toContain("tags:array=CONTAINS");
		expect(
			canonicalIndex({
				collectionGroup: "items",
				fields: [{ fieldPath: "embed", vectorConfig: { dimension: 768, flat: {} } }],
			}),
		).toContain("embed:vector=768:flat");
	});

	it("fails loud on an unsupported index attribute rather than ignoring it", () => {
		// A future firestore.indexes.json key we do not know about must not be
		// silently dropped — that would let real drift through the gate.
		try {
			canonicalIndex({
				collectionGroup: "items",
				density: "SPARSE_ALL",
				fields: [{ fieldPath: "a", order: "ASCENDING" }],
			});
			expect.unreachable("should have thrown");
		} catch (err) {
			expect((err as Error).message).toContain('unsupported index attribute "density"');
			expect((err as { code: number }).code).toBe(EXIT.USAGE);
		}
	});

	it("rejects an index with no fields and a field with no direction", () => {
		expect(() => canonicalIndex({ collectionGroup: "items", fields: [] })).toThrow(/no fields/);
		expect(() =>
			canonicalIndex({ collectionGroup: "items", fields: [{ fieldPath: "a" }] }),
		).toThrow(/no order\/arrayConfig\/vectorConfig/);
	});
});

describe("stripImplicitNameField", () => {
	const f = (fieldPath: string, mode: string) => ({ fieldPath, mode });

	it("drops a trailing __name__ that matches the previous field's direction", () => {
		const fields = [f("userId", "order=ASCENDING"), f("__name__", "order=ASCENDING")];
		expect(stripImplicitNameField(fields)).toEqual([f("userId", "order=ASCENDING")]);
	});

	it("KEEPS an explicit __name__ pointing the other way — that is a different index", () => {
		const fields = [f("userId", "order=ASCENDING"), f("__name__", "order=DESCENDING")];
		expect(stripImplicitNameField(fields)).toHaveLength(2);
	});

	it("treats ASCENDING as the implied direction after an array-contains field", () => {
		const fields = [f("tags", "array=CONTAINS"), f("__name__", "order=ASCENDING")];
		expect(stripImplicitNameField(fields)).toEqual([f("tags", "array=CONTAINS")]);
	});

	it("leaves a lone field alone", () => {
		expect(stripImplicitNameField([f("a", "order=ASCENDING")])).toHaveLength(1);
	});
});

describe("normalizeDeployedIndexes vs normalizeLocalIndexes", () => {
	const localFile = {
		indexes: [
			{
				collectionGroup: "items",
				queryScope: "COLLECTION",
				fields: [
					{ fieldPath: "userId", order: "ASCENDING" },
					{ fieldPath: "createdAt", order: "DESCENDING" },
				],
			},
		],
		fieldOverrides: [],
	};

	const deployed = [
		{
			name: "projects/p/databases/(default)/collectionGroups/items/indexes/CICAgOjK8IAK",
			queryScope: "COLLECTION",
			apiScope: "ANY_API",
			state: "READY",
			fields: [
				{ fieldPath: "userId", order: "ASCENDING" },
				{ fieldPath: "createdAt", order: "DESCENDING" },
				{ fieldPath: "__name__", order: "DESCENDING" },
			],
		},
	];

	it("matches the repo file against the API shape (implicit __name__, state, name)", () => {
		expect(normalizeDeployedIndexes(deployed)).toEqual(normalizeLocalIndexes(localFile));
	});

	it("ignores server-only state — a CREATING index is deployed, not drift", () => {
		const creating = [{ ...deployed[0], state: "CREATING" }];
		expect(normalizeDeployedIndexes(creating)).toEqual(normalizeLocalIndexes(localFile));
	});

	it("ignores the ORDER of the index list — that ordering is not semantic", () => {
		const a = { collectionGroup: "a", fields: [{ fieldPath: "x", order: "ASCENDING" }] };
		const b = { collectionGroup: "b", fields: [{ fieldPath: "y", order: "ASCENDING" }] };
		expect(normalizeIndexList([a, b], "t")).toEqual(normalizeIndexList([b, a], "t"));
	});

	it("reports a reordered FIELD list as different", () => {
		const swapped = {
			indexes: [
				{
					collectionGroup: "items",
					queryScope: "COLLECTION",
					fields: [
						{ fieldPath: "createdAt", order: "DESCENDING" },
						{ fieldPath: "userId", order: "ASCENDING" },
					],
				},
			],
		};
		expect(normalizeLocalIndexes(swapped)).not.toEqual(normalizeLocalIndexes(localFile));
	});

	it("treats a missing `indexes` key as an empty list", () => {
		expect(normalizeLocalIndexes({})).toEqual([]);
	});

	it("rejects a malformed `indexes` value", () => {
		expect(() => normalizeLocalIndexes({ indexes: "nope" })).toThrow(/must be an array/);
	});

	it("rejects a malformed API index name rather than guessing the collection group", () => {
		expect(() => normalizeDeployedIndexes([{ name: "garbage", fields: [] }])).toThrow(
			/could not parse a collection group/,
		);
	});
});

describe("collectionGroupFromName", () => {
	it("extracts and URL-decodes the collection group", () => {
		expect(
			collectionGroupFromName(
				"projects/p/databases/(default)/collectionGroups/my%20items/indexes/x",
			),
		).toBe("my items");
	});
});

describe("field overrides", () => {
	const local = {
		fieldOverrides: [
			{
				collectionGroup: "items",
				fieldPath: "tags",
				ttl: false,
				indexes: [
					{ arrayConfig: "CONTAINS", queryScope: "COLLECTION" },
					{ order: "ASCENDING", queryScope: "COLLECTION" },
				],
			},
		],
	};

	const deployedFields = [
		{
			name: "projects/p/databases/(default)/collectionGroups/items/fields/tags",
			indexConfig: {
				indexes: [
					{ queryScope: "COLLECTION", fields: [{ fieldPath: "tags", order: "ASCENDING" }] },
					{ queryScope: "COLLECTION", fields: [{ fieldPath: "tags", arrayConfig: "CONTAINS" }] },
				],
			},
		},
	];

	it("flattens the API indexConfig shape back to the repo-file shape", () => {
		expect(normalizeDeployedFieldOverrides(deployedFields)).toEqual(
			normalizeLocalFieldOverrides(local),
		);
	});

	it("ignores the order of the per-field index list — it is not semantic", () => {
		const reversed = [
			{
				...deployedFields[0],
				indexConfig: { indexes: [...deployedFields[0].indexConfig.indexes].reverse() },
			},
		];
		expect(normalizeDeployedFieldOverrides(reversed)).toEqual(
			normalizeDeployedFieldOverrides(deployedFields),
		);
	});

	it("drops the collection-group wildcard and inherited-default entries", () => {
		const noise = [
			{ name: "projects/p/databases/(default)/collectionGroups/items/fields/*", indexConfig: {} },
			{ name: "projects/p/databases/(default)/collectionGroups/items/fields/plain" },
		];
		expect(normalizeDeployedFieldOverrides(noise)).toEqual([]);
	});

	it("carries ttlConfig through as the `ttl` flag", () => {
		const withTtl = [
			{
				name: "projects/p/databases/(default)/collectionGroups/items/fields/expiresAt",
				ttlConfig: { state: "ACTIVE" },
			},
		];
		expect(normalizeDeployedFieldOverrides(withTtl)).toEqual([
			canonicalFieldOverride(
				{ collectionGroup: "items", fieldPath: "expiresAt", ttl: true, indexes: [] },
				"t",
			),
		]);
	});

	it("rejects a malformed field-override name", () => {
		expect(() => normalizeDeployedFieldOverrides([{ name: "garbage" }])).toThrow(
			/could not parse a field override name/,
		);
	});
});

describe("evaluateDrift — nothing deployed yet is NOT drift", () => {
	it("passes when no Firestore ruleset exists and says it would be the first", () => {
		const result = evaluateDrift(
			baselineState({ firestoreRules: { source: DENY_ALL, deployed: null } }),
		);
		expect(result.drift).toBe(false);
		const section = result.sections.find((s) => s.name === "firestore.rules");
		expect(section?.status).toBe("first-deploy");
		expect(section?.lines.join(" ")).toContain("this would be the first");
	});

	it("passes when no Storage ruleset exists", () => {
		const result = evaluateDrift(
			baselineState({ storageRules: { source: DENY_ALL, deployed: [] } }),
		);
		expect(result.drift).toBe(false);
		expect(result.sections.find((s) => s.name === "storage.rules")?.status).toBe("first-deploy");
	});

	it("passes when the Firestore database has never been provisioned", () => {
		const result = evaluateDrift(
			baselineState({
				indexes: { local: ["items [COLLECTION/ANY_API] (a:order=ASCENDING)"], deployed: null },
				fieldOverrides: { local: [], deployed: null },
			}),
		);
		expect(result.drift).toBe(false);
		const section = result.sections.find((s) => s.name.endsWith("indexes"));
		expect(section?.status).toBe("first-deploy");
		expect(section?.lines.join(" ")).toContain("no Firestore database provisioned yet");
	});

	it("passes when indexes exist in the repo but none are deployed yet", () => {
		const result = evaluateDrift(
			baselineState({
				indexes: { local: ["items [COLLECTION/ANY_API] (a:order=ASCENDING)"], deployed: [] },
			}),
		);
		expect(result.drift).toBe(false);
		expect(result.sections.find((s) => s.name.endsWith("indexes"))?.lines.join(" ")).toContain(
			"would create 1",
		);
	});

	it("is the ACTUAL current state of both projects — fully empty repo, nothing live", () => {
		const result = evaluateDrift({
			firestoreRules: { source: DENY_ALL, deployed: null },
			storageRules: { source: DENY_ALL, deployed: [] },
			indexes: { local: [], deployed: null },
			fieldOverrides: { local: [], deployed: null },
		});
		expect(result.drift).toBe(false);
		expect(result.sections.every((s) => s.status === "first-deploy")).toBe(true);
	});
});

describe("evaluateDrift — no drift", () => {
	it("reports every surface as matching", () => {
		const result = evaluateDrift(baselineState());
		expect(result.drift).toBe(false);
		expect(result.sections.map((s) => s.status)).toEqual(["match", "match", "match", "match"]);
	});

	it("tolerates cosmetic whitespace differences in a deployed ruleset", () => {
		const result = evaluateDrift(
			baselineState({
				firestoreRules: {
					source: DENY_ALL,
					deployed: `${DENY_ALL.replace(/\n/g, "\r\n")}\n\n\n`,
				},
			}),
		);
		expect(result.drift).toBe(false);
		expect(result.sections.find((s) => s.name === "firestore.rules")?.status).toBe("match");
	});

	it("reports a comment-only difference as `cosmetic` and does NOT block", () => {
		const result = evaluateDrift(
			baselineState({
				firestoreRules: { source: `// repo header\n${DENY_ALL}`, deployed: DENY_ALL },
			}),
		);
		expect(result.drift).toBe(false);
		const section = result.sections.find((s) => s.name === "firestore.rules");
		expect(section?.status).toBe("cosmetic");
		expect(section?.lines.join(" ")).toContain("rule logic is identical");
	});

	it("reports a comment-only difference on a storage bucket as `cosmetic`", () => {
		const result = evaluateDrift(
			baselineState({
				storageRules: {
					source: `// repo header\n${DENY_ALL}`,
					deployed: [{ bucket: "b.appspot.com", source: DENY_ALL }],
				},
			}),
		);
		expect(result.drift).toBe(false);
		expect(result.sections.find((s) => s.name === "storage.rules")?.status).toBe("cosmetic");
	});
});

describe("evaluateDrift — drift present", () => {
	it("flags a live ruleset that has been loosened out from under the repo", () => {
		const loosened = DENY_ALL.replace("if false", "if true");
		const result = evaluateDrift(
			baselineState({ firestoreRules: { source: DENY_ALL, deployed: loosened } }),
		);
		expect(result.drift).toBe(true);
		const section = result.sections.find((s) => s.name === "firestore.rules");
		expect(section?.status).toBe("drift");
		expect(section?.lines.join("\n")).toContain("if true");
		expect(section?.lines.join("\n")).toContain("if false");
	});

	it("flags an index that exists live but not in the repo as a pending DELETION", () => {
		const result = evaluateDrift(
			baselineState({
				indexes: {
					local: ["items [COLLECTION/ANY_API] (a:order=ASCENDING)"],
					deployed: [
						"items [COLLECTION/ANY_API] (a:order=ASCENDING)",
						"items [COLLECTION/ANY_API] (consoleAdded:order=DESCENDING)",
					],
				},
			}),
		);
		expect(result.drift).toBe(true);
		const lines = result.sections.find((s) => s.name.endsWith("indexes"))?.lines.join("\n") ?? "";
		expect(lines).toContain("would be DELETED");
		expect(lines).toContain("consoleAdded");
	});

	it("flags a repo index missing from prod as pending CREATION (silent degradation)", () => {
		const result = evaluateDrift(
			baselineState({
				indexes: {
					local: ["items [COLLECTION/ANY_API] (a:order=ASCENDING)"],
					deployed: ["items [COLLECTION/ANY_API] (b:order=ASCENDING)"],
				},
			}),
		);
		expect(result.drift).toBe(true);
		const lines = result.sections.find((s) => s.name.endsWith("indexes"))?.lines.join("\n") ?? "";
		expect(lines).toContain("would be CREATED");
	});

	it("flags one drifted bucket among several matching storage releases", () => {
		const result = evaluateDrift(
			baselineState({
				storageRules: {
					source: DENY_ALL,
					deployed: [
						{ bucket: "ok.appspot.com", source: DENY_ALL },
						{ bucket: "stale.appspot.com", source: DENY_ALL.replace("false", "true") },
					],
				},
			}),
		);
		expect(result.drift).toBe(true);
		expect(result.sections.find((s) => s.name === "storage.rules")?.lines.join("\n")).toContain(
			"bucket stale.appspot.com",
		);
	});
});

describe("formatSetDiff", () => {
	it("labels repo-only as CREATED and live-only as DELETED", () => {
		const lines = formatSetDiff(["a", "b"], ["b", "c"]);
		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain("only in repo (would be CREATED)");
		expect(lines[0]).toContain("a");
		expect(lines[1]).toContain("only live (would be DELETED)");
		expect(lines[1]).toContain("c");
	});
});

describe("formatReport", () => {
	it("states the refusal explicitly when there is drift", () => {
		const report = formatReport(
			"conversational-assistant-dev",
			"dev",
			evaluateDrift(
				baselineState({
					firestoreRules: { source: DENY_ALL, deployed: DENY_ALL.replace("false", "true") },
				}),
			),
		);
		expect(report).toContain("conversational-assistant-dev");
		expect(report).toContain("DRIFT DETECTED — refusing to deploy.");
	});

	it("says it is safe to deploy when everything matches", () => {
		const report = formatReport("p", "dev", evaluateDrift(baselineState()));
		expect(report).toContain("No drift. Safe to deploy.");
	});
});

describe("classifyHttpError — distinct, actionable failures", () => {
	it("calls out a disabled API by name", () => {
		const err = classifyHttpError(
			403,
			'{"error":{"message":"Cloud Firestore API has not been used in project 123 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/firestore.googleapis.com/overview","status":"PERMISSION_DENIED"}}',
			"composite indexes",
		);
		expect(err.code).toBe(EXIT.PERMISSION);
		expect(err.message).toContain("firestore.googleapis.com");
		expect(err.message).toContain("not enabled");
	});

	it("separates plain permission-denied from a disabled API", () => {
		const err = classifyHttpError(
			403,
			'{"error":{"status":"PERMISSION_DENIED"}}',
			"composite indexes",
		);
		expect(err.code).toBe(EXIT.PERMISSION);
		expect(err.message).toContain("permission denied");
		expect(err.hint).toContain("roles/datastore.viewer");
	});

	it("classifies 401 as a credentials problem, not a permissions one", () => {
		const err = classifyHttpError(401, "", "rules releases");
		expect(err.code).toBe(EXIT.CREDENTIALS);
	});

	it("falls through to a bad-response code for anything else", () => {
		const err = classifyHttpError(500, "boom", "rules releases");
		expect(err.code).toBe(EXIT.BAD_RESPONSE);
		expect(err.message).toContain("HTTP 500");
	});

	it("never yields exit code 0 — every failure blocks the deploy", () => {
		for (const status of [401, 403, 429, 500, 503]) {
			expect(classifyHttpError(status, "", "x").code).not.toBe(EXIT.OK);
		}
	});
});

describe("isFirestoreNotProvisioned — the narrow fail-open", () => {
	const disabled = (api: string) =>
		classifyHttpError(
			403,
			`{"error":{"message":"${api} has not been used in project 1 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/${api}/overview"}}`,
			"composite indexes",
		);

	it("recognises a disabled Cloud Firestore API as nothing-deployed, not as drift", () => {
		// This is prod's real state: no Firestore database has ever been created.
		expect(isFirestoreNotProvisioned(disabled("firestore.googleapis.com"))).toBe(true);
	});

	it("does NOT fail open on a plain permission-denied — that one can hide real drift", () => {
		expect(
			isFirestoreNotProvisioned(classifyHttpError(403, "PERMISSION_DENIED", "composite indexes")),
		).toBe(false);
	});

	it("does NOT fail open for a different disabled API", () => {
		expect(isFirestoreNotProvisioned(disabled("firebaserules.googleapis.com"))).toBe(false);
	});

	it("does NOT fail open on a 500 or on a non-DriftCheckError", () => {
		expect(isFirestoreNotProvisioned(classifyHttpError(500, "boom", "x"))).toBe(false);
		expect(isFirestoreNotProvisioned(new Error("firestore.googleapis.com is not enabled"))).toBe(
			false,
		);
	});
});

describe("evaluateDrift — the not-provisioned reason reaches the report", () => {
	it("says WHY there is nothing to compare when the Firestore API is off", () => {
		const result = evaluateDrift({
			firestoreRules: { source: DENY_ALL, deployed: null },
			storageRules: { source: DENY_ALL, deployed: [] },
			indexes: {
				local: [],
				deployed: null,
				reason: "the Cloud Firestore API is not enabled on this project",
			},
			fieldOverrides: {
				local: [],
				deployed: null,
				reason: "the Cloud Firestore API is not enabled on this project",
			},
		});
		expect(result.drift).toBe(false);
		expect(formatReport("conversational-assistant-2269b", "prod", result)).toContain(
			"the Cloud Firestore API is not enabled on this project",
		);
	});
});

// ---------------------------------------------------------------------------
// F63 / Task 63.4a (Slice 2) — the drift gate round-trips the REAL F63 rules
// (S17). No new gate: these drive the existing `compareRules` / `evaluateDrift`
// with the checked-in firestore.rules, read at test load.
// ---------------------------------------------------------------------------

describe("F63 — the drift gate over the real firestore.rules (S17)", () => {
	const REPO_RULES = readFileSync(join(__dirname, "fixtures", "kaeme.firestore.rules"), "utf8");

	it("precondition: the checked-in ruleset is F63's (a users/{uid} match), not the Slice 0 deny-all", () => {
		expect(stripRulesComments(REPO_RULES)).toMatch(/match\s+\/users\/\{uid\}/);
		expect(compareRules(REPO_RULES, DENY_ALL)).not.toBe("match");
	});

	it("[Unit|H] compareRules(new repo rules, the same deployed) → no drift", () => {
		expect(compareRules(REPO_RULES, REPO_RULES)).toBe("match");
		const result = evaluateDrift(
			baselineState({ firestoreRules: { source: REPO_RULES, deployed: REPO_RULES } }),
		);
		expect(result.drift).toBe(false);
	});

	it("[Unit|H] deployed = Slice 0 deny-all AS origin/main's version, repo = F63 rules → pass, will change", () => {
		expect(compareRules(REPO_RULES, DENY_ALL)).toBe("drift");
		const result = evaluateDrift(
			baselineState({
				firestoreRules: {
					source: REPO_RULES,
					deployed: DENY_ALL,
					acceptable: [{ label: "origin/main", source: DENY_ALL }],
				},
			}),
		);
		expect(result.drift).toBe(false);
		expect(result.sections.find((s) => s.name === "firestore.rules")?.status).toBe("change");
	});

	it("[Unit|U] deployed = deny-all that NO lineage version produced → drift, exit non-zero", () => {
		const result = evaluateDrift(
			baselineState({
				firestoreRules: {
					source: REPO_RULES,
					deployed: DENY_ALL,
					acceptable: [{ label: "origin/main", source: REPO_RULES }],
				},
			}),
		);
		expect(result.drift).toBe(true);
		expect(EXIT.DRIFT).not.toBe(0);
		expect(formatReport("conversational-assistant-dev", "dev", result)).toMatch(/drift/i);
	});

	it("[Unit|E] a comment-only difference on the F63 rules → cosmetic, not drift (stripRulesComments)", () => {
		const commented = `// deployed with an older header\n${REPO_RULES}\n// trailing note\n`;
		expect(compareRules(REPO_RULES, commented)).toBe("cosmetic");
		const result = evaluateDrift(
			baselineState({ firestoreRules: { source: REPO_RULES, deployed: commented } }),
		);
		expect(result.drift).toBe(false);
	});

	it("[Unit|E] nothing deployed yet for Firestore rules → a pass, not drift (kept behaviour)", () => {
		const result = evaluateDrift(
			baselineState({ firestoreRules: { source: REPO_RULES, deployed: null } }),
		);
		expect(result.drift).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Lineage baseline — drift = live matches NO version this branch's lineage
// produced (baseline ref, this branch's earlier commits, working tree).
// ---------------------------------------------------------------------------

describe("evaluateDrift — lineage baseline (rules)", () => {
	const SLICE2 = DENY_ALL.replace(
		"match /{document=**} {",
		"match /users/{uid} {\n      allow read: if request.auth.uid == uid;\n    }\n    match /{document=**} {",
	);
	const SLICE3 = SLICE2.replace("allow read:", "allow read, write:");
	const CONSOLE_EDIT = DENY_ALL.replace("if false", "if true");
	const lineage = [
		{ label: "origin/main", source: DENY_ALL },
		{ label: "abc1234 (this branch)", source: SLICE2 },
	];
	const rulesState = (deployed: string, acceptable = lineage) =>
		baselineState({ firestoreRules: { source: SLICE3, deployed, acceptable } });
	const section = (result: ReturnType<typeof evaluateDrift>) =>
		result.sections.find((s) => s.name === "firestore.rules");

	it("live = origin/main, repo changed → pass, says which matched and that the deploy will CHANGE it", () => {
		const result = evaluateDrift(rulesState(DENY_ALL));
		expect(result.drift).toBe(false);
		expect(section(result)?.status).toBe("change");
		const text = section(result)?.lines.join("\n") ?? "";
		expect(text).toContain("live = origin/main");
		expect(text).toContain("will CHANGE");
		expect(text).toContain("users/{uid}"); // the +/- diff is carried through
		expect(formatReport("p", "dev", result)).toContain("will CHANGE on this deploy");
	});

	it("live = an earlier commit on this branch → pass, labelled with its short sha", () => {
		const result = evaluateDrift(rulesState(SLICE2));
		expect(result.drift).toBe(false);
		expect(section(result)?.lines[0]).toContain("live = abc1234 (this branch)");
	});

	it("live = working tree → match, labelled working tree", () => {
		const result = evaluateDrift(rulesState(SLICE3));
		expect(section(result)?.status).toBe("match");
		expect(section(result)?.lines).toEqual(["  live = working tree"]);
	});

	it("a comment-only variant of a lineage version still counts as that version", () => {
		const result = evaluateDrift(rulesState(`// console-deployed header\n${DENY_ALL}`));
		expect(result.drift).toBe(false);
		expect(section(result)?.status).toBe("change");
	});

	it("live = unknown text (console edit) → DRIFT, naming every version it was checked against", () => {
		const result = evaluateDrift(rulesState(CONSOLE_EDIT));
		expect(result.drift).toBe(true);
		const text = section(result)?.lines.join("\n") ?? "";
		expect(text).toContain("NONE of the 3 versions");
		expect(text).toContain("working tree, origin/main, abc1234 (this branch)");
		expect(formatReport("p", "dev", result)).toContain("DRIFT DETECTED — refusing to deploy.");
	});

	it("mutate-then-red: drop origin/main from the acceptable set → the live = main case goes red", () => {
		expect(evaluateDrift(rulesState(DENY_ALL)).drift).toBe(false);
		const withoutMain = lineage.filter((v) => v.label !== "origin/main");
		expect(evaluateDrift(rulesState(DENY_ALL, withoutMain)).drift).toBe(true);
	});

	it("storage.rules follows the same rule, per bucket", () => {
		const result = evaluateDrift(
			baselineState({
				storageRules: {
					source: SLICE3,
					deployed: [
						{ bucket: "a.appspot.com", source: DENY_ALL },
						{ bucket: "b.appspot.com", source: SLICE3 },
					],
					acceptable: lineage,
				},
			}),
		);
		expect(result.drift).toBe(false);
		const storage = result.sections.find((s) => s.name === "storage.rules");
		expect(storage?.status).toBe("change");
		expect(storage?.lines.join("\n")).toContain("live = origin/main");

		const red = evaluateDrift(
			baselineState({
				storageRules: {
					source: SLICE3,
					deployed: [{ bucket: "a.appspot.com", source: CONSOLE_EDIT }],
					acceptable: lineage,
				},
			}),
		);
		expect(red.drift).toBe(true);
	});
});

describe("evaluateDrift — lineage baseline (indexes + field overrides)", () => {
	const A = "items [COLLECTION/ANY_API] (a:order=ASCENDING)";
	const B = "items [COLLECTION/ANY_API] (b:order=ASCENDING)";
	const CONSOLE = "items [COLLECTION/ANY_API] (consoleAdded:order=DESCENDING)";
	const acceptable = [
		{ label: "origin/main", local: [A] },
		{ label: "def5678 (this branch)", local: [A, B] },
	];

	it("live = origin/main's set, repo adds one → pass, will CHANGE, shows what gets CREATED", () => {
		const result = evaluateDrift(
			baselineState({ indexes: { local: [A, B, CONSOLE], deployed: [A], acceptable } }),
		);
		expect(result.drift).toBe(false);
		const s = result.sections.find((x) => x.name.endsWith("indexes"));
		expect(s?.status).toBe("change");
		expect(s?.lines.join("\n")).toContain("live = origin/main");
		expect(s?.lines.join("\n")).toContain("would be CREATED");
	});

	it("live = an earlier branch set (order-insensitive) → pass", () => {
		const result = evaluateDrift(
			baselineState({ indexes: { local: [A], deployed: [B, A], acceptable } }),
		);
		expect(result.drift).toBe(false);
		expect(result.sections.find((x) => x.name.endsWith("indexes"))?.lines[0]).toContain(
			"def5678 (this branch)",
		);
	});

	it("live has a console-added index no version has → DRIFT", () => {
		const result = evaluateDrift(
			baselineState({ indexes: { local: [A, B], deployed: [A, CONSOLE], acceptable } }),
		);
		expect(result.drift).toBe(true);
		expect(result.sections.find((x) => x.name.endsWith("indexes"))?.lines.join("\n")).toContain(
			"would be DELETED",
		);
	});

	it("mutate-then-red: drop origin/main → the live = main index set goes red", () => {
		const state = (acc: typeof acceptable) =>
			baselineState({ indexes: { local: [A, B, CONSOLE], deployed: [A], acceptable: acc } });
		expect(evaluateDrift(state(acceptable)).drift).toBe(false);
		expect(evaluateDrift(state(acceptable.slice(1))).drift).toBe(true);
	});

	it("fieldOverrides follow the same rule", () => {
		const F1 = "items.tags [no-ttl] {COLLECTION:array=CONTAINS}";
		const F2 = "items.tags [no-ttl] {COLLECTION:array=CONTAINS, COLLECTION:order=ASCENDING}";
		const ok = evaluateDrift(
			baselineState({
				fieldOverrides: {
					local: [F2],
					deployed: [F1],
					acceptable: [{ label: "origin/main", local: [F1] }],
				},
			}),
		);
		expect(ok.drift).toBe(false);
		expect(ok.sections.find((x) => x.name.endsWith("fieldOverrides"))?.status).toBe("change");
		const red = evaluateDrift(
			baselineState({ fieldOverrides: { local: [F2], deployed: [F1], acceptable: [] } }),
		);
		expect(red.drift).toBe(true);
	});
});

describe("indexLineage", () => {
	it("normalizes every version's indexes and fieldOverrides, keeping the label", () => {
		const src = JSON.stringify({
			indexes: [{ collectionGroup: "items", fields: [{ fieldPath: "a", order: "ASCENDING" }] }],
		});
		expect(indexLineage([{ label: "origin/main", source: src }])).toEqual([
			{
				label: "origin/main",
				indexes: ["items [COLLECTION/ANY_API] (a:order=ASCENDING)"],
				fieldOverrides: [],
			},
		]);
	});

	it("fails loud on a version that is not valid JSON", () => {
		expect(() => indexLineage([{ label: "abc1234 (this branch)", source: "{nope" }])).toThrow(
			/at abc1234 \(this branch\) is not valid JSON/,
		);
	});
});

describe("readLineageVersions — the injectable git reader", () => {
	const BASE = "b".repeat(40);
	const C1 = "c1c1c1c".padEnd(40, "0");
	const C2 = "c2c2c2c".padEnd(40, "0");
	type Res = { status: number | null; stdout: string; stderr: string; error?: Error };

	/** A fake `git` answering the four commands the reader issues. */
	function fakeGit(opts: {
		refs?: Record<string, string>;
		trees?: Record<string, Record<string, string>>;
		log?: Record<string, string[]>;
		history?: Record<string, string[]>;
	}) {
		const calls: string[][] = [];
		const run = (args: string[]): Res => {
			calls.push(args);
			const ok = (stdout: string): Res => ({ status: 0, stdout, stderr: "" });
			if (args[0] === "rev-parse") {
				const sha = opts.refs?.[args[3].replace("^{commit}", "")];
				return sha ? ok(`${sha}\n`) : { status: 1, stdout: "", stderr: "" };
			}
			if (args[0] === "ls-tree") {
				return ok(opts.trees?.[args[2]]?.[args[4]] !== undefined ? `${args[4]}\n` : "");
			}
			if (args[0] === "show") {
				const i = args[1].indexOf(":");
				return ok(opts.trees?.[args[1].slice(0, i)]?.[args[1].slice(i + 1)] ?? "");
			}
			if (args[0] === "log" && args[1] === "--format=%H" && args[2].endsWith("..HEAD")) {
				return ok((opts.log?.[args[4]] ?? []).join("\n"));
			}
			if (args[0] === "log" && args[1] === "--first-parent" && args[3] === "2") {
				return ok((opts.history?.[args[7]] ?? []).slice(0, 2).join("\n"));
			}
			return { status: 128, stdout: "", stderr: `unexpected ${args.join(" ")}` };
		};
		return { run, calls };
	}

	it("returns the baseline version then this branch's commits (newest first)", () => {
		const { run } = fakeGit({
			refs: { "origin/main": BASE },
			trees: {
				[BASE]: { "firestore.rules": "v0" },
				[C2]: { "firestore.rules": "v2" },
				[C1]: { "firestore.rules": "v1" },
			},
			log: { "firestore.rules": [C2, C1] },
		});
		expect(readLineageVersions(["firestore.rules"], { baseline: "origin/main", git: run })).toEqual(
			{
				"firestore.rules": [
					{ label: "origin/main", source: "v0" },
					{ label: "c2c2c2c (this branch)", source: "v2" },
					{ label: "c1c1c1c (this branch)", source: "v1" },
				],
			},
		);
	});

	const H1 = "a1a1a1a".padEnd(40, "0");
	const H2 = "a2a2a2a".padEnd(40, "0");

	it("appends the version the baseline replaced — one back only, never older", () => {
		const { run } = fakeGit({
			refs: { "origin/main": BASE },
			trees: {
				[BASE]: { "firestore.rules": "v0" },
				[C1]: { "firestore.rules": "v1" },
				[H1]: { "firestore.rules": "h1" },
				[H2]: { "firestore.rules": "h2" },
			},
			log: { "firestore.rules": [C1] },
			history: { "firestore.rules": [BASE, H1, H2] },
		});
		expect(readLineageVersions(["firestore.rules"], { git: run })["firestore.rules"]).toEqual([
			{ label: "origin/main", source: "v0" },
			{ label: "c1c1c1c (this branch)", source: "v1" },
			{ label: "a1a1a1a (previous on origin/main)", source: "h1" },
		]);
	});

	it("baseline commit didn't touch the file → previous is the second commit that did, not the first", () => {
		const { run } = fakeGit({
			refs: { "origin/main": BASE },
			trees: {
				[BASE]: { "firestore.rules": "h1" },
				[H1]: { "firestore.rules": "h1" },
				[H2]: { "firestore.rules": "h2" },
			},
			history: { "firestore.rules": [H1, H2] },
		});
		expect(readLineageVersions(["firestore.rules"], { git: run })["firestore.rules"]).toEqual([
			{ label: "origin/main", source: "h1" },
			{ label: "a2a2a2a (previous on origin/main)", source: "h2" },
		]);
	});

	it("file has only one version on the baseline → no previous version added", () => {
		const { run } = fakeGit({
			refs: { "origin/main": BASE },
			trees: { [BASE]: { "firestore.rules": "v0" } },
			history: { "firestore.rules": [BASE] },
		});
		expect(readLineageVersions(["firestore.rules"], { git: run })["firestore.rules"]).toEqual([
			{ label: "origin/main", source: "v0" },
		]);
	});

	it("walks the baseline's first-parent history, 2 commits, path-limited to the file", () => {
		const { run, calls } = fakeGit({ refs: { "origin/main": BASE }, trees: { [BASE]: {} } });
		readLineageVersions(["firestore.rules"], { git: run });
		expect(calls).toContainEqual([
			"log",
			"--first-parent",
			"-n",
			"2",
			"--format=%H",
			BASE,
			"--",
			"firestore.rules",
		]);
	});

	it("a file absent at the baseline (new surface) just contributes no baseline version", () => {
		const { run } = fakeGit({
			refs: { "origin/main": BASE },
			trees: { [BASE]: {}, [C1]: { "storage.rules": "s1" } },
			log: { "storage.rules": [C1] },
		});
		expect(readLineageVersions(["storage.rules"], { git: run })["storage.rules"]).toEqual([
			{ label: "c1c1c1c (this branch)", source: "s1" },
		]);
	});

	it("walks <baseline-sha>..HEAD path-limited to the file", () => {
		const { run, calls } = fakeGit({ refs: { "origin/main": BASE }, trees: { [BASE]: {} } });
		readLineageVersions(["firestore.indexes.json"], { git: run });
		expect(calls).toContainEqual([
			"log",
			"--format=%H",
			`${BASE}..HEAD`,
			"--",
			"firestore.indexes.json",
		]);
	});

	it("missing baseline ref → USAGE (exit 2) with a `git fetch origin` hint, no fallback", () => {
		const { run, calls } = fakeGit({ refs: {} });
		try {
			readLineageVersions(["firestore.rules"], { baseline: "origin/main", git: run });
			expect.unreachable("should have thrown");
		} catch (err) {
			expect((err as { code: number }).code).toBe(EXIT.USAGE);
			expect(EXIT.USAGE).toBe(2);
			expect((err as Error).message).toContain('baseline ref "origin/main" not found');
			expect((err as { hint: string }).hint).toContain("git fetch origin");
		}
		expect(calls).toHaveLength(1); // nothing else is read after the failed probe
	});

	it("git unavailable → USAGE, not a silent working-tree-only check", () => {
		const enoent = Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" });
		const run = (): Res => ({ status: null, stdout: "", stderr: "", error: enoent });
		expect(() => readLineageVersions(["firestore.rules"], { git: run })).toThrow(
			/git is unavailable \(ENOENT\)/,
		);
	});

	it("rejects a baseline that would be parsed as a git option", () => {
		const { run } = fakeGit({});
		expect(() =>
			readLineageVersions(["firestore.rules"], { baseline: "--output=x", git: run }),
		).toThrow(/invalid baseline ref/);
	});
});

// ---------------------------------------------------------------------------
// F1 (central gate) — storage.rules is optional: projects without it (MediaTracker,
// PlaylistModifier) don't deploy Storage, so there is nothing to compare.
// ---------------------------------------------------------------------------
describe("evaluateDrift — project without storage.rules", () => {
	it("skips the storage section when the repo has no storage.rules and nothing is live", () => {
		const result = evaluateDrift(baselineState({ storageRules: { source: null, deployed: [] } }));
		const storage = result.sections.find((s: { name: string }) => s.name === "storage.rules");
		expect(storage.status).toBe("skipped");
		expect(result.drift).toBe(false);
	});

	it("still skips (never drift) when live Storage rules exist but the repo doesn't manage them", () => {
		const result = evaluateDrift(
			baselineState({ storageRules: { source: null, deployed: [{ bucket: "b.appspot.com", source: DENY_ALL }] } }),
		);
		const storage = result.sections.find((s: { name: string }) => s.name === "storage.rules");
		expect(storage.status).toBe("skipped");
		expect(storage.lines.join("\n")).toMatch(/not managed by this repo/);
		expect(result.drift).toBe(false);
	});

	it("renders a skipped section with its own icon, not '?'", () => {
		const result = evaluateDrift(baselineState({ storageRules: { source: null, deployed: [] } }));
		const report = formatReport("p-id", "staging", result);
		expect(report).toMatch(/^- storage\.rules: skipped/m);
		expect(report).toContain("No drift. Safe to deploy.");
	});
});

describe("parseArgs — --repo", () => {
	it("accepts --repo <dir> for the project being checked", () => {
		expect(parseArgs(["--project", "staging", "--repo", "/tmp/x"]).repo).toBe("/tmp/x");
	});

	it("leaves repo unset when not passed (main falls back to the cwd)", () => {
		expect(parseArgs(["--project", "staging"]).repo).toBeUndefined();
	});
});
