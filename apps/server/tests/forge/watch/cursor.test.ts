import { expect, test } from 'bun:test';
import { DEFAULT_AUTO_REVIEW_SETTINGS, type AutoReviewSettings } from '@recoder/shared';
import {
	decideEvent,
	decidePull,
	readWatchState,
	writeWatchState,
	type PullCursor,
	type PullDecisionInput,
	type WatchedNote
} from '../../../src/forge/watch/cursor';

const CHECKED = '2026-11-01T10:00:00.000Z';
const NOW = '2026-11-01T10:02:00.000Z';

const settings: AutoReviewSettings = { ...DEFAULT_AUTO_REVIEW_SETTINGS, enabled: true, onOpened: true, onPushed: true };

function note(id: number, body: string, overrides: Partial<WatchedNote> = {}): WatchedNote {
	return { id, stream: 'comment', author: 'ana', body, createdAt: '2026-11-01T10:01:00.000Z', ...overrides };
}

/** A decision about open, non-draft PR 7 at head `b`, checked once before. */
function decide(overrides: Partial<PullDecisionInput> = {}) {
	return decidePull({
		settings,
		checkedAt: CHECKED,
		cursor: undefined,
		pull: { number: 7, headSha: 'b', draft: false, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: NOW },
		notes: [],
		reviewedBefore: false,
		reviewedHead: false,
		now: NOW,
		...overrides
	});
}

test('the first check of a repository starts nothing', () => {
	const pull = { number: 7, headSha: 'b', draft: false, createdAt: NOW, updatedAt: NOW };

	expect(decide({ checkedAt: null, pull, notes: [note(1, '@recoder review')] }).trigger).toBeNull();
});

test('a mention starts one review, and not again after a restart', () => {
	const notes = [note(1, 'old comment'), note(2, '@recoder focus on auth', { discussionId: 'd2' })];
	const first = decide({ notes });

	expect(first.trigger).toMatchObject({ reason: 'mention', by: 'ana', noteId: '2', discussionId: 'd2' });
	expect(first.trigger?.instructions).toBe('focus on auth');

	writeWatchState({ repos: { repo: { checkedAt: NOW, pulls: { 7: first.cursor } } }, recent: [] });

	const cursor = readWatchState().repos.repo?.pulls[7];

	expect(decide({ checkedAt: NOW, cursor, notes }).trigger).toBeNull();
});

test('a mention reviews a draft; opening a draft does not', () => {
	const draft = { number: 7, headSha: 'b', draft: true, createdAt: NOW, updatedAt: NOW };

	expect(decide({ pull: draft }).trigger).toBeNull();
	expect(decide({ pull: draft, notes: [note(3, '@recoder')] }).trigger?.reason).toBe('mention');
});

test('a push reviews again only after an automatic review, and never a reviewed head', () => {
	const cursor: PullCursor = { notesAfter: CHECKED, noteIds: {}, headSha: 'a', seenAt: CHECKED };

	expect(decide({ cursor }).trigger).toBeNull();
	expect(decide({ cursor, reviewedBefore: true }).trigger?.reason).toBe('pushed');
	expect(decide({ cursor, reviewedBefore: true, reviewedHead: true }).trigger).toBeNull();
});

test('a new GitHub review comment counts even when its id is below the conversation cursor', () => {
	const cursor: PullCursor = { notesAfter: CHECKED, noteIds: { comment: 9_000 }, headSha: 'b', seenAt: CHECKED };
	const inline = note(5_000, '@recoder is this safe?', { stream: 'review' });

	expect(decide({ cursor, notes: [inline] }).trigger?.noteStream).toBe('review');
});

test('a webhook mention is not reviewed again by the next poll, and old comments stay history', () => {
	const mention = note(50, '@recoder');

	const hook = decideEvent({
		settings,
		cursor: undefined,
		pull: { number: 7, headSha: '', draft: false, createdAt: '', updatedAt: '' },
		event: { kind: 'mention', note: mention },
		reviewedBefore: false,
		reviewedHead: false,
		now: NOW
	});

	expect(hook.trigger?.reason).toBe('mention');

	const oldInline = note(10, '@recoder', { stream: 'review', createdAt: '2026-10-01T00:00:00.000Z' });
	const poll = decide({ checkedAt: NOW, cursor: hook.cursor, notes: [mention, oldInline] });

	expect(poll.trigger).toBeNull();
});
