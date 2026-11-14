import type { Member } from '@recoder/shared';

import { del, request, seg } from './http';

/** The member calls Settings → Admin makes. All of them are the admin's: a member gets 403 `admin-only`. */
export interface MembersApi {
	/** The admin first, then everyone who has signed in. */
	list: () => Promise<Member[]>;
	/** Takes a person off by their `Member.key`; rejects with 409 for the admin. */
	remove: (key: string) => Promise<void>;
}

/** The review server's members. */
export const membersApi: MembersApi = {
	list: () => request<Member[]>('/api/members'),
	remove: (key) => del<void>(`/api/members/${seg(key)}`)
};
