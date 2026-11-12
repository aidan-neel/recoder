import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRuleLedger, ledgerBlock } from '../../../../src/review/guidelines/ledger/ledger';
import { LEDGER_VERSION, readLedgerSources } from '../../../../src/review/guidelines/ledger/sources';
import { toFindingRule } from '../../../../src/review/guidelines/ledger/types';
import { toLedger } from '../../../../src/review/guidelines/ledger/validate';
import { createRun } from '../../../../src/review/pipeline/harness/context';
import { writeCache } from '../../../../src/util/json-cache';
import { DIFF, modelReply, restoreAfterEach, twoCommitRepo, useTestModel } from '../../pipeline/harness-fixtures';

restoreAfterEach();

const SOURCES = [
	{ path: 'AGENTS.md', text: 'line 1\n- Write JSDoc only.\nline 3\n- Keep files short.\n', revision: 'abc1234' },
	{ path: 'apps/web/AGENTS.md', text: 'one\n- Use Sivir components.\n', revision: 'abc1234' }
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
					{ text: 'line 1', source: 'AGENTS.md', line: 1, check: { kind: 'forbid-pattern', pattern: '(unclosed' } },
					{
						text: 'Write JSDoc only.',
						source: 'AGENTS.md',
						line: 2,
						check: { kind: 'forbid-pattern', pattern: 'x'.repeat(201) }
					},
					{ text: 'line 3', source: 'AGENTS.md', line: 3, check: { kind: 'forbid-pattern', pattern: '.*' } },
					{
						text: 'Keep files short.',
						source: 'AGENTS.md',
						line: 4,
						check: { kind: 'forbid-pattern', pattern: '^\\s*//', glob: '*.ts' }
					}
				]
			},
			SOURCES,
			'hash'
		);

		expect(ledger.rules.map((rule) => [rule.verbatim !== false, rule.check])).toEqual([
			[true, undefined],
			[true, undefined],
			[true, undefined],
			[true, { kind: 'forbid-pattern', pattern: '^\\s*//', glob: '**/*.ts' }]
		]);
	});

	test('keeps the exact multi-line source wording, line range and revision while storing the short restatement separately', () => {
		const source = {
			path: 'AGENTS.md',
			revision: 'deadbeef01',
			text: [
				'# Guidelines',
				'- Never swallow an error: catch only what you can handle,',
				'  and add context when you rethrow.',
				''
			].join('\n')
		};

		const ledger = toLedger(
			{
				rules: [
					{
						text: 'Never swallow an error: catch only what you can handle, and add context when you rethrow.',
						restatement: 'Rethrow caught errors with context.',
						source: 'AGENTS.md',
						line: 2,
						endLine: 3
					}
				]
			},
			[source],
			'hash'
		);

		expect(ledger.rules).toEqual([
			{
				id: 'R1',
				text: 'Never swallow an error: catch only what you can handle,\n  and add context when you rethrow.',
				restatement: 'Rethrow caught errors with context.',
				level: 'mandatory',
				source: { path: 'AGENTS.md', line: 2, endLine: 3, revision: 'deadbeef01' }
			}
		]);
	});

	test('keeps an unverified quote only as the restatement instead of copying the cited heading line into text', () => {
		const source = {
			path: 'AGENTS.md',
			revision: 'rev1',
			text: '# Style\n- Files remain concise.\n'
		};

		const ledger = toLedger(
			{
				rules: [{ text: 'Keep each file short.', source: 'AGENTS.md', line: 1 }]
			},
			[source],
			'hash'
		);

		expect(ledger.rules).toEqual([
			{
				id: 'R1',
				text: '',
				verbatim: false,
				restatement: 'Keep each file short.',
				level: 'mandatory',
				source: { path: 'AGENTS.md', line: 1, endLine: 1, revision: 'rev1' }
			}
		]);

		expect(toFindingRule(ledger.rules[0])).toMatchObject({
			id: 'R1',
			text: '',
			verbatim: false,
			restatement: 'Keep each file short.'
		});
	});

	test('keeps distinct restated rules that cite the same line and merges a quoted rule the file repeats', () => {
		const source = {
			path: 'AGENTS.md',
			revision: 'rev1',
			text: ['# Style', '- Validate input payloads.', '# API', '- Validate input payloads.', ''].join('\n')
		};

		const ledger = toLedger(
			{
				rules: [
					{ text: 'Keep each file short.', source: 'AGENTS.md', line: 1 },
					{ text: 'Use docstrings for comments.', source: 'AGENTS.md', line: 1 },
					{ text: 'Validate input payloads.', source: 'AGENTS.md', line: 2 },
					{ text: 'Validate input payloads.', source: 'AGENTS.md', line: 4 }
				]
			},
			[source],
			'hash'
		);

		expect(ledger.rules.map((rule) => [rule.id, rule.text, rule.restatement, rule.source.line])).toEqual([
			['R1', '', 'Keep each file short.', 1],
			['R2', '', 'Use docstrings for comments.', 1],
			['R3', 'Validate input payloads.', 'Validate input payloads.', 2]
		]);
	});

	test('merges a rule that two files quote word for word and keeps the copy from the file with precedence', () => {
		const sources = [
			{ path: 'AGENTS.md', revision: 'rev1', text: '# Rules\n- Files stay under 500 lines.\n' },
			{ path: 'CLAUDE.md', revision: 'rev1', text: '# Notes\n\n- Files stay under 500 lines.\n' }
		];

		const ledger = toLedger(
			{
				rules: [
					{ text: 'Files stay under 500 lines.', source: 'CLAUDE.md', line: 3 },
					{ text: 'Files stay under 500 lines.', source: 'AGENTS.md', line: 2 }
				]
			},
			sources,
			'hash'
		);

		expect(ledger.rules.map((rule) => [rule.id, rule.text, rule.source.path, rule.source.line])).toEqual([
			['R1', 'Files stay under 500 lines.', 'AGENTS.md', 2]
		]);
	});

	test('gives no mechanical check to a rule whose quote is in no source file', () => {
		const source = { path: 'AGENTS.md', revision: 'rev1', text: '# Style\n- Use strict types.\n' };

		const ledger = toLedger(
			{
				rules: [
					{
						text: 'Files stay under 300 lines.',
						source: 'AGENTS.md',
						line: 1,
						check: { kind: 'max-file-lines', max: 300 }
					},
					{
						text: 'Use strict types.',
						source: 'AGENTS.md',
						line: 2,
						check: { kind: 'forbid-pattern', pattern: ': any\\b', glob: '**/*.ts' }
					}
				]
			},
			[source],
			'hash'
		);

		expect(ledger.rules.map((rule) => [rule.verbatim !== false, rule.check?.kind])).toEqual([
			[false, undefined],
			[true, 'forbid-pattern']
		]);
	});

	test('marks a rule with a nonexistent quote and an out-of-range line as non-verbatim with no quoted FindingRule text', () => {
		const source = {
			path: 'AGENTS.md',
			revision: 'rev1',
			text: '# Style\n- Use strict types.\n'
		};

		const ledger = toLedger(
			{
				rules: [{ text: 'Never use any.', source: 'AGENTS.md', line: 99 }]
			},
			[source],
			'hash'
		);

		expect(ledger.rules).toEqual([
			{
				id: 'R1',
				text: '',
				verbatim: false,
				restatement: 'Never use any.',
				level: 'mandatory',
				source: { path: 'AGENTS.md', revision: 'rev1' }
			}
		]);

		expect(toFindingRule(ledger.rules[0])).toEqual({
			id: 'R1',
			text: '',
			verbatim: false,
			restatement: 'Never use any.',
			level: 'mandatory',
			source: { path: 'AGENTS.md', revision: 'rev1' }
		});
	});

	test('formats reviewer ledger lines with the concise restatement while keeping the full verbatim quote on the rule', () => {
		const verbatim =
			'Never swallow an error in an asynchronous handler: catch only what you can recover from locally, and attach the failing input identifier when rethrowing.';

		const source = {
			path: 'AGENTS.md',
			revision: 'rev1',
			text: `- ${verbatim}\n`
		};

		const ledger = toLedger(
			{
				rules: [
					{
						text: verbatim,
						restatement: 'Rethrow unhandled async errors with context.',
						source: 'AGENTS.md',
						line: 1
					}
				]
			},
			[source],
			'hash'
		);

		expect(ledgerBlock(ledger, ['src/a.ts'])).toBe('R1: Rethrow unhandled async errors with context. (AGENTS.md:1)');
		expect(toFindingRule(ledger.rules[0]).text).toBe(verbatim);
	});

	test('keeps exceptions stated inline or next to a rule and omits mechanical checks when exceptions or advisory cues apply', () => {
		const source = {
			path: 'AGENTS.md',
			revision: 'rev1',
			text: [
				'- Keep every file under 500 lines.',
				'  - Exception: generated parser tables under src/gen/.',
				'- Prefer early returns when practical unless matching a switch.',
				''
			].join('\n')
		};

		const ledger = toLedger(
			{
				rules: [
					{
						text: 'Keep every file under 500 lines.',
						restatement: 'Keep files under 500 lines.',
						source: 'AGENTS.md',
						line: 1,
						check: { kind: 'max-file-lines', max: 500 }
					},
					{
						text: 'Prefer early returns when practical unless matching a switch.',
						restatement: 'Prefer early returns.',
						source: 'AGENTS.md',
						line: 3
					}
				]
			},
			[source],
			'hash'
		);

		expect(ledger.rules[0]).toMatchObject({
			id: 'R1',
			level: 'mandatory',
			exceptions: ['generated parser tables under src/gen/.'],
			source: { path: 'AGENTS.md', line: 1, endLine: 1, revision: 'rev1' }
		});

		expect(ledger.rules[0]?.check).toBeUndefined();

		expect(ledger.rules[1]).toMatchObject({
			id: 'R2',
			level: 'advisory',
			restatement: 'Prefer early returns.',
			exceptions: ['matching a switch']
		});
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

		expect(
			first?.rules.map((rule) => [rule.id, rule.source.path, rule.appliesTo, rule.source.revision, rule.source.endLine])
		).toEqual([
			['R1', 'AGENTS.md', undefined, targetSha, 3],
			['R2', 'apps/web/AGENTS.md', 'apps/web/**', targetSha, 1]
		]);

		globalThis.fetch = (async () => new Response('unavailable', { status: 500 })) as unknown as typeof fetch;

		expect(await buildRuleLedger(createRun(input))).toEqual(first);
		expect(ledgerBlock(first, ['apps/web/src/x.svelte'])).toBe('R2: Use Sivir. (apps/web/AGENTS.md:1)');
		expect(ledgerBlock(first, ['apps/server/src/x.ts'])).toBe('');
	});

	test('rebuilds a ledger cached under an older LEDGER_VERSION instead of reusing stale rule shapes', async () => {
		const root = await mkdtemp(join(tmpdir(), 'recoder-ledger-v-'));
		const fileText = '- Never use console.log in server handlers.\n';

		const { targetSha, headSha } = await twoCommitRepo(root, {
			base: { 'AGENTS.md': fileText }
		});

		const staleKey = createHash('sha256').update('ledger-v2').update(`\0AGENTS.md\0${fileText}`).digest('hex');

		writeCache('rule-ledger', staleKey, {
			sourcesHash: staleKey,
			rules: [{ id: 'R1', text: 'stale', source: { path: 'AGENTS.md' } }]
		});

		useTestModel();

		let modelCalls = 0;

		globalThis.fetch = (async () => {
			modelCalls++;

			return modelReply({
				message: 'Distilled.',
				rules: [
					{
						text: 'Never use console.log in server handlers.',
						restatement: 'Avoid console.log in server handlers.',
						source: 'AGENTS.md',
						line: 1,
						endLine: 1,
						level: 'mandatory'
					}
				]
			});
		}) as unknown as typeof fetch;

		const built = await buildRuleLedger(
			createRun({
				diff: DIFF,
				sandboxPath: null,
				revision: { checkoutPath: root, headSha, targetSha, mergeBaseSha: targetSha, targetRef: 'main' }
			})
		);

		expect(LEDGER_VERSION).toBe('ledger-v3');
		expect(modelCalls).toBe(1);

		expect(built?.rules[0]).toMatchObject({
			id: 'R1',
			text: 'Never use console.log in server handlers.',
			restatement: 'Avoid console.log in server handlers.',
			level: 'mandatory',
			source: { path: 'AGENTS.md', line: 1, endLine: 1, revision: targetSha }
		});
	});
});

describe('readLedgerSources', () => {
	test('reads RECODER.md as the repo guidelines, not .recoder/REVIEW.md as well, after the instruction files', async () => {
		const root = await mkdtemp(join(tmpdir(), 'recoder-ledger-'));

		const { targetSha, headSha } = await twoCommitRepo(root, {
			base: { 'RECODER.md': '- New rule.\n', '.recoder/REVIEW.md': '- Old rule.\n', 'AGENTS.md': '- Agents rule.\n' }
		});

		const revision = { checkoutPath: root, headSha, targetSha, mergeBaseSha: targetSha, targetRef: 'main' };
		const sources = await readLedgerSources(revision, new AbortController().signal);

		expect(sources.map((source) => [source.path, source.revision])).toEqual([
			['AGENTS.md', targetSha],
			['RECODER.md', targetSha]
		]);
	});
});
