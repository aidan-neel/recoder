import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRuleLedger, ledgerBlock } from '../../../../src/review/guidelines/ledger/ledger';
import { toLedger } from '../../../../src/review/guidelines/ledger/validate';
import { createRun } from '../../../../src/review/pipeline/harness/context';
import { DIFF, modelReply, restoreAfterEach, twoCommitRepo, useTestModel } from '../../pipeline/harness-fixtures';

restoreAfterEach();

const SOURCES = [
	{ path: 'AGENTS.md', text: 'line 1\nline 2\nline 3\nline 4\n' },
	{ path: 'apps/web/AGENTS.md', text: 'one\ntwo\n' }
];

describe('toLedger', () => {
	test('numbers rules by source file then cited line, not by the order the model listed them', () => {
		const ledger = toLedger(
			{
				rules: [
					{ text: 'Use Sivir components.', source: 'apps/web/AGENTS.md', line: 2 },
					{ text: 'Keep files short.', source: 'AGENTS.md', line: 4 },
					{ text: 'Write JSDoc only.', source: 'AGENTS.md', line: 2 },
					{ text: 'Invented rule.', source: 'README.md', line: 1 }
				]
			},
			SOURCES,
			'hash'
		);

		expect(ledger.rules.map((rule) => [rule.id, rule.text, rule.source.line])).toEqual([
			['R1', 'Write JSDoc only.', 2],
			['R2', 'Keep files short.', 4],
			['R3', 'Use Sivir components.', 2]
		]);
	});

	test('drops a check whose pattern is too long, does not compile or matches an empty line, and keeps the rule', () => {
		const ledger = toLedger(
			{
				rules: [
					{ text: 'A', source: 'AGENTS.md', line: 1, check: { kind: 'forbid-pattern', pattern: '(unclosed' } },
					{ text: 'B', source: 'AGENTS.md', line: 2, check: { kind: 'forbid-pattern', pattern: 'x'.repeat(201) } },
					{ text: 'C', source: 'AGENTS.md', line: 3, check: { kind: 'forbid-pattern', pattern: '.*' } },
					{
						text: 'D',
						source: 'AGENTS.md',
						line: 4,
						check: { kind: 'forbid-pattern', pattern: '^\\s*//', glob: '*.ts' }
					}
				]
			},
			SOURCES,
			'hash'
		);

		expect(ledger.rules.map((rule) => rule.check)).toEqual([
			undefined,
			undefined,
			undefined,
			{ kind: 'forbid-pattern', pattern: '^\\s*//', glob: '**/*.ts' }
		]);
	});
});

describe('buildRuleLedger', () => {
	test('reads the instruction files at the base commit, asks once, then reads the same ledger from the cache', async () => {
		const root = await mkdtemp(join(tmpdir(), 'recoder-ledger-'));

		const { targetSha, headSha } = await twoCommitRepo(root, {
			base: { 'AGENTS.md': '# Rules\n\n- Keep files under 500 lines.\n', 'apps/web/AGENTS.md': '- Use Sivir.\n' },
			head: { 'AGENTS.md': '# Rules\n\n- Anything goes.\n' }
		});

		useTestModel();

		const prompts: string[] = [];

		globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
			prompts.push(String(init?.body));

			return modelReply({
				message: 'Read the rules.',
				rules: [
					{ text: 'Use Sivir.', source: 'apps/web/AGENTS.md', line: 1, appliesTo: 'apps/web/' },
					{
						text: 'Keep files under 500 lines.',
						source: 'AGENTS.md',
						line: 3,
						check: { kind: 'max-file-lines', max: 500 }
					}
				]
			});
		}) as unknown as typeof fetch;

		const input = {
			diff: DIFF,
			sandboxPath: null,
			revision: { checkoutPath: root, headSha, targetSha, mergeBaseSha: targetSha, targetRef: 'main' }
		};

		const first = await buildRuleLedger(createRun(input));

		expect(prompts).toHaveLength(1);
		expect(prompts[0]).toContain('Keep files under 500 lines.');
		expect(prompts[0]).not.toContain('Anything goes');

		expect(first?.rules.map((rule) => [rule.id, rule.source.path, rule.appliesTo])).toEqual([
			['R1', 'AGENTS.md', undefined],
			['R2', 'apps/web/AGENTS.md', 'apps/web/**']
		]);

		globalThis.fetch = (async () => new Response('unavailable', { status: 500 })) as unknown as typeof fetch;

		expect(await buildRuleLedger(createRun(input))).toEqual(first);
		expect(ledgerBlock(first, ['apps/web/src/x.svelte'])).toBe('R2: Use Sivir. (apps/web/AGENTS.md:1)');
		expect(ledgerBlock(first, ['apps/server/src/x.ts'])).toBe('');
	});
});
