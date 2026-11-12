import { beforeEach, describe, expect, test } from 'bun:test';
import type { AgentProvider, AgentStatus, ModelEntry, ModelSettings } from '@recoder/shared';

import { checkAgain, retryProviders, useSettings } from '../../src/lib/settings/settings-store';

/** What the fake review server answers; each test changes it. */
interface Server {
	/** The settings with the whole catalog; `?catalog=0` answers them with only the picked model. */
	settings: ModelSettings;
	agents: AgentStatus[];
	/** A string answers the agent check with a 500 and that error. */
	agentCheck: 'ok' | string;
	/** A string answers the provider list with a 500 and that error. */
	providers: 'ok' | string;
	/** The provider list it answers with. */
	providerList: AgentProvider[];
	/** `down` throws as if nothing listens; a string answers 500 with that error. */
	models: 'ok' | 'down' | string;
	/** While set, GET /api/settings/models waits for it, so a test can hold a load in flight. */
	hold: Promise<void> | null;
	/** While set, GET /api/agent waits for it, as a slow agent check would. */
	agentHold: Promise<void> | null;
	/** Each request as `METHOD /path?query`, in the order they arrived. */
	calls: string[];
}

let server: Server;

const entry = (id: string): ModelEntry => ({ id, label: id, model: id, baseUrl: null, apiKeyPreview: null });

const [picked, other] = [entry('opencode:a/picked'), entry('opencode:a/other')];

function settings(subagentCap: ModelSettings['subagentCap']): ModelSettings {
	return {
		configured: true,
		baseUrl: '',
		model: '',
		apiKeyPreview: null,
		sharedModelId: null,
		orchestratorModelId: picked.id,
		models: [picked, other],
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

/** The settings as `?catalog=0` answers them: only the picked model's entry. */
const picks = (url: URL): ModelSettings =>
	url.searchParams.get('catalog') === '0' ? { ...server.settings, models: [picked] } : server.settings;

/** The review server's answer to one request. */
async function answer(url: URL, init?: RequestInit): Promise<Response> {
	const method = init?.method ?? 'GET';

	server.calls.push(`${method} ${url.pathname}${url.search}`);

	if (url.pathname === '/api/agent') {
		await server.agentHold;

		return server.agentCheck === 'ok' ? json({ agents: server.agents }) : json({ error: server.agentCheck }, 500);
	}

	if (url.pathname === '/api/agent/providers') {
		return server.providers === 'ok'
			? json({ providers: server.providerList })
			: json({ error: server.providers }, 500);
	}

	if (url.pathname === '/api/settings/models' && method === 'PUT') {
		const patch = JSON.parse(String(init?.body)) as Partial<ModelSettings>;

		server.settings = { ...server.settings, ...patch };

		return json(picks(url));
	}

	if (url.pathname === '/api/settings/models') {
		await server.hold;

		if (server.models === 'down') throw new TypeError('Failed to fetch');
		if (server.models !== 'ok') return json({ error: server.models }, 500);

		return json(picks(url));
	}

	return json({ error: 'not found' }, 404);
}

const modelReads = () => server.calls.filter((call) => call === 'GET /api/settings/models').length;

beforeEach(() => {
	server = {
		settings: settings(2),
		agents: [openCode],
		agentCheck: 'ok',
		providers: 'ok',
		providerList: [anthropic],
		models: 'ok',
		hold: null,
		agentHold: null,
		calls: []
	};

	Object.assign(globalThis, {
		fetch: (input: string | URL, init?: RequestInit) => answer(new URL(String(input)), init)
	});

	useSettings.setState({
		status: 'idle',
		settings: null,
		error: null,
		catalogStatus: 'idle',
		models: null,
		catalogError: null,
		agentsStatus: 'idle',
		agents: [],
		providers: [],
		agentError: null,
		providersError: null
	});
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

	test('a slow agent check does not hold back the models', async () => {
		let release = () => {};

		server.agentHold = new Promise((resolve) => (release = resolve));

		const load = useSettings.getState().load();

		await useSettings.getState().loadCatalog();

		expect(useSettings.getState()).toMatchObject({ status: 'ready', agentsStatus: 'loading' });

		release();
		await load;

		expect(useSettings.getState()).toMatchObject({ agentsStatus: 'ready', providers: [anthropic] });
	});

	test('the settings load alone, without the catalog or the agent check, for the Settings sections', async () => {
		await useSettings.getState().loadSettings();
		await useSettings.getState().loadSettings();

		expect(server.calls).toEqual(['GET /api/settings/models?catalog=0']);
		expect(useSettings.getState()).toMatchObject({ status: 'ready', models: null, catalogStatus: 'idle' });
		expect(useSettings.getState().settings?.models).toEqual([picked]);
	});

	test('a refresh before any picker opened rereads the settings without the catalog', async () => {
		await useSettings.getState().loadSettings();
		server.calls = [];

		await useSettings.getState().load(true);

		expect(server.calls.at(-1)).toBe('GET /api/settings/models?catalog=0');
	});

	test('a save keeps the catalog a picker loaded, and the server sends none back', async () => {
		await useSettings.getState().loadCatalog();
		await useSettings.getState().saveModels({ subagentCap: 4 });

		const state = useSettings.getState();

		expect(server.calls.at(-1)).toBe('PUT /api/settings/models?catalog=0');
		expect(state.models?.models).toEqual([picked, other]);
		expect(state.settings).toBe(state.models);
		expect(state.settings?.subagentCap).toBe(4);
	});

	test('a first agent check that fails turns only the agents offline', async () => {
		server.agentCheck = 'OpenCode did not answer within 10s.';

		await useSettings.getState().load();

		expect(useSettings.getState()).toMatchObject({
			status: 'ready',
			agentsStatus: 'offline',
			agentError: 'OpenCode did not answer within 10s.'
		});
	});

	test('a provider list that fails is its own failure, and its retry reads the providers alone', async () => {
		server.providers = 'OpenCode lost its config.';

		await useSettings.getState().load();

		expect(useSettings.getState()).toMatchObject({
			agentsStatus: 'ready',
			agentError: null,
			providers: [],
			providersError: 'OpenCode lost its config.'
		});

		server.providers = 'ok';
		server.calls = [];

		await retryProviders();

		expect(server.calls).toEqual(['GET /api/agent/providers']);
		expect(useSettings.getState()).toMatchObject({ providers: [anthropic], providersError: null });
	});

	test('a provider list that fails keeps the row count the next load sizes its skeleton by', async () => {
		const written: string[] = [];

		Object.assign(globalThis, {
			localStorage: { getItem: () => null, setItem: (_key: string, value: string) => written.push(value) }
		});

		try {
			server.providerList = [anthropic, { ...anthropic, id: 'openai', name: 'OpenAI' }];
			await useSettings.getState().load();

			useSettings.setState({ agentsStatus: 'idle', agents: [], providers: [], providersError: null });
			server.providers = 'OpenCode lost its config.';
			await useSettings.getState().loadAgents();

			expect(useSettings.getState().providersError).toBe('OpenCode lost its config.');
			expect(JSON.parse(written.at(-1) ?? '{}')).toMatchObject({ providers: 2 });
		} finally {
			Reflect.deleteProperty(globalThis, 'localStorage');
		}
	});

	test('a provider list answered with no list fails on its own, without breaking the agent check', async () => {
		const quiet = console.warn;

		console.warn = () => {};

		Object.assign(globalThis, {
			fetch: (input: string | URL, init?: RequestInit) => {
				const url = new URL(String(input));

				return url.pathname === '/api/agent/providers' ? json(null) : answer(url, init);
			}
		});

		try {
			await useSettings.getState().load();
		} finally {
			console.warn = quiet;
		}

		expect(useSettings.getState()).toMatchObject({
			agentsStatus: 'ready',
			agentError: null,
			providers: [],
			providersError: 'The server’s answer wasn’t readable.'
		});
	});

	test('a refresh reads the models only after the agent check, which makes the server list them afresh', async () => {
		await useSettings.getState().load();
		server.calls = [];

		await useSettings.getState().load(true);

		expect(server.calls).toEqual(['GET /api/agent?refresh=1', 'GET /api/agent/providers', 'GET /api/settings/models']);
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

	test('check again rejects when only the provider list fails, keeping the last good list beside the reason', async () => {
		await useSettings.getState().load();
		server.providers = 'OpenCode lost its config.';

		await expect(checkAgain()).rejects.toThrow('OpenCode lost its config.');

		expect(useSettings.getState()).toMatchObject({
			agentError: null,
			providers: [anthropic],
			providersError: 'OpenCode lost its config.'
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

	test('a save answered with the wrong shape rejects and keeps the last saved settings', async () => {
		await useSettings.getState().load();
		Object.assign(globalThis, { fetch: async () => json({}) });

		await expect(useSettings.getState().saveModels({ subagentCap: 4 })).rejects.toBeInstanceOf(SyntaxError);

		expect(useSettings.getState().settings?.limits.maxFiles).toBe(20);
		expect(useSettings.getState().models?.subagentCap).toBe(2);
	});
});
