import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChangeModel, ChangedSymbol } from '../../../../src/review/pipeline/change-model/types';
import { gatherHistory } from '../../../../src/review/pipeline/intent/history';
import type { IntentSource } from '../../../../src/review/pipeline/intent/types';
import { git } from '../../../helpers/git';

function commit(root: string, body: string, message: string, files = ['a.ts']): string {
	for (const file of files) writeFileSync(join(root, file), body);
	git(root, ['add', '.']);
	git(root, ['commit', '-q', '-m', message]);

	return git(root, ['rev-parse', 'HEAD']);
}

function symbol(change: ChangedSymbol['change'], file = 'a.ts'): ChangedSymbol {
	return {
		id: `${file}#run`,
		name: 'run',
		qualifiedName: 'run',
		kind: 'function',
		file,
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

function model(change: ChangedSymbol['change'], files = ['a.ts']): ChangeModel {
	return { symbols: files.map((file) => symbol(change, file)), byHunk: {}, baselines: [], unparsed: [] };
}

/** `run` returning `value`, the body every commit here rewrites. */
function returning(value: number): string {
	return `function run() {\n\treturn ${value};\n}\n`;
}

function repo(): string {
	const root = mkdtempSync(join(tmpdir(), 'recoder-history-'));

	git(root, ['init', '-q', '-b', 'main']);

	return root;
}

/** Merges `branch` into main with no fast-forward, so the merge commit carries `message`. */
function merge(root: string, branch: string, ...message: string[]): string {
	git(root, ['checkout', '-q', 'main']);
	git(root, ['merge', '-q', '--no-ff', branch, ...message.flatMap((paragraph) => ['-m', paragraph])]);

	return git(root, ['rev-parse', 'HEAD']);
}

const short = (sha: string) => sha.slice(0, 7);

/** The short shas the `history:unavailable` source lists, sorted; null when there is no such source. */
function unavailable(sources: IntentSource[]): string[] | null {
	const source = sources.find((candidate) => candidate.ref === 'history:unavailable');

	return source ? (source.text.match(/\b[0-9a-f]{7}\b/g) ?? []).sort() : null;
}

test('history cites the older commits of a modified symbol, grouped by PR, and skips the PR own commits', async () => {
	const root = repo();
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
		['history:unavailable', 'pr-history'],
		['pr:#2', 'pr-history']
	]);

	expect(sources[0].text).toBe(`${second.slice(0, 7)} Return two for retries (touched run)\nCallers retry on 2.`);
	expect(sources[1].title).toBe('History unavailable');
	expect(sources[2].recorded).toBe(true);
	expect(unavailable(sources)).toEqual([second.slice(0, 7)]);

	expect(
		await gatherHistory({ model: model('added'), checkoutPath: root, signal: new AbortController().signal })
	).toEqual([]);
});

test('a merge whose commits carry no PR number keeps the PR it names, and a branch merge keeps its own message', async () => {
	const root = repo();
	const base = commit(root, returning(1), 'Add run');

	git(root, ['checkout', '-q', '-b', 'retry']);

	const two = commit(root, returning(2), 'Return two');
	const pullMerge = merge(root, 'retry', 'Merge pull request #4 from t/retry', 'Retry on two');

	git(root, ['checkout', '-q', '-b', 'three']);

	const three = commit(root, returning(3), 'Return three');
	const branchMerge = merge(root, 'three', "Merge branch 'three'", 'Callers wanted three.');
	const own = commit(root, returning(4), 'This PR');
	const lookedUp: string[] = [];

	const sources = await gatherHistory({
		model: model('modified'),
		checkoutPath: root,
		signal: new AbortController().signal,
		headSha: own,
		mergeBaseSha: branchMerge,
		prsForCommit: async (sha) => {
			lookedUp.push(sha);

			return [];
		}
	});

	const byRef = Object.fromEntries(sources.map((source) => [source.ref, source]));

	expect(sources.map((source) => source.ref)).toEqual([
		`commit:${short(base)}`,
		'history:unavailable',
		`merge:${short(branchMerge)}`,
		'pr:#4'
	]);

	expect(byRef['pr:#4']).toMatchObject({
		title: 'PR #4 named in merge message: Retry on two',
		recorded: false,
		revision: pullMerge,
		range: `${base}..${two}`,
		text: `${short(two)} Return two (touched run)`
	});

	expect(byRef[`merge:${short(branchMerge)}`]).toMatchObject({
		title: "Merge branch 'three'",
		author: 't',
		revision: branchMerge,
		range: `${pullMerge}..${three}`,
		text: `${short(three)} Return three (touched run)\nCallers wanted three.`
	});

	expect(byRef[`commit:${short(base)}`]).toMatchObject({ title: 'Add run', revision: base, range: base });

	expect(unavailable(sources)).toEqual([base, two, three].map(short).sort());

	expect(lookedUp.sort()).toEqual([base, two, three, pullMerge, branchMerge].sort());
});

test('a PR trailer names its PR, and a commit nothing in this repo names gets no invented PR', async () => {
	const root = repo();
	const first = commit(root, returning(1), 'Add run\n\nSee #12.\n\nPR-URL: https://github.com/other/lib/pull/3');
	const second = commit(root, returning(2), 'Return two\n\nPR: #9');
	const own = commit(root, returning(3), 'This PR');

	const sources = await gatherHistory({
		model: model('modified'),
		checkoutPath: root,
		signal: new AbortController().signal,
		headSha: own,
		mergeBaseSha: second
	});

	expect(sources.map((source) => [source.ref, source.title])).toEqual([
		[`commit:${short(first)}`, 'Add run'],
		['history:unavailable', 'History unavailable'],
		['pr:#9', 'PR #9 named in commit message']
	]);

	expect(sources[0]).toEqual({
		kind: 'pr-history',
		ref: `commit:${short(first)}`,
		title: 'Add run',
		author: 't',
		at: expect.any(String),
		revision: first,
		range: first,
		text: `${short(first)} Add run (touched run)\nSee #12.\n\nPR-URL: https://github.com/other/lib/pull/3`
	});

	expect(unavailable(sources)).toEqual([first, second].map(short).sort());
	expect(sources[2]).toMatchObject({ recorded: false, revision: second, range: `${first}..${second}` });
	expect(sources[2].url).toBeUndefined();
});

test('a record for the merge outranks a PR the commit names, which outranks a PR the merge names', async () => {
	const root = repo();
	const files = ['a.ts', 'b.ts', 'c.ts'];
	const base = commit(root, returning(1), 'Add run', files);

	git(root, ['checkout', '-q', '-b', 'x']);

	const named = commit(root, returning(2), 'Return two (#7)', ['a.ts']);
	const recordedMerge = merge(root, 'x', 'Merge pull request #4 from t/x', 'Four');

	git(root, ['checkout', '-q', '-b', 'y']);

	const commitNamed = commit(root, returning(3), 'Return three (#8)', ['b.ts']);
	const namingMerge = merge(root, 'y', 'Merge pull request #5 from t/y', 'Five');

	git(root, ['checkout', '-q', '-b', 'z']);

	const plain = commit(root, returning(4), 'Return four', ['c.ts']);
	const lastMerge = merge(root, 'z', 'Merge pull request #6 from t/z', 'Six');
	const own = commit(root, returning(5), 'This PR', files);
	const record = { number: 9, title: 'Recorded nine', url: 'https://example.test/pull/9', state: 'merged' };

	const sources = await gatherHistory({
		model: model('modified', files),
		checkoutPath: root,
		signal: new AbortController().signal,
		headSha: own,
		mergeBaseSha: lastMerge,
		prsForCommit: async (sha) => (sha === recordedMerge ? [{ ...record, headRef: 'x', baseRef: 'main' }] : [])
	});

	const byRef = Object.fromEntries(sources.map((source) => [source.ref, source]));

	expect(Object.keys(byRef)).toEqual([`commit:${short(base)}`, 'history:unavailable', 'pr:#6', 'pr:#8', 'pr:#9']);

	expect(byRef['pr:#9']).toMatchObject({
		title: 'Earlier PR #9: Recorded nine',
		recorded: true,
		url: record.url,
		revision: recordedMerge,
		range: `${base}..${named}`
	});

	expect(byRef['pr:#8']).toMatchObject({
		title: 'PR #8 named in commit message: Return three',
		recorded: false,
		revision: namingMerge,
		range: `${recordedMerge}..${commitNamed}`
	});

	expect(byRef['pr:#6']).toMatchObject({
		title: 'PR #6 named in merge message: Six',
		recorded: false,
		revision: lastMerge,
		range: `${namingMerge}..${plain}`
	});

	expect(unavailable(sources)).toEqual([base, commitNamed, plain].map(short).sort());
});

test('a landing git cannot walk reports no revision or range rather than the commit landing alone', async () => {
	const root = repo();
	const first = commit(root, returning(1), 'Add run');
	const second = commit(root, returning(2), 'Return two');

	const sources = await gatherHistory({
		model: model('modified'),
		checkoutPath: root,
		signal: new AbortController().signal,
		headSha: second,
		mergeBaseSha: '0'.repeat(40)
	});

	expect(sources.map((source) => source.ref).sort()).toEqual(
		[`commit:${short(first)}`, `commit:${short(second)}`, 'history:unavailable'].sort()
	);

	for (const source of sources) {
		expect(source.revision).toBeUndefined();
		expect(source.range).toBeUndefined();
	}
});
