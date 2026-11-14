import type { Member } from '@recoder/shared';

import type { MembersApi } from '../api/members';
import { ApiError } from '../api/http';

const SAMPLE_AT = '2026-11-01T09:00:00.000Z';

function seedMembers(): Member[] {
	return [
		{
			key: 'github::you',
			id: 'sample',
			provider: 'github',
			host: null,
			login: 'you',
			name: 'Sample person',
			avatarUrl: null,
			role: 'admin',
			joinedAt: SAMPLE_AT
		},
		{
			key: 'github::mira',
			id: 'sample-mira',
			provider: 'github',
			host: null,
			login: 'mira',
			name: 'Mira Okafor',
			avatarUrl: null,
			role: 'member',
			joinedAt: SAMPLE_AT
		},
		{
			key: 'gitlab:git.acme.dev:tomas',
			id: 'sample-tomas',
			provider: 'gitlab',
			host: 'git.acme.dev',
			login: 'tomas',
			name: null,
			avatarUrl: null,
			role: 'member',
			joinedAt: SAMPLE_AT
		}
	];
}

/** The sample's members, kept in memory and answering as the server does: the admin cannot be removed. */
export function createSampleMembers(): MembersApi {
	let members = seedMembers();

	return {
		list: async () => structuredClone(members),

		async remove(key) {
			const member = members.find((item) => item.key === key);

			if (!member) throw new ApiError('That person is not on this server.', 404);
			if (member.role === 'admin') throw new ApiError('The admin can’t be removed.', 409);

			members = members.filter((item) => item.key !== key);
		}
	};
}
