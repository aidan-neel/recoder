import { expect, test } from 'bun:test';
import type { FindingVerification } from '@recoder/shared';
import { EvidenceStore } from '../../../src/evidence/evidence';
import {
	candidateFromDetector,
	validateCandidate,
	type CandidateContext,
	type CandidateFinding
} from '../../../src/review/pipeline/consolidate';
import { consolidateFindings } from '../../../src/review/pipeline/consolidate-merge';
import type { DetectorResult } from '../../../src/review/pipeline/detectors/types';
import type { ReviewerFinding } from '../../../src/review/pipeline/finding-schema';
import { refineFingerprint } from '../../../src/review/pipeline/harness/findings';
import { buildInventory } from '../../../src/review/pipeline/inventory';

/**
 * An invented change. The second line of `src/cache.ts` holds two different
 * defects, a spoofable tenant and a missing one; the second line of
 * `src/token.test.ts` drops the error an assertion expected.
 */
const DIFF = `diff --git a/src/cache.ts b/src/cache.ts
--- a/src/cache.ts
+++ b/src/cache.ts
@@ -1,3 +1,4 @@
 export function lookup(cache: Map<string, Response>, request: Request) {
-	return cache.get(request.url);
+	const key = request.headers.get('x-tenant') + request.url;
+	return cache.get(key);
 }
diff --git a/src/token.test.ts b/src/token.test.ts
--- a/src/token.test.ts
+++ b/src/token.test.ts
@@ -1,3 +1,3 @@
 test('rejects an expired token', async () => {
-	await expect(verify(expiredToken)).rejects.toThrow(TokenExpiredError);
+	await expect(verify(expiredToken)).rejects.toThrow();
 });
`;

/** What a reviewer reports, with the claim's execution path left out because no fixture needs one. */
type Report = Omit<Partial<ReviewerFinding>, 'claim'> & {
	title: string;
	body: string;
	claim: Omit<ReviewerFinding['claim'], 'executionPath'>;
};

const SPOOFED: Report = {
	title: 'Tenant header is trusted from the client',
	body: 'Any caller can name another tenant in `x-tenant` and read its cached responses.',
	claim: {
		trigger: "a client sends another tenant's id in the x-tenant header",
		consequence: "the lookup returns that tenant's cached responses",
		violatedContract: 'tenants only see their own cache entries'
	}
};

const FORGED: Report = {
	category: 'api-contract',
	title: 'Cache key trusts a client-supplied tenant header',
	body: "The tenant comes from a header the client controls, so it can read another tenant's cached responses.",
	claim: {
		trigger: 'a client forges the x-tenant header with another tenant id',
		consequence: 'cached responses of another tenant are returned',
		violatedContract: 'tenants only read their own cache entries'
	}
};

const CROSS_TENANT: Report = {
	category: 'correctness',
	title: 'Cross-tenant cache read through x-tenant',
	body: "A client that sets the header to another tenant id reads that tenant's cached responses.",
	claim: {
		trigger: 'the client sets x-tenant to another tenant id',
		consequence: "it reads another tenant's cached responses",
		violatedContract: "one tenant never reads another tenant's cache entries"
	}
};

const MISSING: Report = {
	title: 'Requests without a tenant share one entry',
	body: 'A missing header is concatenated as the string `null`.',
	claim: {
		trigger: 'a request arrives with no x-tenant header',
		consequence: 'the key starts with "null", so every untenanted request collides on one entry',
		violatedContract: 'distinct URLs get distinct keys'
	}
};

/** One report that names both defects, close enough to each to chain them if any single match were enough. */
const BOTH: Report = {
	category: 'correctness',
	title: 'Tenant header builds a weak cache key',
	body: 'A request with no x-tenant header gets a key starting with `null`, and a client can name another tenant to read its cached responses.',
	claim: {
		trigger: 'a request with a missing or forged x-tenant header',
		consequence:
			"requests without a tenant collide on one entry, and a forged tenant reads another tenant's cached responses",
		violatedContract: 'each tenant and URL gets its own cache entry'
	}
};

/** Two distinct defects whose bodies first restate the code of the line they share, word for word. */
const RESTATED =
	"`const key = request.headers.get('x-tenant') + request.url` builds the cache key from the x-tenant request header joined to the request url, and lookup then reads cache.get(key) with that key.";

const RESTATED_SPOOFED: Report = {
	title: SPOOFED.title,
	body: `${RESTATED} The header comes from the client, so a caller can name another tenant.`,
	claim: {
		trigger: "a client sends another tenant's id",
		consequence: "it reads that tenant's cached responses",
		violatedContract: 'tenants only see their own entries'
	}
};

const RESTATED_MISSING: Report = {
	title: 'A missing tenant becomes the text null',
	body: `${RESTATED} Without the header, get returns null, which is joined as text.`,
	claim: {
		trigger: 'a request arrives without the header',
		consequence: 'every untenanted request collides on one entry',
		violatedContract: 'distinct URLs get distinct keys'
	}
};

/** What the `weakened-tests` detector reports for the assertion on line 2 of `src/token.test.ts`. */
const WEAKENED: DetectorResult = {
	detector: 'weakened-tests',
	category: 'tests',
	title: '`rejects an expired token` no longer checks which error is thrown',
	body: 'The old assertion required a specific error (`TokenExpiredError`). The new one passes for any error, so a different failure now satisfies the test.',
	file: 'src/token.test.ts',
	line: 2,
	evidence: 'toThrow(TokenExpiredError) became toThrow()'
};

/** A reviewer's report of the defect `WEAKENED` found. */
const ANY_ERROR: Report = {
	file: 'src/token.test.ts',
	category: 'tests',
	title: 'Expired-token test accepts any error',
	body: 'The assertion lost its `TokenExpiredError` argument, so the test passes whichever error verify throws.',
	claim: {
		trigger: 'verify throws some other error for an expired token',
		consequence: 'the test still passes, so a broken expiry check goes unnoticed',
		violatedContract: 'the test fails unless the expiry error is thrown'
	}
};

/** A reviewer's report of a different defect on the same assertion line. */
const SHARED_FIXTURE: Report = {
	file: 'src/token.test.ts',
	category: 'tests',
	title: 'Shared expiredToken fixture is re-signed by another suite',
	body: 'The `expiredToken` fixture is module state that the refresh suite re-signs, so this test can receive a valid token when suites run in order.',
	claim: {
		trigger: 'the refresh suite runs first and re-signs the shared fixture',
		consequence: 'verify gets a valid token, resolves, and this test fails for an unrelated reason',
		violatedContract: 'each test builds its own fixtures'
	}
};

function context(): CandidateContext {
	const inventory = buildInventory(DIFF);

	return {
		inventory,
		evidence: new EvidenceStore(null, inventory, 1000),
		changeModel: null,
		ledger: { rules: [], sourcesHash: 'h' }
	};
}

const ctx = context();

/** A verified report of `src/cache.ts` line 2 unless `report` says otherwise. */
function verified(
	candidateId: string,
	report: Report,
	evidenceIds: string[],
	method: FindingVerification['method'] = 'trace'
): CandidateFinding {
	const found = validateCandidate(
		{
			file: 'src/cache.ts',
			line: 2,
			severity: 'high',
			category: 'security',
			examples: [],
			fix: [],
			evidenceIds: [],
			...report,
			claim: { executionPath: [], ...report.claim }
		},
		{ candidateId, assignmentId: 'unit-1/security', role: 'reviewer', model: 'fake', lens: null },
		ctx
	);

	return { ...found, evidenceIds, verification: { status: 'verified', method, reason: 'checked' } };
}

test('two different verified defects on one line, sharing category, fingerprint and evidence, stay two findings', () => {
	const spoofed = verified('c1', SPOOFED, ['E1']);
	const missing = verified('c2', MISSING, ['E1']);
	const findings = consolidateFindings([spoofed, missing], ctx.inventory);

	expect([spoofed.line, spoofed.category, spoofed.fingerprint]).toEqual([
		missing.line,
		missing.category,
		missing.fingerprint
	]);

	expect(findings.map((finding) => finding.title).sort()).toEqual([MISSING.title, SPOOFED.title]);
	expect(findings.map((finding) => finding.memberIds)).toEqual([[spoofed.id], [missing.id]]);
	expect(new Set(findings.map((finding) => finding.fingerprint)).size).toBe(2);
});

test('one defect reported three times in different words becomes one finding with three member ids and all evidence', () => {
	const reports = [
		verified('c1', SPOOFED, ['E1']),
		verified('c2', FORGED, ['E2']),
		verified('c3', CROSS_TENANT, ['E3', 'E1'])
	];

	const [finding, ...rest] = consolidateFindings(reports, ctx.inventory);

	expect(rest).toHaveLength(0);
	expect(finding.memberIds).toEqual(reports.map((report) => report.id));
	expect(finding.evidenceIds?.sort()).toEqual(['E1', 'E2', 'E3']);
});

test('a report that names two defects joins one of them without chaining the other in', () => {
	const reports = [
		verified('c1', SPOOFED, []),
		verified('c2', FORGED, []),
		verified('c3', CROSS_TENANT, []),
		verified('c4', MISSING, []),
		verified('c5', BOTH, [])
	];

	const findings = consolidateFindings(reports, ctx.inventory);
	const ids = (...indices: number[]) => indices.map((index) => reports[index].id);

	expect(findings.map((finding) => finding.memberIds)).toEqual([ids(0, 1, 2), ids(3, 4)]);
});

test('reversing the order of the candidates gives byte-identical findings', () => {
	const reports = [
		verified('c4', MISSING, ['E4']),
		verified('c2', FORGED, ['E2'], 'run'),
		verified('c6', { ...SPOOFED, line: 3 }, ['E6']),
		verified('c1', SPOOFED, ['E1', 'E3']),
		verified('c5', BOTH, ['E5']),
		verified('c3', CROSS_TENANT, ['E3'])
	];

	const forward = JSON.stringify(
		consolidateFindings(
			reports.map((report) => structuredClone(report)),
			ctx.inventory
		)
	);

	const reversed = JSON.stringify(
		consolidateFindings(reports.map((report) => structuredClone(report)).reverse(), ctx.inventory)
	);

	expect(reversed).toBe(forward);
});

test('a merged finding keeps every member id, earliest raised first, including one held below the bar', () => {
	const traced = verified('c1', SPOOFED, ['E1']);
	const ran = verified('c2', FORGED, ['E2'], 'run');
	const held = verified('c3', { ...CROSS_TENANT, severity: 'low' }, ['E3']);
	const [finding, ...rest] = consolidateFindings([held, ran, traced], ctx.inventory);

	expect(held.belowBar).toBe(true);
	expect(rest).toHaveLength(0);
	expect(finding.id).toBe(ran.id);
	expect(finding.memberIds).toEqual([traced.id, ran.id, held.id]);
});

test('a detector result and a reviewer report of the same defect on one line become one finding', () => {
	const detected = candidateFromDetector(WEAKENED, { candidateId: 'c1' }, ctx);
	const reported = verified('c2', ANY_ERROR, ['E1'], 'run');
	const findings = consolidateFindings([reported, detected], ctx.inventory);

	expect(detected.fingerprint).toBe(reported.fingerprint);
	expect(findings.map((finding) => finding.memberIds)).toEqual([[detected.id, reported.id]]);
});

test('a detector result and a reviewer report of different defects on one line stay two findings', () => {
	const detected = candidateFromDetector(WEAKENED, { candidateId: 'c1' }, ctx);
	const reported = verified('c2', SHARED_FIXTURE, ['E1'], 'run');
	const findings = consolidateFindings([reported, detected], ctx.inventory);

	expect(detected.fingerprint).toBe(reported.fingerprint);
	expect(findings.map((finding) => finding.memberIds).sort()).toEqual([[detected.id], [reported.id]].sort());
});

test('a finding that stood alone keeps its fingerprint when a more severe defect is split off it', () => {
	const alone = verified('c1', { ...SPOOFED, severity: 'medium' }, ['E1']);
	const [before] = consolidateFindings([structuredClone(alone)], ctx.inventory);
	const after = consolidateFindings([verified('c2', MISSING, ['E2']), structuredClone(alone)], ctx.inventory);
	const kept = after.find((finding) => finding.memberIds?.includes(alone.id));
	const split = after.find((finding) => !finding.memberIds?.includes(alone.id));

	expect(after.map((finding) => finding.severity)).toEqual(['error', 'warning']);
	expect(kept?.fingerprint).toBe(before.fingerprint);
	expect(split?.fingerprint).toBe(refineFingerprint(before.fingerprint ?? '', 2));
});

test('two distinct defects whose bodies restate the line they share stay two findings', () => {
	const findings = consolidateFindings(
		[verified('c1', RESTATED_SPOOFED, []), verified('c2', RESTATED_MISSING, [])],
		ctx.inventory
	);

	expect(findings.map((finding) => finding.title).sort()).toEqual([RESTATED_MISSING.title, RESTATED_SPOOFED.title]);
});
