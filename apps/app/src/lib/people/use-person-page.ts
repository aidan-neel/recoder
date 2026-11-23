'use client';

import type { PersonProfile, PersonRef } from '@recoder/shared';
import { useCallback, useMemo } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { useApi, useListStore, useProfileCache } from '../api/client';
import { ApiError, failureText } from '../api/http';
import { useOpenConversation } from '../messages/open-conversation';
import { useRowActions } from '../pulls/use-row-actions';
import { useKeyedRead } from '../shell/use-keyed-read';
import { personPageData } from './person-page';
import { personKey } from './refs';
import type { PersonPageView } from './types';

type ProfileState =
	| { phase: 'loading' }
	| { phase: 'ready'; profile: PersonProfile }
	| { phase: 'missing' }
	| { phase: 'failed'; error: string };

/**
 * A person's profile. The copy read before (an author's card, or an earlier visit) paints at once; the page reads it
 * again once per visit and on `retry`.
 */
function useProfile(ref: PersonRef): { state: ProfileState; retry: () => void } {
	const profiles = useProfileCache();

	const { answer, retry } = useKeyedRead(personKey(ref), () =>
		profiles.read(ref).then(
			(profile): ProfileState => ({ phase: 'ready', profile }),
			(error: unknown): ProfileState | null => {
				if (error instanceof ApiError && error.status === 404) return { phase: 'missing' };

				return profiles.peek(ref) ? null : { phase: 'failed', error: failureText(error) };
			}
		)
	);

	const kept = profiles.peek(ref);

	return { state: answer ?? (kept ? { phase: 'ready', profile: kept } : { phase: 'loading' }), retry };
}

/** The profile page: the person's profile from the server, with their pull requests as the list draws them. */
export function usePersonPage(ref: PersonRef): PersonPageView {
	const { base } = useApi();
	const list = useListStore();
	const { state, retry } = useProfile(ref);
	const conversation = useOpenConversation();

	const shared = useStore(
		list.state,
		useShallow((current) => ({ repos: current.repos, starting: current.starting }))
	);

	const profile = state.phase === 'ready' ? state.profile : null;

	const data = useMemo(
		() => (profile ? personPageData(profile, shared.repos, base) : null),
		[profile, shared.repos, base]
	);

	const accountId = data?.accountId ?? null;
	const openConversation = conversation.open;

	const { review, warm } = useRowActions();

	const message = useCallback(
		async (attach?: Parameters<typeof openConversation>[1]) => {
			if (accountId) await openConversation(accountId, attach);
		},
		[accountId, openConversation]
	);

	return {
		phase: state.phase,
		ref,
		data,
		error: state.phase === 'failed' ? state.error : null,
		retry,
		starting: shared.starting,
		review,
		warm,
		message,
		messaging: conversation.opening
	};
}
