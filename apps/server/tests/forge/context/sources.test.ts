import { expect, test } from 'bun:test';
import { CONTEXT_CAPS, finishSources, mentionedIssues, namedPull } from '../../../src/forge/context/sources';
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

test('a commit message names its PR by squash subject, merge, GitLab footer or trailer, and nothing else', () => {
	const named = (subject: string, body = '', trailers = '') => namedPull({ subject, body, trailers });

	expect(named('Fix the parser (#123)')).toEqual({ number: 123, title: 'Fix the parser' });

	expect(named('Merge pull request #31 from al/parser', 'Fix the parser\n\nMore detail.')).toEqual({
		number: 31,
		title: 'Fix the parser'
	});

	expect(named('Merge pull request #32 from al/empty')).toEqual({ number: 32, title: '' });

	expect(named("Merge branch 'parser' into 'main'", 'Fix the parser\n\nSee merge request g/p!7')).toEqual({
		number: 7,
		title: 'Fix the parser'
	});

	expect(named('Fix the parser', '', 'Reviewed-on: https://github.com/o/r/pull/5\n')).toEqual({
		number: 5,
		title: '',
		url: 'https://github.com/o/r/pull/5'
	});

	expect(named('Fix the parser', '', 'PR: #6\nSigned-off-by: al <al@x>\n')).toEqual({ number: 6, title: '' });

	for (const [subject, body, trailers] of [
		["Merge branch 'parser'", 'Fix the parser'],
		['Merge remote-tracking branch origin/main'],
		['Fix #12 in the parser', 'Closes #12'],
		['Fix the parser', '', 'Refs: #12\nSee-also: https://github.com/o/r/issues/4\n'],
		['Fix the parser', '', 'PR-URL: https://example.com/page\n']
	])
		expect(named(subject, body, trailers)).toBeNull();
});
