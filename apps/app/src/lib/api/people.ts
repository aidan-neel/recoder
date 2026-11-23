import type { PersonProfile, PersonRef, PersonSummary } from '@recoder/shared';

import { request, seg } from './http';

/** People on this server's forges: who can be messaged, and one person's profile. */
export interface PeopleApi {
	/** Everyone on this server who can be messaged, the signed-in person left out. */
	list: () => Promise<PersonSummary[]>;
	/** One person's profile over the tracked repositories; rejects with a 404 for someone the forge does not know. */
	profile: (ref: PersonRef) => Promise<PersonProfile>;
}

/** The review server's people. */
export const peopleApi: PeopleApi = {
	list: () => request<PersonSummary[]>('/api/people'),
	profile: ({ provider, host, login }) =>
		request<PersonProfile>(
			`/api/people/${seg(provider)}/${seg(login)}${host ? `?host=${encodeURIComponent(host)}` : ''}`
		)
};
