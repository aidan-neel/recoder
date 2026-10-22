import { beforeEach, describe, expect, test } from 'bun:test';
import type { AgentProvider, AgentStatus, ModelSettings } from '@recoder/shared';

import { useSettings } from '../../src/lib/settings/settings-store';

/** What the fake review server answers; each test changes it. */
interface Server {
	settings: ModelSettings;
	agents: AgentStatus[];
	/** A string answers the agent check with a 500 and that error. */
	agentCheck: 'ok' | string;
	/** `down` throws as if nothing listens; a string answers 500 with that error. */
	models: 'ok' | 'down' | string;
	/** While set, GET /api/settings/models waits for it, so a test can hold a load in flight. */
	hold: Promise<void> | null;
	/** Each request as `METHOD /path?query`, in the order they arrived. */
	calls: string[];
}

let server: Server;

function settings(subagentCap: ModelSettings['subagentCap']): ModelSettings {
	return {
		configured: true,
		baseUrl: '',
		model: '',
		apiKeyPreview: null,
		sharedModelId: null,
		models: [],
		subagentCap,
		reportLowSeverity: true,
		limits: { maxFiles: 20, maxDiffChars: 60_000, maxFileChars: 12_000 }
	};
}

const openCode: AgentStatus = {
	id: 'opencode',
	name: 'OpenCode',
	installed: true,
	version: '1.0.0',
	path: '/usr/bin/opencode',
	error: null,
	install: '',
	signedIn: null,
	login: null,
	providers: true
};

const anthropic: AgentProvider = {
	id: 'anthropic',
	name: 'Anthropic',
	modelCount: 12,
	connected: true,
	via: 'key',
	removable: true,
	methods: []
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** The review server's answer to one request. */
async function answer(url: URL, init?: RequestInit): Promise<Response> {
	const method = init?.method ?? 'GET';

	server.calls.push(`${method} ${url.pathname}${url.search}`);

	if (url.pathname === '/api/agent') {
		return server.agentCheck === 'ok' ? json({ agents: server.agents }) : json({ error: server.agentCheck }, 500);
	}

	if (url.pathname === '/api/agent/providers') return json({ providers: [anthropic] });

	if (url.pathname === '/api/settings/models' && method === 'PUT') {
		const patch = JSON.parse(String(init?.body)) as Partial<ModelSettings>;

		server.settings = { ...server.settings, ...patch };

		return json(server.settings);
	}

	if (url.pathname === '/api/settings/models') {
		await server.hold;

		if (server.models === 'down') throw new TypeError('Failed to fetch');
		if (server.models !== 'ok') return json({ error: server.models }, 500);

		return json(server.settings);
	}

	return json({ error: 'not found' }, 404);
}

const modelReads = () => server.calls.filter((call) => call === 'GET /api/settings/models').length;

beforeEach(() => {
	server = { settings: settings(2), agents: [openCode], agentCheck: 'ok', models: 'ok', hold: null, calls: [] };

	Object.assign(globalThis, {
		fetch: (input: string | URL, init?: RequestInit) => answer(new URL(String(input)), init)
	});

	useSettings.setState({ status: 'idle', models: null, agents: [], providers: [], error: null, agentError: null });
});

describe('settings store', () => {
	test('loads that start together share one request', async () => {
		await Promise.all([useSettings.getState().load(), useSettings.getState().load()]);

		expect(modelReads()).toBe(1);
		expect(useSettings.getState()).toMatchObject({ status: 'ready', agents: [openCode] });
	});

	test('a refresh asked for during a plain load runs after it and re-runs the agent check', async () => {
		let release = () => {};

		server.hold = new Promise((resolve) => (release = resolve));

		const first = useSettings.getState().load();
		const refresh = useSettings.getState().load(true);

		release();
		await Promise.all([first, refresh]);

		expect(server.calls.filter((call) => call.startsWith('GET /api/agent?'))).toEqual(['GET /api/agent?refresh=1']);
		expect(modelReads()).toBe(2);
	});

	test('a first load the server never answers shows the page offline with no server reason', async () => {
		server.models = 'down';

		await useSettings.getState().load();

		expect(useSettings.getState()).toMatchObject({ status: 'offline', error: null, models: null });
	});

	test('a first load the server refuses keeps its reason', async () => {
		server.models = 'Could not read review-config.json.';

		await useSettings.getState().load();

		expect(useSettings.getState()).toMatchObject({ status: 'offline', error: 'Could not read review-config.json.' });
	});

	test('a refresh that fails keeps the settings on screen', async () => {
		await useSettings.getState().load();
		server.models = 'down';

		await useSettings.getState().load(true);

		expect(useSettings.getState().status).toBe('ready');
		expect(useSettings.getState().models?.subagentCap).toBe(2);
	});

	test('a check again that fails keeps the agents and providers on screen beside its reason', async () => {
		await useSettings.getState().load();
		server.agentCheck = 'OpenCode did not answer within 10s.';

		await useSettings.getState().load(true);

		expect(useSettings.getState()).toMatchObject({
			agents: [openCode],
			providers: [anthropic],
			agentError: 'OpenCode did not answer within 10s.'
		});
	});

	test('a save made while a load is in flight lands after it, so the load cannot undo it', async () => {
		let release = () => {};

		server.hold = new Promise((resolve) => (release = resolve));

		const load = useSettings.getState().load();
		const save = useSettings.getState().saveModels({ subagentCap: 4 });

		release();
		await Promise.all([load, save]);

		expect(useSettings.getState().models?.subagentCap).toBe(4);
	});

	test('a save the server refuses rejects and keeps the last saved settings', async () => {
		await useSettings.getState().load();
		Object.assign(globalThis, { fetch: async () => json({ error: 'Could not write review-config.json.' }, 500) });

		await expect(useSettings.getState().saveModels({ subagentCap: 4 })).rejects.toThrow(
			'Could not write review-config.json.'
		);

		expect(useSettings.getState().models?.subagentCap).toBe(2);
	});
});
