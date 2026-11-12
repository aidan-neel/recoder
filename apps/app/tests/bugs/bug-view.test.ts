import { describe, expect, test } from 'bun:test';
import type { BaseComparisonResult, Finding, VerificationEvidence } from '@recoder/shared';

import { baseSentence, bugView, shortWhere } from '../../src/lib/bugs/bug-view';

const NO_COMMENTS = { findingComments: undefined };

function finding(change: Partial<Finding> = {}): Finding {
	return {
		id: 'f1',
		file: 'apps/server/src/review/session/lease.ts',
		line: 20,
		severity: 'error',
		message: 'The lease is never released. It leaks on every retry.',
		...change
	};
}

function ranProof(baseline?: VerificationEvidence['baseline']): Finding['verification'] {
	return {
		status: 'verified',
		method: 'run',
		reason: 'The test fails.',
		evidence: { command: 'bun test lease', exitCode: 1, observed: 'expected 0, got 1', evidenceId: 'e1', baseline }
	};
}

describe('bugView evidence', () => {
	test('a reproduced finding shows the run and how it ended on the base branch', () => {
		const view = bugView(
			finding({ verification: ranProof({ exitCode: 0, differs: true, result: 'regression' }) }),
			NO_COMMENTS,
			null
		);

		expect(view).toMatchObject({ evidence: 'reproduced', evidenceLabel: 'Reproduced', trace: [], rule: null });

		expect(view.proof).toEqual({
			command: 'bun test lease',
			exitCode: 1,
			expected: null,
			output: 'expected 0, got 1',
			base: 'Passes on the base branch.'
		});
	});

	test('an older reproduced finding keeps only its command, with the reason as output', () => {
		const verification = { status: 'verified' as const, reason: 'Exit 1.', command: 'bun test', exitCode: 1 };

		expect(bugView(finding({ verification }), NO_COMMENTS, null).proof).toEqual({
			command: 'bun test',
			exitCode: 1,
			expected: null,
			output: 'Exit 1.',
			base: null
		});
	});

	test('a traced finding shows its execution path with short locations and no proof', () => {
		const claim = {
			trigger: 'A retry',
			executionPath: [{ file: 'apps/server/src/review/pipeline/run.ts', line: 40, note: 'Retries the step' }],
			consequence: 'Leak',
			violatedContract: 'Leases are released'
		};

		const view = bugView(
			finding({ claim, verification: { status: 'verified', method: 'trace', reason: 'Read it.' } }),
			NO_COMMENTS,
			null
		);

		expect(view).toMatchObject({ evidence: 'traced', evidenceLabel: 'Traced in code', proof: null, rule: null });
		expect(view.trace).toEqual([{ where: 'review/pipeline/run.ts:40', note: 'Retries the step' }]);
	});

	test('a rule finding cites its rule', () => {
		const rule = { id: 'R4', text: 'Release every lease.', source: { path: 'RECODER.md', line: 12 } };

		const view = bugView(
			finding({ rule, verification: { status: 'verified', method: 'rule', reason: 'R4.' } }),
			NO_COMMENTS,
			null
		);

		expect(view).toMatchObject({ evidence: 'rule', evidenceLabel: 'Repository rule', rule, proof: null, trace: [] });
	});

	test('an unverified finding shows no proof, trace or rule', () => {
		const view = bugView(
			finding({ verification: { status: 'unverified', reason: 'No check ran.' } }),
			NO_COMMENTS,
			null
		);

		expect(view).toMatchObject({
			evidence: 'unverified',
			evidenceLabel: 'Not verified',
			proof: null,
			trace: [],
			rule: null
		});
	});
});

describe('bugView fields', () => {
	test('a finding saved without a title takes the first sentence of its message', () => {
		expect(bugView(finding(), NO_COMMENTS, null).title).toBe('The lease is never released.');
	});

	test('a quality finding with a patch is a suggestion; without one it stays a bug', () => {
		const patch = { diff: '--- a/x\n+++ b/x', checks: ['tsc'] };

		expect(bugView(finding({ kind: 'quality', patch }), NO_COMMENTS, null)).toMatchObject({
			kind: 'suggestion',
			fix: patch
		});

		expect(bugView(finding({ kind: 'quality', suggestion: 'Rename it.' }), NO_COMMENTS, null)).toMatchObject({
			kind: 'bug',
			fix: { text: 'Rename it.' }
		});
	});

	test('a posted finding links to its comment and keeps the vote it was given', () => {
		const review = { findingComments: { f1: { id: 'c1', url: 'https://github.com/c1', inline: true } } };

		expect(bugView(finding(), review, 'useful')).toMatchObject({
			posted: { url: 'https://github.com/c1' },
			vote: 'useful'
		});
	});
});

describe('baseSentence', () => {
	const sentences: Record<BaseComparisonResult, string> = {
		regression: 'Passes on the base branch.',
		'pre-existing': 'Fails the same way on the base branch.',
		incompatible: 'Can’t run on the base branch, which lacks the new code.',
		environment: 'Fails on the base branch before it reaches the check.',
		worsened: 'Already fails on the base branch; this change makes it worse.',
		unstable: 'Ends differently from run to run on the base branch.'
	};

	test.each(Object.entries(sentences))('a %s comparison reads as one sentence', (result, sentence) => {
		const known = Object.keys(sentences).find((key): key is BaseComparisonResult => key === result);

		expect(baseSentence({ exitCode: 0, differs: true, result: known })).toBe(sentence);
	});

	test('a comparison without a result says whether the run ended differently, or why it could not run', () => {
		expect(baseSentence({ exitCode: 0, differs: true })).toBe('Ends differently on the base branch.');
		expect(baseSentence({ exitCode: 1, differs: false })).toBe('Ends the same way on the base branch.');
		expect(baseSentence({ unavailable: 'The base branch did not build.' })).toBe('The base branch did not build.');
		expect(baseSentence(undefined)).toBeNull();
	});
});

describe('shortWhere', () => {
	test('keeps the two nearest folders and the file name, with the line when there is one', () => {
		expect(shortWhere('apps/server/src/review/session/lease.ts', 20)).toBe('review/session/lease.ts:20');
		expect(shortWhere('src/a.ts', null)).toBe('src/a.ts');
	});
});
