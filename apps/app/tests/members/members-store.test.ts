import { beforeEach, describe, expect, test } from 'bun:test';

import { ApiError, NetworkError } from '../../src/lib/api/http';
import { useMembers } from '../../src/lib/members/members-store';
import { createSampleMembers } from '../../src/lib/sample/sample-members';

beforeEach(() => {
	useMembers.setState({ status: 'idle', members: [], error: null });
});

describe('members store', () => {
	test('loads the admin first', async () => {
		await useMembers.getState().load(createSampleMembers());

		const { status, members } = useMembers.getState();

		expect(status).toBe('ready');
		expect(members[0]?.role).toBe('admin');
	});

	test('drops a removed person from the list', async () => {
		const api = createSampleMembers();

		await useMembers.getState().load(api);

		const [, member] = useMembers.getState().members;

		if (!member) throw new Error('The sample has no second person.');

		await useMembers.getState().remove(api, member);

		expect(useMembers.getState().members.some((item) => item.key === member.key)).toBe(false);
	});

	test('keeps the person on the list when the server refuses the removal', async () => {
		const api = { ...createSampleMembers(), remove: () => Promise.reject(new ApiError('Admin can’t be removed', 409)) };

		await useMembers.getState().load(api);

		const [admin] = useMembers.getState().members;

		if (!admin) throw new Error('The sample has no admin.');

		await expect(useMembers.getState().remove(api, admin)).rejects.toThrow('Admin can’t be removed.');
		expect(useMembers.getState().members).toContain(admin);
	});

	test('reads an unreachable server as offline, and a good list stays when a later read fails', async () => {
		const down = { ...createSampleMembers(), list: () => Promise.reject(new NetworkError('Failed to fetch')) };

		await useMembers.getState().load(down);

		expect(useMembers.getState().status).toBe('offline');

		await useMembers.getState().load(createSampleMembers());
		await useMembers.getState().load(down);

		expect(useMembers.getState().status).toBe('ready');
		expect(useMembers.getState().members.length).toBeGreaterThan(0);
	});
});
