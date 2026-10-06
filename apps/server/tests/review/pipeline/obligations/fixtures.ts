import type { Obligation } from '@recoder/shared';
import { afterEach, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildChangeModel } from '../../../../src/review/pipeline/change-model/change-model';
import type { AdaptiveReviewInput } from '../../../../src/review/pipeline/harness/types';
import { buildInventory } from '../../../../src/review/pipeline/inventory';
import { deriveObligations } from '../../../../src/review/pipeline/obligations/derive';
import { git } from '../../../helpers/git';
import {
	NOTHING,
	confirmingVerifier,
	isVerifier,
	modelReply,
	obligationOf,
	twoCommitRepo,
	unitOf
} from '../harness-fixtures';

/**
 * Commits `base`, then `head` on top in a throwaway repo, and derives the
 * obligations of the diff between them from a real change model.
 */
export async function deriveFrom(base: Record<string, string>, head: Record<string, string>): Promise<Obligation[]> {
	const root = await mkdtemp(join(tmpdir(), 'obligations-'));

	try {
		const { targetSha } = await twoCommitRepo(root, { base, head });
		const inventory = buildInventory(git(root, ['diff', targetSha, 'HEAD']) + '\n', []);
		const signal = new AbortController().signal;
		const changeModel = await buildChangeModel({ inventory, checkoutPath: root, signal, baseSha: targetSha });

		return await deriveObligations({ inventory, changeModel, checkoutPath: root, baseSha: targetSha, signal });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

/** One file's two versions, as lines. */
export function file(path: string, base: string[], head: string[]) {
	return { base: { [path]: base.join('\n') + '\n' }, head: { [path]: head.join('\n') + '\n' } };
}

/** `pageSize` before the change: an undefined check and a strict upper bound. */
const PAGE_BEFORE = [
	'export function pageSize(limit?: number, max = 100) {',
	'\tif (limit === undefined) return 20;',
	'\tif (limit > max) return max;',
	'\treturn limit;',
	'}'
];

/** After: a truthiness test and an inclusive bound, so at least a truthy-default and a boundary obligation. */
const PAGE_AFTER = [
	PAGE_BEFORE[0],
	'\tif (!limit) return 20;',
	'\tif (limit >= max) return max;',
	...PAGE_BEFORE.slice(3)
];

/** A review of a throwaway repo whose change to `src/page.ts` sets off several obligations. */
export async function riskyReview(root: string): Promise<AdaptiveReviewInput> {
	const { targetSha, headSha } = await twoCommitRepo(root, file('src/page.ts', PAGE_BEFORE, PAGE_AFTER));

	return {
		diff: git(root, ['diff', targetSha, headSha]) + '\n',
		sandboxPath: root,
		revision: { checkoutPath: root, headSha, targetSha, mergeBaseSha: targetSha, targetRef: 'main' }
	};
}

/** A fixed answer the investigator stub gives, `result` aside. */
export const ANSWER = {
	contractEvidence: [{ kind: 'test', location: 'tests/page.test.ts:4', note: 'pageSize(0) expects the default' }],
	inputPartition: [
		{ label: 'below', input: '0', expected: '20' },
		{ label: 'at', input: '100', expected: '100' }
	],
	expectedBehavior: 'Zero and undefined both fall back to 20.',
	attemptedCounterexample: { input: 'pageSize(0)', evidenceId: null, observed: 'returns 20' },
	result: 'disproved',
	reason: 'Zero means no limit in this API.'
};

/** An investigator's final reply carrying `answer` and `findings`, reporting `tokens` output tokens. */
export function investigatorReply(answer: unknown, findings: unknown[] = [], tokens = 42): Response {
	const content = JSON.stringify({ message: 'done', ...NOTHING, findings, obligation: answer });

	return Response.json({
		choices: [{ message: { content } }],
		usage: { prompt_tokens: 100, completion_tokens: tokens }
	});
}

/** A model call that never answers until its request is aborted. */
export function stall(init?: RequestInit): Promise<Response> {
	return new Promise<Response>((_, reject) =>
		init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
	);
}

/**
 * Answers every lens reviewer with nothing and every verifier with a
 * confirmation, recording each call by stage, and hands investigator calls to
 * `investigator` with their obligation id.
 */
export function stubInvestigations(
	calls: string[],
	investigator: (id: string, init?: RequestInit) => Response | Promise<Response>
): void {
	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const obligation = obligationOf(init);

		calls.push(obligation ?? unitOf(init) ?? (isVerifier(init) ? 'verifier' : 'other'));
		if (obligation) return investigator(obligation, init);
		if (isVerifier(init)) return modelReply(confirmingVerifier(init));

		return modelReply({ message: 'ok', ...NOTHING });
	}) as unknown as typeof fetch;
}

/** Puts each of `keys` back as it was before the calling file's tests, after each one. */
export function restoreEnvAfterEach(keys: string[]): void {
	const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

	afterEach(() => {
		for (const key of keys) {
			if (original[key] === undefined) delete process.env[key];
			else process.env[key] = original[key];
		}
	});
}

/**
 * Each test in the calling file gets its own data directory and runs with code
 * execution off, so no sandbox decides what an investigator can do; the
 * obligation settings are restored afterwards.
 */
export function isolateEachTest(): void {
	restoreEnvAfterEach([
		'RECODER_OBLIGATIONS',
		'RECODER_OBLIGATION_CAP',
		'RECODER_OBLIGATION_TURNS',
		'RECODER_EXEC',
		'RECODER_DATA_DIR'
	]);

	beforeEach(() => {
		process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-obligations-'));
		process.env.RECODER_EXEC = 'off';
	});
}
