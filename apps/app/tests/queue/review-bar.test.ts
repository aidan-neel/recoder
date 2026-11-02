import { describe, expect, test } from 'bun:test';
import type { Repo } from '@recoder/shared';

import { completion, rowActions, suggestionGroups, type BarContext } from '../../src/lib/queue/review-bar';
import { sampleQueue } from '../../src/lib/sample/sample-queue';
import { parseReviewQuery } from '../../src/lib/shell/pull-ref';

const API: Repo = {
	id: 'sample-repo',
	name: 'acme/api',
	url: 'https://github.com/acme/api',
	provider: 'github',
	defaultBranch: 'main',
	createdAt: '',
	updatedAt: ''
};

const LIVE: BarContext = { entries: sampleQueue(), repos: [API], sample: false, gitlabHost: null };

const kinds = (text: string, context = LIVE) =>
	suggestionGroups(parseReviewQuery(text), context).flatMap((group) => group.items.map((item) => item.kind));

describe('suggestionGroups', () => {
	test('offers the listed pull request for its reference, and a number the queue lacks in each tracked repository', () => {
		expect(kinds('api#214 focus on auth')).toEqual(['pull']);
		expect(kinds('#999')).toEqual(['number']);
	});

	test('offers to track the repository a pasted link names, and only explains in the sample', () => {
		expect(kinds('https://github.com/other/thing/pull/12')).toEqual(['track']);
		expect(kinds('https://github.com/other/thing/pull/12', { ...LIVE, sample: true })).toEqual(['untracked']);
		expect(kinds('#999', { ...LIVE, sample: true })).toEqual([]);
	});
});

describe('rowActions', () => {
	const [reviewed] = suggestionGroups(parseReviewQuery('#214'), LIVE)[0].items;
	const [unreviewed] = suggestionGroups(parseReviewQuery('#205'), LIVE)[0].items;

	test('opens a reviewed pull request, but reviews it again when a brief is typed', () => {
		expect(rowActions(reviewed, false, false).primary?.kind).toBe('open');

		expect(rowActions(reviewed, true, false)).toMatchObject({
			primary: { kind: 'start' },
			alternate: { kind: 'open' }
		});
	});

	test('starts a missing review, with the comment as the alternate until the switch asks for it', () => {
		expect(rowActions(unreviewed, false, false)).toMatchObject({
			primary: { kind: 'start', comment: false },
			alternate: { comment: true }
		});

		expect(rowActions(unreviewed, false, true)).toMatchObject({ primary: { comment: true }, alternate: null });
	});

	test('completes a row to its short reference and keeps the brief', () => {
		expect(completion(reviewed, LIVE.entries, 'only python')).toBe('api#214 only python');
	});
});
