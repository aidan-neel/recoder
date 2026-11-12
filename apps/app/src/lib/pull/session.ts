import { createStore } from 'zustand/vanilla';

import type { ApiClient } from '../api/client';
import { createBugChat } from '../ask/bug-thread';
import { createPullChat } from '../ask/pull-chat';
import { createBugActions } from '../bugs/bug-actions';
import { readViewed, viewedKey } from '../changes/viewed-files';
import type { ListStore } from '../pulls/list-store';
import { createReviewFollow } from '../run/review-follow';
import { createMerge } from './merge';
import { createPageLoads } from './page-loads';
import { initialSession, type SessionContext } from './session-state';

/** One pull request page's data and everything a person does on it. */
export function createSession(client: ApiClient, list: ListStore, repoId: string, number: number) {
	const state = createStore(() => initialSession(readViewed(viewedKey(repoId, number))));
	const context: SessionContext = { client, list, state, repoId, number };
	const bugChat = createBugChat(context);

	const pages = createPageLoads(context, {
		pageLoaded: (page) => review.sync(page.review)
	});

	const review = createReviewFollow(context, {
		reviewFollowed: (id) => bugChat.load(id),
		reviewSettled: () => void pages.loadPage()
	});

	return {
		state,
		repoId,
		number,
		pages,
		review,
		bugs: createBugActions(context),
		bugChat,
		pullChat: createPullChat(context, review),
		merge: createMerge(context, pages.loadPage),

		/** Loads the page and the diff at once and follows the review; returns the close. */
		open(): () => void {
			void pages.loadPage();
			void pages.loadDiff();

			const stopChecks = pages.pollChecks();

			return () => {
				stopChecks();
				review.close();
			};
		}
	};
}

export type Session = ReturnType<typeof createSession>;
