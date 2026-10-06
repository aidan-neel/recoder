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
	expect(sources[1].text).toStartWith(`No pull request record is available for ${second.slice(0, 7)},`);

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
		title: 'Earlier PR #4: Retry on two',
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

	expect(byRef['history:unavailable'].text).toStartWith(
		`No pull request record is available for ${[base, two, three].map(short).sort().join(', ')},`
	);

	expect(lookedUp.sort()).toEqual([base, two, three, pullMerge, branchMerge].sort());
});

test('a PR trailer names its PR, and a commit nothing names gets no invented PR; neither has a record', async () => {
	const root = repo();
	const first = commit(root, returning(1), 'Add run\n\nSee #12 for the plan.');
	const second = commit(root, returning(2), 'Return two\n\nPR-URL: https://github.com/o/r/pull/9');
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
		['pr:#9', 'Earlier PR #9']
	]);

	expect(sources[0]).toEqual({
		kind: 'pr-history',
		ref: `commit:${short(first)}`,
		title: 'Add run',
		author: 't',
		at: expect.any(String),
		revision: first,
		range: first,
		text: `${short(first)} Add run (touched run)\nSee #12 for the plan.`
	});

	expect(sources[1].text).toBe(
		`No pull request record is available for ${[first, second].map(short).sort().join(', ')}, so there is no PR description, issue or review discussion behind these commits beyond their commit and merge messages.`
	);

	expect(sources[2]).toMatchObject({
		url: 'https://github.com/o/r/pull/9',
		revision: second,
		range: `${first}..${second}`
	});
});
