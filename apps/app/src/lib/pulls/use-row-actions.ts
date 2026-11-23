'use client';

import { useCallback } from 'react';

import { useListStore, useSessionCache } from '../api/client';
import { failureText } from '../api/http';
import { errorToast } from '../shell/notify';
import type { PullRow } from './types';

/** What a page's pull request rows do: start a review, a refusal shown as a toast, and warm a row's page. */
export function useRowActions(): { review: (row: PullRow) => void; warm: (row: PullRow) => void } {
	const list = useListStore();
	const sessions = useSessionCache();

	const review = useCallback(
		(row: PullRow) => {
			list.start({ repoId: row.repoId, number: row.number, title: row.title }).catch((error: unknown) => {
				errorToast(failureText(error, 'The review did not start.'));
			});
		},
		[list]
	);

	const warm = useCallback((row: PullRow) => sessions.warm(row.repoId, row.number), [sessions]);

	return { review, warm };
}
