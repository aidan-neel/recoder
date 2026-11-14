import type { Member } from '@recoder/shared';
import { create } from 'zustand';

import { failureText, isOffline, plainly } from '../api/http';
import type { MembersApi } from '../api/members';

/** `offline`: the review server did not answer. `error`: it answered with one. */
type MembersStatus = 'idle' | 'loading' | 'ready' | 'error' | 'offline';

interface MembersStore {
	status: MembersStatus;
	/** The admin first, then the others in the order they joined. */
	members: Member[];
	/** The server's reason the last load failed; null when it never answered. */
	error: string | null;
	/** Reads the list. A list already on screen stays there while it loads, and after a failed read. */
	load: (api: MembersApi) => Promise<void>;
	/** Removes a person on the server, then from the list. Rejects with the server's reason in plain words. */
	remove: (api: MembersApi, member: Member) => Promise<void>;
}

export const useMembers = create<MembersStore>((set, get) => ({
	status: 'idle',
	members: [],
	error: null,

	async load(api) {
		if (get().status !== 'ready') set({ status: 'loading' });

		try {
			set({ members: await api.list(), status: 'ready', error: null });
		} catch (error) {
			if (get().status === 'ready') return;

			set(
				isOffline(error)
					? { status: 'offline', error: null }
					: { status: 'error', error: failureText(error, 'Couldn’t read the members.') }
			);
		}
	},

	async remove(api, member) {
		await plainly(() => api.remove(member.key));

		set((state) => ({ members: state.members.filter((item) => item.key !== member.key) }));
	}
}));
