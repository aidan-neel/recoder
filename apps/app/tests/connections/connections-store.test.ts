import { beforeEach, describe, expect, test } from 'bun:test';
import type { ProviderAuth, Repo } from '@recoder/shared';

import { useConnections } from '../../src/lib/connections/connections-store';

/** What the fake review server answers; each test changes it. */
interface Server {
	repos: Repo[];
	user: string | null;
	/** While set, the next GET waits for it, so a test can hold a load in flight. */
	hold: Promise<void> | null;
	/** While true, the repository list never answers, as if the server were not running. */
	down: boolean;
}

let server: Server;

function repo(id: string, name: string): Repo {
	return {
		id,
		name,
		url: `https://github.com/${name}`,
		provider: 'github',
		defaultBranch: 'main',
		createdAt: '',
		updatedAt: ''
	};
}

function signIn(user: string | null): Record<'github' | 'gitlab', ProviderAuth> {
	return {
		github: { provider: 'github', available: true, authenticated: user !== null, user },
		gitlab: { provider: 'gitlab', available: false, authenticated: false, user: null, host: null }
	};
}

/** Takes the hold, so only the request that saw it waits on it. */
async function held(): Promise<void> {
	const hold = server.hold;

	server.hold = null;
	await hold;
}

/** The review server's answer to one request, from what it holds when the request arrives. */
async function answer(path: string, method: string): Promise<Response> {
	const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

	if (path === '/api/repos' && server.down) throw new TypeError('Failed to fetch');

	if (path === '/api/repos' && method === 'GET') {
		const repos = [...server.repos];

		await held();

		return json(repos);
	}

	if (path === '/api/repos' && method === 'POST') {
		const added = repo(`r${server.repos.length + 1}`, 'acme/web');

		server.repos = [...server.repos, added];

		return json(added);
	}

	if (path.startsWith('/api/repos/') && method === 'DELETE') {
		server.repos = server.repos.filter((item) => `/api/repos/${item.id}` !== path);

		return json({ deleted: true });
	}

	if (path === '/api/auth/status') {
		const auth = signIn(server.user);

		await held();

		return json(auth);
	}

	if (path === '/api/auth/token') {
		server.user = 'new-user';

		return json({ provider: 'github', user: 'new-user' });
	}

	return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
}

/** A promise and the call that settles it. */
function gate(): [Promise<void>, () => void] {
	let release = () => {};
	const promise = new Promise<void>((resolve) => (release = resolve));

	return [promise, release];
}

beforeEach(() => {
	server = {
		repos: [repo('r1', 'acme/api'), repo('r2', 'acme/web'), repo('r3', 'acme/docs')],
		user: 'old-user',
		hold: null,
		down: false
	};

	Object.assign(globalThis, {
		fetch: (input: string | URL, init?: RequestInit) => answer(new URL(String(input)).pathname, init?.method ?? 'GET')
	});

	useConnections.setState({ auth: null, authStatus: 'idle', repos: null, reposStatus: 'idle', remote: {} });
});

describe('connections store', () => {
	test('a repository load that began before a removal does not bring the repository back', async () => {
		await useConnections.getState().loadRepos();

		const [hold, release] = gate();

		server.hold = hold;

		const slow = useConnections.getState().loadRepos();

		await useConnections.getState().removeRepo(repo('r2', 'acme/web'));
		release();
		await slow;

		expect(useConnections.getState().repos?.map((item) => item.name)).toEqual(['acme/api', 'acme/docs']);
	});

	test('a repository waiting on Undo stays off the list through a reload, and Undo puts it back in its place', async () => {
		await useConnections.getState().loadRepos();
		useConnections.getState().hideRepo(repo('r2', 'acme/web'), () => true);
		await useConnections.getState().loadRepos();

		expect(useConnections.getState().repos?.map((item) => item.id)).toEqual(['r1', 'r3']);

		useConnections.getState().restoreRepo(repo('r2', 'acme/web'));

		expect(useConnections.getState().repos?.map((item) => item.id)).toEqual(['r1', 'r2', 'r3']);
	});

	test('adding a repository while its removal waits on Undo calls the removal off and keeps its id', async () => {
		await useConnections.getState().loadRepos();

		let calledOff = false;

		useConnections.getState().hideRepo(repo('r2', 'acme/web'), () => (calledOff = true));

		const added = await useConnections
			.getState()
			.addRepo({ name: 'acme/web', url: 'https://github.com/acme/web', provider: 'github' });

		expect(calledOff).toBe(true);
		expect(added.id).toBe('r2');
		expect(useConnections.getState().repos?.map((item) => item.id)).toEqual(['r1', 'r2', 'r3']);
		expect(server.repos).toHaveLength(3);
	});

	test('a retry after the server was down keeps the offline state until the answer lands', async () => {
		server.down = true;
		await useConnections.getState().loadRepos();

		const [hold, release] = gate();

		server.down = false;
		server.hold = hold;

		const retry = useConnections.getState().loadRepos();

		expect(useConnections.getState().reposStatus).toBe('offline');
		release();
		await retry;
		expect(useConnections.getState().reposStatus).toBe('ready');
	});

	test('a sign-in check that began before a new token does not overwrite the fresh check', async () => {
		const [hold, release] = gate();

		server.hold = hold;

		const stale = useConnections.getState().loadAuth();

		await useConnections.getState().saveToken('github', 'ghp_test');
		release();
		await stale;

		expect(useConnections.getState().auth?.github.user).toBe('new-user');
	});
});
