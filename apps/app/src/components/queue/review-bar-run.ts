import { ApiError, failureText } from '@/lib/api/http';
import { reviewsApi, type StartOptions } from '@/lib/api/reviews';
import { useConnections } from '@/lib/connections/connections-store';
import { useQueue } from '@/lib/queue/queue-store';
import type { BarAction, Suggestion } from '@/lib/queue/review-bar';
import type { SettingsSection } from '@/lib/settings/sections';
import { openSettings } from '@/lib/settings/settings-url';
import { pullRef } from '@/lib/shell/format';

import { openEntry } from './use-queue-controls';

/** What a started review leaves on the bar's status line, and the review to open from it (none for a sample run). */
export interface BarOutcome {
	text: string;
	reviewId: string | null;
}

/** Why a row's action failed, in plain words, and the settings section that fixes it, when one does. */
export interface BarFailure {
	text: string;
	section: SettingsSection | null;
}

/** How the row's pull request goes by in the status line: `api #214`. */
export function itemRef(item: Suggestion): string {
	switch (item.kind) {
		case 'pull':
			return pullRef(item.entry.repo, item.entry.pull.number);
		case 'number':
			return pullRef(item.repo.name, item.number);
		case 'track':
			return pullRef(item.target.name, item.number);
		case 'untracked':
			return item.named;
	}
}

/** "Reviewing api #214 with your brief and a comment on the PR." */
function startedText(ref: string, options: StartOptions): string {
	const extras = [options.brief ? 'your brief' : '', options.comment ? 'a comment on the PR' : ''].filter(Boolean);

	return `Reviewing ${ref}${extras.length > 0 ? ` with ${extras.join(' and ')}` : ''}.`;
}

/** Starts a review of a pull request the queue does not list, then reloads the queue so a new repository's rows show. */
async function startNumber(repoId: string, number: number, options: StartOptions): Promise<string> {
	const review = await reviewsApi.startNumber(repoId, number, options);

	void useQueue.getState().refresh();

	return review.id;
}

/**
 * Runs one of the bar's actions. Opening and going to Settings happen at once
 * and resolve null; starting resolves with what the status line says.
 * Rejects with the server's reason.
 */
export async function runAction(
	item: Suggestion,
	action: BarAction,
	brief: string,
	sample: boolean
): Promise<BarOutcome | null> {
	const options: StartOptions = { brief, comment: action.comment };
	const text = startedText(itemRef(item), options);

	if (action.kind === 'settings') {
		openSettings('connections');

		return null;
	}

	if (item.kind === 'pull') {
		if (action.kind === 'open') {
			openEntry(item.entry, sample);

			return null;
		}

		const review = await useQueue.getState().launch(item.entry, options);

		return { text, reviewId: review?.id ?? null };
	}

	if (item.kind === 'number') return { text, reviewId: await startNumber(item.repo.id, item.number, options) };

	if (item.kind === 'track') {
		const repo = await useConnections.getState().addRepo(item.target);

		return {
			text: `Tracking ${item.target.name}. ${text}`,
			reviewId: await startNumber(repo.id, item.number, options)
		};
	}

	return null;
}

/**
 * What the bar says when a start fails: the server's reason, with Settings
 * when it can fix it (a forge that turned the token down, a missing reviewer
 * model).
 */
export function barFailure(item: Suggestion, error: unknown): BarFailure {
	const auth = error instanceof ApiError && error.kind === 'auth';
	const setup = error instanceof ApiError && !!error.action;

	return {
		text: `Couldn’t review ${itemRef(item)}. ${failureText(error)}`,
		section: auth ? 'connections' : setup ? 'agent' : null
	};
}
