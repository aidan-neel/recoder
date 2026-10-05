import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChangeModel, ChangedSymbol } from '../../../../src/review/pipeline/change-model/types';
import { gatherHistory } from '../../../../src/review/pipeline/intent/history';
import { git } from '../../../helpers/git';

function commit(root: string, body: string, message: string): string {
	writeFileSync(join(root, 'a.ts'), body);
	git(root, ['add', '.']);
	git(root, ['commit', '-q', '-m', message]);

	return git(root, ['rev-parse', 'HEAD']);
}

function symbol(change: ChangedSymbol['change']): ChangedSymbol {
	return {
		id: 'a.ts#run',
		name: 'run',
		qualifiedName: 'run',
		kind: 'function',
		file: 'a.ts',
		startLine: 1,
		endLine: 3,
		change,
		hunkIds: [],
		language: 'typescript',
		signature: 'function run()',
		exported: false,
		calls: [],
		references: [],
		tests: [],
		examples: [],
		metrics: { lines: 3, maxDepth: 1, params: 0 }
	};
}

function model(change: ChangedSymbol['change']): ChangeModel {
	return { symbols: [symbol(change)], byHunk: {}, baselines: [], unparsed: [] };
}

test('history cites the older commits of a modified symbol, grouped by PR, and skips the PR own commits', async () => {
	const root = mkdtempSync(join(tmpdir(), 'recoder-history-'));

	git(root, ['init', '-q', '-b', 'main']);

	const first = commit(root, 'function run() {\n\treturn 1;\n}\n', 'Add run');
	const second = commit(root, 'function run() {\n\treturn 2;\n}\n', 'Return two for retries\n\nCallers retry on 2.');
	const own = commit(root, 'function run() {\n\treturn 3;\n}\n', 'This PR');
	const lookedUp: string[] = [];

	const sources = await gatherHistory({
		model: model('modified'),
		checkoutPath: root,
		signal: new AbortController().signal,
		headSha: own,
		mergeBaseSha: second,
		prsForCommit: async (sha) => {
			lookedUp.push(sha);

			return sha === first ? [{ number: 2, title: 'Start', state: 'merged', headRef: 'start', baseRef: 'main' }] : [];
		}
	});

	expect(lookedUp.sort()).toEqual([first, second].sort());

	expect(sources.map((source) => [source.ref, source.kind])).toEqual([
		[`commit:${second.slice(0, 7)}`, 'pr-history'],
		['pr:#2', 'pr-history']
	]);

	expect(sources[0].text).toBe(`${second.slice(0, 7)} Return two for retries (touched run)\nCallers retry on 2.`);

	expect(
		await gatherHistory({ model: model('added'), checkoutPath: root, signal: new AbortController().signal })
	).toEqual([]);
});
