'use client';

import type { UpdateStatus } from '@recoder/shared';
import { useEffect } from 'react';

import { useApi } from '../api/client';
import type { UpdateApi } from '../api/update';
import { describeUpdate, type UpdateLine, type UpdateRetry } from './update-line';
import { pollDelay, useUpdate } from './update-store';

/** What the Recoder strip in Settings → Admin shows: a placeholder while the status is first read, why it could not be, or the status as one line. */
export type UpdateStrip =
	| { view: 'loading' }
	| { view: 'failed'; error: string; retry: () => void }
	| { view: 'ready'; status: UpdateStatus; line: UpdateLine; busy: boolean; actions: UpdateActions };

interface UpdateActions {
	check: () => void;
	apply: () => Promise<void>;
	retry: (what: UpdateRetry) => void;
}

/**
 * Reads the updater's status when the section opens. While an update applies
 * it reads again every 1.5 seconds, and slower while the server is away, until
 * the update settles or the server stays away too long.
 */
export function useUpdateStrip(): UpdateStrip {
	const { update: api } = useApi();
	const read = useUpdate((store) => store.read);
	const status = useUpdate((store) => store.status);
	const phase = useUpdate((store) => store.phase);
	const unreachableSince = useUpdate((store) => store.unreachableSince);
	const polls = useUpdate((store) => store.polls);
	const error = useUpdate((store) => store.error);

	useEffect(() => {
		void useUpdate.getState().load(api);
	}, [api]);

	useEffect(() => {
		if (phase !== 'applying') return;

		const timer = setTimeout(
			() => void useUpdate.getState().poll(api, Date.now()),
			pollDelay(unreachableSince, Date.now())
		);

		return () => clearTimeout(timer);
	}, [api, phase, polls, unreachableSince]);

	if (read === 'loading') return { view: 'loading' };

	if (read === 'failed' || !status) {
		return { view: 'failed', error: error ?? 'Couldn’t read the update status.', retry: () => retry(api, 'load') };
	}

	const actions: UpdateActions = {
		check: () => retry(api, 'check'),
		apply: () => useUpdate.getState().apply(api),
		retry: (what) => retry(api, what)
	};

	return {
		view: 'ready',
		status,
		line: describeUpdate({ status, phase, unreachableSince, error }),
		busy: phase === 'checking' || phase === 'applying',
		actions
	};
}

function retry(api: UpdateApi, what: UpdateRetry): void {
	const store = useUpdate.getState();

	switch (what) {
		case 'load':
			void store.load(api);
			break;
		case 'check':
			void store.check(api);
			break;
		case 'update':
			void store.apply(api);
			break;
		case 'follow':
			store.resume();
			break;
	}
}
