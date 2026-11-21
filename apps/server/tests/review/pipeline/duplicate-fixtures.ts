import type { Finding } from '@recoder/shared';

/** Independently verified reports; the proof explicitly belongs to its original trigger. */
export function provenFinding(id: string, trigger = 'the caller uses a closed limiter'): Finding {
	return {
		id,
		file: 'index.js',
		line: 191,
		symbol: 'limit',
		kind: 'bug',
		category: 'correctness',
		severity: 'warning',
		title: 'Closed limiter throws synchronously',
		message: 'It throws rather than returning a rejected promise.',
		claim: {
			trigger,
			consequence: 'The caller gets a synchronous exception',
			violatedContract: 'Calls return promises',
			executionPath: [{ file: 'index.js', line: 191, note: 'throw' }]
		},
		memberIds: [id],
		evidenceIds: [`evidence-${id}`],
		verification: {
			status: 'verified',
			method: 'run',
			reason: `Proof for ${trigger}`,
			command: `node ${id}.js`,
			exitCode: 1
		}
	};
}

/** A semantic equivalence decision about one supplied pair, not a rewritten finding. */
export const equivalentVote = (id: string) => ({
	id,
	sameTrigger: true,
	sameCause: true,
	sameConsequence: true,
	sameContract: true,
	proofsSupportBoth: true,
	reason: 'Same closed-limiter promise contract and throw path.'
});
