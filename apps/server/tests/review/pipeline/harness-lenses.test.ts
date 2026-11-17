import { beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAdaptiveReview } from '../../../src/review/pipeline/harness';
import { LENSES } from '../../../src/review/pipeline/lenses/lenses';
import type { LensId } from '../../../src/review/pipeline/lenses/types';
import {
	NOTHING,
	addedFile,
	confirmingVerifier,
	finding,
	isVerifier,
	modelReply,
	restoreAfterEach,
	systemOf,
	unitOf,
	useTestModel
} from './harness-fixtures';

restoreAfterEach();

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-harness-lenses-'));
});

const CODE = addedFile('src/a.ts', 5);

const DOCS = addedFile('docs/guide.md', 5);

const SELECTED: LensId[] = ['correctness', 'security'];

/** A readability report on line 1 of `src/a.ts`, which a review of the readability lens would keep. */
const READABILITY = { ...finding('magic number'), category: 'readability', smell: 'magic-value' };

/** What a stubbed review saw: the system prompt of each reviewer and subagent, and and how many verifier and repair calls were made. */
interface Seen {
	reviewerPrompts: string[];
	subagentSystems: string[];
	reviewerBodies: string[];
	subagentBodies: string[];
	verifiers: number;
	repairs: number;
}

/**
 * Answers a review of `src/a.ts`: its reviewer reports `reported` and asks for one subagent when `ask` is set,
 * a subagent reports `subagentReported`, and every verifier confirms.
 */
function stubReview(reported: unknown[], options: { ask?: boolean; subagentReported?: unknown[] } = {}): Seen {
	const seen: Seen = {
		reviewerPrompts: [],
		subagentSystems: [],
		reviewerBodies: [],
		subagentBodies: [],
		verifiers: 0,
		repairs: 0
	};

	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		if (systemOf(init).includes('You repair one code review finding')) seen.repairs++;

		if (isVerifier(init)) {
			seen.verifiers++;

			return modelReply(confirmingVerifier(init));
		}

		if (systemOf(init).includes('Role: subagent')) {
			seen.subagentSystems.push(systemOf(init));
			seen.subagentBodies.push(String(init?.body));

			return modelReply({ message: 'ok', ...NOTHING, findings: options.subagentReported ?? [] });
		}

		if (unitOf(init)) {
			seen.reviewerBodies.push(String(init?.body));

			seen.reviewerPrompts.push(
				JSON.parse(String(init?.body))
					.messages.map((message: { content: string }) => message.content)
					.join('\n\n')
			);
		}

		const asked = options.ask
			? [{ concern: 'Callers', question: 'Who calls it?', scope: [{ path: 'src/a.ts', hunkIds: [] }], why: 'Wide.' }]
			: [];

		return modelReply({
			message: 'ok',
			...NOTHING,
			examinedHunks: ['src/a.ts:0,0:1,5'],
			findings: reported,
			subagents: asked
		});
	}) as unknown as typeof fetch;

	return seen;
}

/** Counts every model call of a review that must make none. */
function stubNoCalls(): { calls: number } {
	const seen = { calls: 0 };

	globalThis.fetch = (async () => {
		seen.calls++;

		return modelReply(NOTHING);
	}) as unknown as typeof fetch;

	return seen;
}

test('a reviewer is offered only the selected lenses', async () => {
	useTestModel();

	const seen = stubReview([]);

	await runAdaptiveReview({ diff: CODE, sandboxPath: null, lenses: SELECTED });

	const [system] = seen.reviewerPrompts;

	for (const lens of LENSES) {
		expect(system.includes(`${lens.title} (${lens.categories.join(', ')}):`)).toBe(SELECTED.includes(lens.id));
	}
});

test('a finding in the category of a lens that was not selected is not published and is counted as dropped', async () => {
	useTestModel();

	const seen = stubReview([READABILITY]);
	const result = await runAdaptiveReview({ diff: CODE, sandboxPath: null, lenses: SELECTED });

	expect(result.findings).toEqual([]);
	expect(result.unconfirmed).toEqual([]);
	expect(result.funnel).toMatchObject({ raised: 1, shown: 0 });
	expect(result.funnel?.dropped.category).toBe(1);
	expect(seen.verifiers).toBe(0);
	expect(seen.repairs).toBe(0);
});

test('a subagent is told only the selected lenses', async () => {
	useTestModel();

	const seen = stubReview([], { ask: true });

	await runAdaptiveReview({ diff: CODE, sandboxPath: null, lenses: SELECTED });

	const [system] = seen.subagentSystems;

	for (const lens of LENSES) {
		expect(system.includes(`${lens.title} (${lens.categories.join(', ')})`)).toBe(SELECTED.includes(lens.id));
	}
});

test('a subagent finding in the category of a lens that was not selected is dropped', async () => {
	useTestModel();

	const seen = stubReview([], { ask: true, subagentReported: [READABILITY] });
	const result = await runAdaptiveReview({ diff: CODE, sandboxPath: null, lenses: SELECTED });

	expect(seen.subagentSystems).toHaveLength(1);
	expect(result.findings).toEqual([]);
	expect(result.funnel).toMatchObject({ raised: 1, shown: 0 });
	expect(result.funnel?.dropped.category).toBe(1);
});

test('a documentation-only change that no selected lens fits gets no reviewer, no model call and shows as not reviewed', async () => {
	useTestModel();

	const seen = stubNoCalls();
	const result = await runAdaptiveReview({ diff: DOCS, sandboxPath: null, lenses: ['correctness'] });

	expect(seen.calls).toBe(0);
	expect(result.assignments).toEqual([]);
	expect(result.coverage).toMatchObject({ reviewed: 0, pending: 0, partial: 0, excluded: 1, total: 1 });
	expect(result.coverageGaps).toHaveLength(1);
	expect(result.coverageGaps[0]).toMatchObject({ path: 'docs/guide.md', state: 'excluded' });
	expect(result.coverageGaps[0].reason).toContain('correctness');
});

test('a documentation-only change is reviewed when a selected lens fits it', async () => {
	useTestModel();

	const seen = stubReview([]);
	const result = await runAdaptiveReview({ diff: DOCS, sandboxPath: null, lenses: ['readability', 'security'] });

	expect(seen.reviewerPrompts).toHaveLength(1);
	expect(result.coverage.reviewed).toBe(1);
	expect(result.coverageGaps).toEqual([]);
});

test('an empty selection throws before any model call', async () => {
	useTestModel();

	const seen = stubNoCalls();

	await expect(runAdaptiveReview({ diff: CODE, sandboxPath: null, lenses: [] })).rejects.toThrow('empty list');
	expect(seen.calls).toBe(0);
});

test('a selection with an unknown lens throws before any model call, naming it', async () => {
	useTestModel();

	const seen = stubNoCalls();
	const lenses = ['correctness', 'speed'] as never;

	await expect(runAdaptiveReview({ diff: CODE, sandboxPath: null, lenses })).rejects.toThrow('"speed"');
	expect(seen.calls).toBe(0);
});

test('a reviewer and its subagent send the same finding format, so their prompts can share a cached prefix', async () => {
	useTestModel();

	const seen = stubReview([], { ask: true });

	await runAdaptiveReview({ diff: CODE, sandboxPath: null });

	expect(findingFormat(seen.subagentBodies[0])).toEqual(findingFormat(seen.reviewerBodies[0]));
});

/** The guided-decoding shape of one finding in a model request body. */
function findingFormat(body: string): unknown {
	const { schema } = JSON.parse(body).response_format.json_schema;
	const final = schema.anyOf ? schema.anyOf.at(-1) : schema;

	return final.properties.findings.items;
}
