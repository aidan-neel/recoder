'use client';

import type { Member } from '@recoder/shared';
import type { ButtonStatus } from '@recoder/ui';
import { useEffect } from 'react';

import { useApi } from '../api/client';
import { useAction } from '../shell/use-action';
import { useMembers } from './members-store';

/** What the member list in Settings → Admin shows: the list, a skeleton while it is first read, or why it could not be. */
export type MembersSection =
	| { view: 'loading' }
	| { view: 'failed'; error: string | null; retry: { status: ButtonStatus; run: () => void } }
	| { view: 'ready'; members: Member[] };

/** Reads the members when the section opens, and again from Try again after a failure. */
export function useMembersSection(): MembersSection {
	const { members: api } = useApi();
	const status = useMembers((state) => state.status);
	const members = useMembers((state) => state.members);
	const error = useMembers((state) => state.error);
	const retry = useAction();

	useEffect(() => {
		void useMembers.getState().load(api);
	}, [api]);

	if (status === 'ready') return { view: 'ready', members };

	if (status === 'error' || status === 'offline') {
		return {
			view: 'failed',
			error,
			retry: { status: retry.status, run: () => retry.run(() => useMembers.getState().load(api)) }
		};
	}

	return { view: 'loading' };
}
