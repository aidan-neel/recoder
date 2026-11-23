import { expect, test } from 'bun:test';
import type { CandidateFinding } from '../../../src/review/pipeline/consolidate';
import { consolidateFindings, sameIssue } from '../../../src/review/pipeline/consolidate-merge';
import { buildInventory } from '../../../src/review/pipeline/inventory';
import { envFlag } from '../../helpers/env-flag';

envFlag('RECODER_VERIFIER_SESSION_FIXES', '1');

/** Different overflow claims sharing an anchor and most of their vocabulary, as in p-limit-2/d1,d2. */
function candidate(id: string, trigger: string): CandidateFinding {
	return {
		id,
		candidateId: id,
		valid: true,
		kind: 'bug',
		category: 'correctness',
		severity: 'error',
		file: 'index.js',
		line: 109,
		fingerprint: 'overflow-dispatch',
		title: 'Overflow dispatch violates queue concurrency',
		message:
			'The queue overflow dispatch ignores the pending concurrency limit and must check activeCount before scheduling another task.',
		claim: {
			trigger,
			consequence: 'The queue violates its concurrency contract',
			violatedContract: 'Dispatch respects available running slots',
			executionPath: []
		},
		verification: {
			status: 'verified',
			method: 'run',
			reason: `Proof for ${trigger}`,
			command: `node ${id}.js`,
			exitCode: 1
		}
	};
}

test('p-limit overflow and drop-oldest claims keep their own proofs and both remain published', () => {
	const a = candidate('d1', 'maxPending is zero while a running slot is free');
	const b = candidate('d2', 'drop-oldest evicts a pending task while all running slots are occupied');
	const inventory = buildInventory('');

	process.env.RECODER_VERIFIER_SESSION_FIXES = '0';

	try {
		expect(sameIssue(a, b, inventory)).toBe(true);
		expect(consolidateFindings([a, b], inventory)).toHaveLength(1);
	} finally {
		process.env.RECODER_VERIFIER_SESSION_FIXES = '1';
	}

	expect(sameIssue(a, b, inventory)).toBe(false);

	const findings = consolidateFindings([a, b], inventory);

	expect(findings).toHaveLength(2);

	for (const original of [a, b]) {
		const finding = findings.find((item) => item.id === original.id)!;

		expect(finding.memberIds).toEqual([original.id]);
		expect(finding.verification).toEqual(original.verification);
		expect(finding.claim).toEqual(original.claim);
	}
});

test('an identical explicit claim can still share a proof and consolidate duplicate reports', () => {
	const a = candidate('a', 'maxPending is zero');
	const b = { ...candidate('b', 'maxPending is zero'), message: 'The same bug seen by another reviewer.' };
	const inventory = buildInventory('');

	expect(sameIssue(a, b, inventory)).toBe(true);
	expect(consolidateFindings([a, b], inventory)).toHaveLength(1);
});
