'use client';

import { useEffect } from 'react';

import { useChecklist } from '@/lib/setup/checklist-store';

import { Checklist, type SetupAccount } from './checklist';

/**
 * The first screen of a server no one has set up: the checklist on its own, before the app's shell, since nothing
 * else works until an admin exists. Its claim, address and admin steps are done here; signing in opens the app,
 * where the rest of the checklist waits.
 */
export function SetupScreen({ account }: { account: SetupAccount }) {
	const checklist = useChecklist((state) => state.checklist);
	const error = useChecklist((state) => state.error);

	useEffect(() => {
		void useChecklist.getState().load();
	}, [account.auth.setupLocked]);

	return (
		<main className="setup-screen">
			{checklist ? <Checklist checklist={checklist} account={account} /> : null}
			{!checklist && error ? (
				<p className="setup-screen-error" role="alert">
					{error}
				</p>
			) : null}
		</main>
	);
}
