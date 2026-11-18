import type { PullComment } from '@recoder/shared';

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
	description: null
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
