import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAdaptiveReview } from '../../../src/review/pipeline/harness';
import { execUnavailableReason } from '../../../src/sandbox/exec-sandbox';
import {
	DIFF,
	HUNK,
	NOTHING,
	PLAN,
	finding,
	messagesOf,
	modelReply,
	restoreAfterEach,
	twoCommitRepo,
	useTestModel
} from './harness-fixtures';

restoreAfterEach();

/** Proves the real bug with a grep run and refutes the imagined one with the same run. */
function verifierReply(user: string, last: string): unknown {
	const proof = /evidenceId=(ev_\d+)/.exec(last)?.[1];

	if (!proof) return { actions: [{ action: 'run', command: 'grep -c new src/a.ts' }] };

	return user.includes('Real bug.')
		? { verdict: 'confirmed', reason: 'grep shows it.', evidenceIds: [proof] }
		: { verdict: 'refuted', reason: 'grep shows otherwise.', evidenceIds: [proof] };
}

test.skipIf((await execUnavailableReason()) !== null)(
	'verification drops a finding a run disproves and marks a reproduced one verified',
	async () => {
		useTestModel(4);

		const root = await mkdtemp(join(tmpdir(), 'recoder-verify-review-'));

		try {
			const { targetSha, headSha } = await twoCommitRepo(root);

			const plan = {
				...PLAN,
				summary: 'One change',
				assignments: PLAN.assignments.map((item) => ({ ...item, questions: [] })),
				checks: ['cat src/a.ts']
			};

			const specialists: string[] = [];

			globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
				const messages = messagesOf(init);
				const system = messages[0].content;
				const user = messages[1].content;
				let reply: unknown = { findings: [], examinedHunks: [HUNK] };

				if (system.includes('review orchestrator')) reply = plan;
				else if (system.includes('Role: Correctness')) {
					specialists.push(user);
					reply = { ...NOTHING, findings: [finding('Real bug.'), finding('Imagined bug.')] };
				} else if (system.includes('You verify one code review finding')) {
					reply = verifierReply(user, messages.at(-1)!.content);
				} else if (system.includes('consolidate Recoder specialist candidates')) {
					reply = { keep: [...new Set(user.match(/\bc\d+\b/g))], merge: [], reject: [], recommendedChecks: [] };
				}

				return modelReply({ message: 'Working.', ...(reply as object) });
			}) as unknown as typeof fetch;

			const result = await runAdaptiveReview({
				diff: DIFF,
				sandboxPath: root,
				revision: { checkoutPath: root, headSha, targetSha, mergeBaseSha: targetSha, targetRef: 'main' }
			});

			expect(specialists[0]).toContain('`cat src/a.ts` → passed');
			expect(result.findings).toHaveLength(1);
			expect(result.findings[0].message).toContain('Real bug.');

			expect(result.findings[0].verification).toEqual({
				status: 'verified',
				method: 'run',
				reason: 'grep shows it.',
				command: 'grep -c new src/a.ts',
				exitCode: 0
			});

			expect(result.summary).toContain('1 verified by running code');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}
);
