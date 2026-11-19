import { beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAdaptiveReview } from '../../../../src/review/pipeline/harness';
import { restoreEnvAfterEach } from '../../../helpers/env';
import {
	NOTHING,
	addedFile,
	messagesOf,
	modelReply,
	restoreAfterEach,
	systemOf,
	unitOf,
	useTestModel
} from '../harness-fixtures';

restoreAfterEach();
restoreEnvAfterEach(['RECODER_REVIEWER_TOOLS']);

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-reviewer-tools-'));
});

/** Eight files of about 14,000 patch characters each: three reviewers at the default budget, five slices of one message. */
const DIFF = Array.from({ length: 8 }, (_, index) => addedFile(`pkg${index}/index.ts`, 140)).join('');

/** What each reviewer was sent and how often it was called, in a review whose reviewers all ask for a subagent. */
async function reviewersUnder(setting: string | undefined) {
	const calls = new Map<string, { count: number; system: string; opening: string }>();
	let subagentCalls = 0;

	if (setting) process.env.RECODER_REVIEWER_TOOLS = setting;

	useTestModel();

	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const unit = unitOf(init);
		const opening = messagesOf(init)[1]?.content ?? '';

		if (/^Subagent \S+:/m.test(opening)) subagentCalls++;

		if (unit) {
			const seen = calls.get(unit) ?? { count: 0, system: systemOf(init), opening };

			calls.set(unit, { ...seen, count: seen.count + 1 });
		}

		const ask = {
			concern: 'callers',
			question: 'Who calls it?',
			scope: [{ path: 'pkg0/index.ts', hunkIds: [] }],
			why: 'The callers are outside this slice.'
		};

		return modelReply({ message: 'ok', ...NOTHING, subagents: unit ? [ask] : [] });
	}) as unknown as typeof fetch;

	await runAdaptiveReview({ diff: DIFF, sandboxPath: null });

	return { reviewers: [...calls.values()], subagentCalls };
}

test('reviewers without tools each answer in one call from a message that holds their whole slice, and the subagents they ask for are not sent', async () => {
	const { reviewers, subagentCalls } = await reviewersUnder('none');

	expect(reviewers).toHaveLength(5);
	expect(reviewers.map((reviewer) => reviewer.count)).toEqual([1, 1, 1, 1, 1]);
	expect(subagentCalls).toBe(0);

	for (const reviewer of reviewers) {
		expect(reviewer.system).toContain('You have no tools');
		expect(reviewer.system).not.toContain('readFile');
		expect(reviewer.opening).not.toContain('did not reach these hunks');
	}

	const shown = reviewers.flatMap((reviewer) => reviewer.opening.match(/\+\+\+ b\/pkg\d\/index\.ts/g) ?? []);

	expect(new Set(shown).size).toBe(8);
});

test('read-only reviewers keep their turns and are offered no shell', async () => {
	const { reviewers } = await reviewersUnder('read');

	expect(reviewers).toHaveLength(3);
	expect(reviewers[0]!.system).toContain('readFile');
	expect(reviewers[0]!.system).not.toContain('writeFile');
});

test('a setting that names no tool profile stops the review before any model call', async () => {
	process.env.RECODER_REVIEWER_TOOLS = 'some';

	expect(runAdaptiveReview({ diff: DIFF, sandboxPath: null })).rejects.toThrow('RECODER_REVIEWER_TOOLS');
});

test('without tools, a brief question no reviewer answered gets one follow-up subagent that answers in one call', async () => {
	process.env.RECODER_REVIEWER_TOOLS = 'none';
	useTestModel();

	const subagentSystems: string[] = [];

	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const system = systemOf(init);

		if (system.includes('You write the brief')) {
			return modelReply({
				openQuestions: [{ text: 'Does pkg0 reject an empty name?', file: 'pkg0/index.ts', line: 1 }]
			});
		}

		if (system.includes('Role: subagent')) subagentSystems.push(system);

		return modelReply({ message: 'ok', ...NOTHING });
	}) as unknown as typeof fetch;

	const result = await runAdaptiveReview({ diff: DIFF, sandboxPath: null, subagentCap: 3 });

	expect(subagentSystems).toHaveLength(1);
	expect(subagentSystems[0]).toContain('You have no tools');

	expect(result.assignments.filter((record) => record.role === 'subagent').map((record) => record.status)).toEqual([
		'done'
	]);
});
