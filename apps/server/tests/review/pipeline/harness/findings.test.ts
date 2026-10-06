import { expect, test } from 'bun:test';
import {
	claimTerms,
	dismissalFingerprint,
	matchesDismissal,
	sameClaim
} from '../../../../src/review/pipeline/harness/findings';

/** The line both cache findings sit on. */
const ANCHOR = "\tconst key = request.headers.get('x-tenant') + request.url;";

/** One defect on the cache line, in the words a first reviewer used. */
const SPOOFED = {
	file: 'src/cache.ts',
	category: 'security',
	title: 'Tenant header is trusted from the client',
	message: '[security] Any caller can name another tenant in `x-tenant` and read its cached responses.',
	claim: {
		trigger: "a client sends another tenant's id in the x-tenant header",
		consequence: "the lookup returns that tenant's cached responses",
		violatedContract: 'tenants only see their own cache entries'
	}
};

/** The same defect, re-worded by another reviewer. */
const FORGED = {
	...SPOOFED,
	title: 'Cache key trusts a client-supplied tenant header',
	message:
		"[security] The tenant comes from a header the client controls, so it can read another tenant's cached responses.",
	claim: {
		trigger: 'a client forges the x-tenant header with another tenant id',
		consequence: 'cached responses of another tenant are returned',
		violatedContract: 'tenants only read their own cache entries'
	}
};

/** A different defect on the same line. */
const MISSING = {
	...SPOOFED,
	title: 'Requests without a tenant share one entry',
	message: '[security] A missing header is concatenated as the string `null`.',
	claim: {
		trigger: 'a request arrives with no x-tenant header',
		consequence: 'the key starts with "null", so every untenanted request collides on one entry',
		violatedContract: 'distinct URLs get distinct keys'
	}
};

const terms = (message: string) => [...claimTerms({ file: 'src/a.ts', message }, '').terms].sort();

test('the stemmer gives one term for a word and its plural and tense forms', () => {
	expect(terms('cache caches cached')).toEqual(['cach']);
	expect(terms('use used uses')).toEqual(['us']);
	expect(terms('class classes')).toEqual(['class']);
	expect(terms('need needs')).toEqual(['need']);
	expect(terms('speed')).toEqual(['speed']);
});

test('body words that restate the line are left out, and the same word in a claim field is kept', () => {
	const finding = {
		file: 'src/cache.ts',
		title: 'Tenant is trusted',
		message: '[security] The request header sets the tenant.',
		claim: { trigger: 'a forged header', consequence: 'wrong tenant', violatedContract: 'tenants stay apart' }
	};

	const kept = claimTerms(finding, ANCHOR).terms;

	expect(kept.has('request')).toBe(false);
	expect(kept.has('header')).toBe(true);
	expect(kept.has('tenant')).toBe(true);
	expect(claimTerms(finding, '').terms.has('request')).toBe(true);
});

test('a detector result matches a claim by the share of its own terms the claim holds', () => {
	const result = claimTerms(
		{
			file: 'src/cache.ts',
			title: 'Tenant id is taken from a header the client controls',
			message: '[security] A caller can set it to another tenant.'
		},
		ANCHOR
	);

	expect(result.stated).toBe(false);
	expect(sameClaim(result, claimTerms(SPOOFED, ANCHOR))).toBe(true);
	expect(sameClaim(claimTerms(MISSING, ANCHOR), result)).toBe(false);
});

test('two findings split from one line get different dismissal keys, each matching only its own claim', () => {
	const spoofed = dismissalFingerprint(SPOOFED, ANCHOR);
	const missing = dismissalFingerprint(MISSING, ANCHOR);

	expect(spoofed).not.toBe(missing);
	expect(spoofed.split(':')[0]).toBe(missing.split(':')[0]);
	expect(matchesDismissal(spoofed, spoofed)).toBe(true);
	expect(matchesDismissal(spoofed, dismissalFingerprint(FORGED, ANCHOR))).toBe(true);
	expect(matchesDismissal(spoofed, missing)).toBe(false);
	expect(matchesDismissal(missing, spoofed)).toBe(false);
});

test('a dismissal key stored before the claim was part of it still matches every claim at its place', () => {
	const spoofed = dismissalFingerprint(SPOOFED, ANCHOR);
	const legacy = spoofed.split(':')[0];

	expect(matchesDismissal(legacy, spoofed)).toBe(true);
	expect(matchesDismissal(legacy, dismissalFingerprint(MISSING, ANCHOR))).toBe(true);
	expect(matchesDismissal(spoofed, legacy)).toBe(true);
	expect(matchesDismissal(legacy, dismissalFingerprint({ ...SPOOFED, file: 'src/other.ts' }, ANCHOR))).toBe(false);
});
