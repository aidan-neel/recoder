import { expect, test } from 'bun:test';
import type { CandidateFinding } from '../../../../src/review/pipeline/consolidate';
import { consolidate } from '../../../../src/review/pipeline/harness/consolidation';
import { createRun } from '../../../../src/review/pipeline/harness/context';
import { envFlag } from '../../../helpers/env-flag';
import { modelReply, restoreAfterEach, stubFetch, useTestModel } from '../harness-fixtures';

envFlag('RECODER_PRECISION_FIXES', '1');
envFlag('RECODER_VERIFIER_SESSION_FIXES', '1');
restoreAfterEach();

/** The four separately proven p-limit-4 claims the rejected G1 votes joined incorrectly. */
function keyedClaims(): CandidateFinding[] {
	return [
		['3', 17, 'Prototype keys collide', 'runKeyed uses constructor', 'Inherited properties replace task promises'],
		['4', 129, 'Active tasks can be cancelled', 'cancelKey runs after a task starts', 'An active task loses its key'],
		['5', 138, 'Inherited keys appear tracked', 'hasKey uses toString', 'An inherited name appears in flight'],
		[
			'6',
			150,
			'Cleared keys remain tracked',
			'clearQueue drains a pending keyed task',
			'The cleared key remains registered'
		]
	].map<CandidateFinding>(([id, line, title, trigger, consequence]) => ({
		id: String(id),
		candidateId: String(id),
		valid: true,
		file: 'index.js',
		line: Number(line),
		symbol: 'pLimit',
		fingerprint: 'keyed-tasks',
		kind: 'bug',
		category: 'correctness',
		severity: 'warning',
		title: String(title),
		message: String(consequence),
		claim: {
			trigger: String(trigger),
			consequence: String(consequence),
			violatedContract: String(title),
			executionPath: [{ file: 'index.js', line: Number(line), note: String(title) }]
		},
		verification: {
			status: 'verified',
			method: 'run',
			reason: String(consequence),
			command: `node repro-${id}.mjs`,
			exitCode: 1
		}
	}));
}

test('publication keeps distinct verified keyed claims without delegating their identity to contradictory model votes', async () => {
	useTestModel();

	let calls = 0;

	stubFetch(() => {
		calls++;

		return modelReply({
			pairs: [
				[
					'p9',
					'3 and 5 both describe keyedTasks as a plain object resolving inherited Object.prototype members: same trigger (prototype-named keys), cause (plain {} store), consequence (undefined return / false hasKey / cancelKey throw), contract (arbitrary keys stored as data). Proofs confirm the same defect.'
				],
				['p14', '5 and 6? No — p14 is a=5,b=6: 5 is prototype collision, 6 is clearQueue leak. Different defects.']
			].map(([id, reason]) => ({
				id,
				sameTrigger: true,
				sameCause: true,
				sameConsequence: true,
				sameContract: true,
				proofsSupportBoth: true,
				reason
			}))
		});
	});

	const run = createRun({ diff: '', sandboxPath: null });
	const originals = keyedClaims();

	run.candidates.push(...originals);

	const result = await consolidate(run);

	expect(calls).toBe(0);
	expect(result.confirmed).toHaveLength(originals.length);

	for (const original of originals) {
		const finding = result.confirmed.find((item) => item.id === original.id)!;

		expect(finding.memberIds).toEqual([original.id]);
		expect(finding.claim).toBe(original.claim);
		expect(finding.verification).toBe(original.verification);
	}
});
