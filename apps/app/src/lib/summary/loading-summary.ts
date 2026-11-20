import type { PullComment, PullDescription } from '@recoder/shared';

import type { SummaryView } from '../bugs/types';

/**
 * What stands in on the Summary tab while it first loads. The skeletons are
 * measured from it, so they have the lede's and the timeline's own lines;
 * once the tab has loaded, they use the shape it had then. No one reads it:
 * only how long each text runs matters.
 */
export const LOADING_SUMMARY: SummaryView = {
	analysis:
		'This change keeps the session token fresh across tabs. Each tab now reads the token from one shared store and renews it a minute before it runs out, so a tab left open no longer signs the person out. The renewal is guarded by a lock, so two tabs never renew at once, and a failed renewal is tried again before the session ends.',
	description:
		'Tabs kept their own copy of the token, so one tab could renew it while another still sent the old one and was signed out. This moves the token to a shared store and renews it under a lock.'
};

/** What stands in on the Description tab while the description loads or is written; only how long each text runs matters. */
export const LOADING_DESCRIPTION: PullDescription = {
	headSha: '0000000',
	model: { id: 'loading', label: 'Grok 4.6', effort: 'low' },
	summary:
		'Keeps the session token fresh across tabs. Each tab reads the token from one shared store and renews it a minute before it runs out, so a tab left open no longer signs the person out, and a renewal that fails is tried once more before the session ends.',
	groups: [
		{
			id: 'g1',
			title: 'One store for the token',
			note: 'Every tab reads and writes the token in one shared store.',
			explanation:
				'The store keeps the token and when it runs out in local storage, and tells every other tab through a storage event when it changes. Reads go through `readToken`, which returns null once the token has run out, so no tab sends one the server will refuse.',
			paths: ['src/session/token-store.ts', 'src/session/index.ts']
		},
		{
			id: 'g2',
			title: 'Renewing it under a lock',
			note: 'One tab renews the token a minute early while the others wait.',
			explanation: 'A lock in storage lets one tab renew at a time and runs out after ten seconds.',
			paths: ['src/session/renew.ts', 'src/session/lock.ts']
		},
		{
			id: 'g3',
			title: 'Tests',
			note: 'Two tabs renewing at once, and a renewal that fails.',
			explanation: 'The tests drive two tabs with a fake clock.',
			paths: ['tests/session/renew.test.ts']
		},
		{
			id: 'g4',
			title: 'Docs',
			note: 'How long a session lasts and when it renews.',
			explanation: 'The page says when a token renews.',
			paths: ['docs/sessions.md']
		}
	],
	notes: [
		'A tab closed in the middle of a renewal holds the lock for up to ten seconds, so the others wait that long.',
		'A renewal that fails is tried again once before the session ends and the person is signed out.'
	],
	createdAt: '2026-01-01T00:00:00.000Z'
};

/** What one stand-in comment says. */
const SHAPES: readonly (readonly [login: string, body: string])[] = [
	[
		'maria',
		'This reads well. One question on the lock: what happens when the tab that holds it is closed mid-renewal?'
	],
	['devon', 'The lock is released on unload, and it also runs out after ten seconds, so the next tab takes over.']
];

export const LOADING_CONVERSATION: readonly PullComment[] = SHAPES.map(([login, body], index) => ({
	id: `loading#${index}`,
	kind: 'comment',
	author: { login, name: null, avatarUrl: null },
	body,
	createdAt: new Date().toISOString(),
	url: null,
	byRecoder: false
}));
