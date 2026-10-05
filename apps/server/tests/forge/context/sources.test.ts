import { expect, test } from 'bun:test';
import { CONTEXT_CAPS, finishSources, mentionedIssues } from '../../../src/forge/context/sources';
import type { IntentSource } from '../../../src/review/pipeline/intent/types';

test('issue mentions resolve own-repo references and skip entities, anchors and words', () => {
	const body = [
		'Fixes #12 and relates to octo/other#7.',
		'See https://github.com/octo/app/issues/30 and https://gitlab.com/g/sub/p/-/issues/5.',
		'Not these: &#123; PR#9 https://example.com/page#4 color #1a',
		'Again: octo/app#12'
	].join('\n');

	expect(mentionedIssues(body, 'octo/app')).toEqual([
		{ repo: null, number: 12 },
		{ repo: 'octo/other', number: 7 },
		{ repo: null, number: 30 },
		{ repo: 'g/sub/p', number: 5 }
	]);
});

test('sources sort by kind then natural ref order, and per-kind and total caps cut the same tail', () => {
	const comment = (n: number): IntentSource => ({ kind: 'comment', ref: `comment:#1/${n}`, text: 'x'.repeat(100) });
	const comments = Array.from({ length: CONTEXT_CAPS.comments + 5 }, (_, i) => comment(i + 1)).reverse();

	const issues: IntentSource[] = [
		{ kind: 'issue', ref: 'issue:#12', text: 'twelve' },
		{ kind: 'issue', ref: 'issue:#3', text: 'three' }
	];

	const big: IntentSource = { kind: 'commit', ref: 'commit:abc', text: 'y'.repeat(CONTEXT_CAPS.totalChars) };
	const pr: IntentSource = { kind: 'pr', ref: 'pr', text: 'body' };
	const kept = finishSources([big, ...comments, ...issues, pr]);

	expect(kept.slice(0, 3).map((source) => source.ref)).toEqual(['pr', 'issue:#3', 'issue:#12']);
	expect(kept.filter((source) => source.kind === 'comment')).toHaveLength(CONTEXT_CAPS.comments);
	expect(kept.at(-1)?.ref).toBe(`comment:#1/${CONTEXT_CAPS.comments}`);
	expect(kept.some((source) => source.ref === 'commit:abc')).toBe(false);
	expect(finishSources([...kept].reverse())).toEqual(kept);
});
