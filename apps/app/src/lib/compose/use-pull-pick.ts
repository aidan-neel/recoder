'use client';

import { useCallback, useMemo, useState } from 'react';

import { useApi, useListStore } from '../api/client';
import { ApiError, failureText, isOffline } from '../api/http';
import type { PullRow } from '../pulls/types';
import type { RowEntry } from '../pulls/use-rows';
import { pickOfRow, useComposePick } from './compose-pick';
import type { PullTake } from './compose-target';
import type { ComposePick, PickTarget } from './types';

/** What the pick does: it is chosen from a row, taken from the field's text, or let go. */
export interface PullPick {
	pick: ComposePick | null;
	/** Why the pull request last typed could not be chosen. */
	refusal: string | null;
	choose: (row: PullRow) => void;
	/** Acts on a reference taken out of the field: chooses its pull request, or keeps why it cannot be. */
	take: (take: PullTake) => void;
	/** Lets go of the pick. */
	release: () => void;
	/** Drops the refusal, once the person edits or chooses. */
	clearRefusal: () => void;
}

/**
 * The pull request New will review and the line that says why a typed one
 * could not be chosen. A typed `#214` is known from the list, else read from
 * the pull request's page, so a number that does not exist says so instead of
 * failing later at the start.
 */
export function usePullPick(entries: RowEntry[]): PullPick {
	const { pick, setPick } = useComposePick();
	const [refusal, setRefusal] = useState<string | null>(null);
	const client = useApi();
	const list = useListStore();

	const choose = useCallback(
		(row: PullRow) => {
			setRefusal(null);
			list.setComposeRepo(row.repoId);
			setPick(pickOfRow(row));
		},
		[list, setPick]
	);

	const choosePulled = useCallback(
		async (target: PickTarget) => {
			if (target.kind === 'untracked') return setPick({ target, title: null });

			list.setComposeRepo(target.repoId);

			const listed = entries.find(({ row }) => row.repoId === target.repoId && row.number === target.number);

			if (listed) return setPick({ target, title: listed.row.title });

			try {
				const page = await client.pullPage(target.repoId, target.number);

				setPick({ target, title: page.pull.title });
			} catch (failure) {
				setRefusal(lookupFailure(target, failure));
			}
		},
		[entries, list, client, setPick]
	);

	const take = useCallback(
		(taken: PullTake) => {
			if (taken.kind === 'refused') return setRefusal(taken.reason);

			setRefusal(null);
			void choosePulled(taken.target);
		},
		[choosePulled]
	);

	const release = useCallback(() => setPick(null), [setPick]);
	const clearRefusal = useCallback(() => setRefusal(null), []);

	return useMemo(
		() => ({ pick, refusal, choose, take, release, clearRefusal }),
		[pick, refusal, choose, take, release, clearRefusal]
	);
}

/** One sentence for a pull request that could not be read: it is not there, or the server did not answer. */
function lookupFailure(target: PickTarget, failure: unknown): string {
	const unanswered = isOffline(failure) || (failure instanceof ApiError && failure.status !== 404);

	if (unanswered) return failureText(failure);

	return `Pull request #${target.number} was not found in ${target.repoName}.`;
}
