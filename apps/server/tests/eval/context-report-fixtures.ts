import type { ReviewContext, ReviewerContext } from '@recoder/shared';
import type { BenchmarkReport } from '../../src/eval/benchmark-report';
import { LENSES } from '../../src/review/pipeline/lenses/lenses';

/**
 * The reviewer's stub report: alpha has a two-unit review (big-0) and one
 * stored without a record (none-1); beta has a one-reviewer review
 * (small-1), one the server no longer has (missing-9) and a failed run (big-1).
 */
export const STUB_REPORT = {
	dataset: 'stub',
	prs: [
		{
			codebase: 'alpha',
			runs: [
				{ index: 0, reviewId: 'big-0', outcome: 'passed' },
				{ index: 1, reviewId: 'none-1', outcome: 'passed' }
			]
		},
		{
			codebase: 'beta',
			runs: [
				{ index: 0, reviewId: 'small-1', outcome: 'passed' },
				{ index: 1, reviewId: 'missing-9', outcome: 'passed' },
				{ index: 2, reviewId: 'big-1', outcome: 'failed' }
			]
		}
	]
} as unknown as BenchmarkReport;

/** A lens reviewer of `unit` that cited one line of the unit's diff. */
function lensReviewer(unit: number, lens: string): ReviewerContext {
	return {
		assignmentId: `unit-${unit}/${lens}`,
		role: 'reviewer',
		lens,
		unit: `unit-${unit}`,
		read: [],
		cited: [{ kind: 'diff', path: `src/mod${unit}.ts`, startLine: 10, endLine: 10, via: 'supplied' }],
		omitted: []
	};
}

/** Two units, eight lenses each; unit-1's correctness reviewer read a caller its prompt cut and cited it. */
export const BIG: ReviewContext = {
	units: Object.fromEntries(
		[1, 2].map((unit) => [
			`unit-${unit}`,
			{
				supplied: [
					{ kind: 'diff', path: `src/mod${unit}.ts`, startLine: 1, endLine: 79 },
					{ kind: 'caller', path: `src/use${unit}.ts`, startLine: 5, symbol: 'take', why: 'call outside the diff' }
				],
				omitted: [
					{ kind: 'caller', path: `src/far${unit}.ts`, startLine: 3, symbol: 'take', reason: 'caller-cap' },
					{ kind: 'reference', path: `src/ref${unit}.ts`, startLine: 1, symbol: 'take', reason: 'reference-cap' }
				],
				...(unit === 2 ? { omittedPast: { 'caller-cap': 2 } } : {})
			}
		])
	),
	reviewers: [1, 2].flatMap((unit) =>
		LENSES.map((lens) => {
			const reviewer = lensReviewer(unit, lens.id);

			if (unit !== 1 || lens.id !== 'correctness') return reviewer;

			return {
				...reviewer,
				read: [{ kind: 'source' as const, path: 'src/far1.ts', startLine: 1, endLine: 20 }],
				cited: [
					...reviewer.cited,
					{ kind: 'source' as const, path: 'src/far1.ts', startLine: 3, endLine: 3, via: 'read' as const }
				]
			};
		})
	),
	findings: [{ findingId: 'f1', cited: { supplied: 1, read: 1, unknown: 0 }, members: 2, readBy: 1 }]
};

/** One reviewer whose page cut the first hunk; it read the file and cited that hunk and another file. */
export const SMALL: ReviewContext = {
	units: {
		'unit-1': {
			supplied: [{ kind: 'diff', path: 'src/a.ts', startLine: 300, endLine: 303 }],
			omitted: [{ kind: 'diff', path: 'src/a.ts', startLine: 2, endLine: 5, reason: 'diff-cap' }]
		}
	},
	reviewers: [
		{
			assignmentId: 'unit-1/correctness',
			role: 'reviewer',
			lens: 'correctness',
			unit: 'unit-1',
			read: [
				{ kind: 'source', path: 'src/a.ts', startLine: 1, endLine: 400 },
				{ kind: 'source', path: 'src/other.ts', startLine: 1, endLine: 50 }
			],
			cited: [
				{ kind: 'diff', path: 'src/a.ts', startLine: 2, endLine: 5, via: 'read' },
				{ kind: 'source', path: 'src/other.ts', startLine: 1, endLine: 50, via: 'read' }
			],
			omitted: [{ kind: 'source', path: 'src/a.ts', startLine: 1, endLine: 400, reason: 'file-cap' }]
		}
	],
	findings: [{ findingId: 'f1', cited: { supplied: 0, read: 2, unknown: 0 }, members: 1, readBy: 1 }]
};
