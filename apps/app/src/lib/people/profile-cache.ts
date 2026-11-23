import type { PersonProfile, PersonRef } from '@recoder/shared';

import type { ApiClient } from '../api/client';
import { keptReads } from '../api/kept-reads';
import { personKey } from './refs';

/** Profiles the app has read, by person: a profile page and an author's card share one read and paint the last copy. */
export interface ProfileCache {
	peek: (ref: PersonRef) => PersonProfile | null;
	read: (ref: PersonRef) => Promise<PersonProfile>;
	warm: (ref: PersonRef) => void;
}

export function createProfileCache(client: ApiClient): ProfileCache {
	const refs = new Map<string, PersonRef>();

	const reads = keptReads((key) => {
		const ref = refs.get(key);

		return ref ? client.people.profile(ref) : Promise.reject(new Error('Unknown person.'));
	});

	function key(ref: PersonRef): string {
		const id = personKey(ref);

		refs.set(id, ref);

		return id;
	}

	return {
		peek: (ref) => reads.peek(key(ref)),
		read: (ref) => reads.read(key(ref)),
		warm: (ref) => reads.warm(key(ref))
	};
}
