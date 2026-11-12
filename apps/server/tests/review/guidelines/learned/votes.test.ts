import { beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	forgetDismissedVotes,
	recordVote,
	removeVote,
	topicTallies,
	type VoteChoice
} from '../../../../src/review/guidelines/learned/votes';

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-votes-'));
});

const vote = (findingKey: string, choice: VoteChoice, topic = 'smell:magic-value') => ({
	findingKey,
	topic,
	choice,
	votedAt: new Date().toISOString()
});

test('a later decision on the same finding replaces its vote instead of adding one', () => {
	recordVote('repo-1', vote('f1', 'useful'));
	recordVote('repo-1', vote('f1', 'dismissed'));

	expect(topicTallies('repo-1').get('smell:magic-value')).toEqual({ useful: 0, dismissed: 1 });
	expect(topicTallies('repo-2').size).toBe(0);
});

test('taking back a useful vote leaves a dismissal recorded after it', () => {
	recordVote('repo-1', vote('f1', 'useful'));
	recordVote('repo-1', vote('f1', 'dismissed'));

	expect(removeVote('repo-1', 'f1', 'useful')).toBe(false);
	expect(topicTallies('repo-1').get('smell:magic-value')).toEqual({ useful: 0, dismissed: 1 });

	expect(removeVote('repo-1', 'f1', 'dismissed')).toBe(true);
	expect(topicTallies('repo-1').size).toBe(0);
});

test('turning a topic back on forgets only its dismissals', () => {
	recordVote('repo-1', vote('f1', 'dismissed'));
	recordVote('repo-1', vote('f2', 'dismissed'));
	recordVote('repo-1', vote('f3', 'useful'));
	recordVote('repo-1', vote('f4', 'dismissed', 'category:dead-code'));

	expect(forgetDismissedVotes('repo-1', 'smell:magic-value')).toBe(2);

	const tallies = topicTallies('repo-1');

	expect(tallies.get('smell:magic-value')).toEqual({ useful: 1, dismissed: 0 });
	expect(tallies.get('category:dead-code')).toEqual({ useful: 0, dismissed: 1 });
});
