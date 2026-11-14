import { afterEach, expect, setSystemTime, spyOn, test } from 'bun:test';
import { AGENT_CLIS, type AgentStatus, type ModelEntry } from '@recoder/shared';
import { claudeCode } from '../../src/agents/claude-code/claude-code';
import { copilot } from '../../src/agents/copilot/copilot';
import { devin } from '../../src/agents/devin/devin';
import { opencode } from '../../src/agents/opencode/opencode';
import {
	agentModels,
	agentStatuses,
	forgetAgentModels,
	pickedModels,
	registeredAgents
} from '../../src/agents/registry';
import { clearAllCaches } from '../../src/util/ttl-cache';
import { join } from 'node:path';

const entry: ModelEntry = { id: 'devin:swe', label: 'SWE', model: 'swe', baseUrl: null, apiKeySet: false };

/** A status for an agent that is installed, runs and is signed in. */
function ready(id: string): AgentStatus {
	return {
		id,
		name: id,
		installed: true,
		version: '1.0.0',
		path: `/bin/${id}`,
		error: null,
		install: '',
		signedIn: true,
		login: null,
		providers: false,
		config: null,
		setup: { install: false, signIn: false }
	};
}

/** OpenCode, Claude Code and Copilot look ready and list nothing, so only Devin, with `status`, is under test. */
function quietAgents(status = ready('devin')) {
	return [
		spyOn(opencode, 'detect').mockResolvedValue(ready('opencode')),
		spyOn(claudeCode, 'detect').mockResolvedValue(ready('claude-code')),
		spyOn(copilot, 'detect').mockResolvedValue(ready('copilot')),
		spyOn(devin, 'detect').mockResolvedValue(status),
		spyOn(opencode, 'models').mockResolvedValue([]),
		spyOn(claudeCode, 'models').mockResolvedValue([]),
		spyOn(copilot, 'models').mockResolvedValue([])
	];
}

const devinStatus = async () => (await agentStatuses()).find((status) => status.id === 'devin')!;

let restore: { mockRestore(): void }[] = [];

afterEach(() => {
	for (const mock of restore) mock.mockRestore();
	restore = [];
	setSystemTime();
	forgetAgentModels();
});

/** Devin's first listing fails and later ones list `entry`; the other agents are quiet. */
function devinFailsOnce() {
	const listing = spyOn(devin, 'models')
		.mockRejectedValueOnce(new Error('devin restarting'))
		.mockResolvedValue([entry]);

	restore = [...quietAgents(), listing];
	forgetAgentModels();

	return listing;
}

/** A listing that settles only when `finish` is called. */
function slowListing() {
	let finish = (_entries: ModelEntry[]) => {};
	const slow = new Promise<ModelEntry[]>((resolve) => (finish = resolve));

	return { slow, finish };
}

/** Devin lists through a slow listing; the other agents are quiet. */
function slowDevin() {
	const { slow, finish } = slowListing();
	const listing = spyOn(devin, 'models').mockImplementation(() => slow);

	restore = [...quietAgents(), listing];
	forgetAgentModels();

	return { listing, slow, finish };
}

test('a failed model listing is kept for seconds, not a minute', async () => {
	const start = Date.now();

	const listing = devinFailsOnce();

	expect(await agentModels()).toEqual([]);

	setSystemTime(new Date(start + 2_000));
	expect(await agentModels()).toEqual([]);
	expect(listing).toHaveBeenCalledTimes(1);

	setSystemTime(new Date(start + 10_000));
	expect(await agentModels()).toEqual([{ ...entry, agent: 'Devin' }]);
});

test('an agent whose models could not be listed reads as unable to run', async () => {
	devinFailsOnce();
	await agentModels();

	expect((await devinStatus()).error).not.toBeNull();
});

test('the status read after an unlisted agent came back reads it as ready', async () => {
	const start = Date.now();

	const listing = devinFailsOnce();

	await agentModels();

	setSystemTime(new Date(start + 10_000));
	expect((await devinStatus()).error).toBeNull();
	expect(listing).toHaveBeenCalledTimes(2);
});

test('a status read does not wait on a listing of an unlisted agent that is still running', async () => {
	const start = Date.now();
	const { slow, finish } = slowListing();

	const listing = devinFailsOnce();

	await agentModels();
	listing.mockImplementation(() => slow);

	setSystemTime(new Date(start + 10_000));
	void agentModels();

	const asked = performance.now();

	expect((await devinStatus()).error).not.toBeNull();
	expect(performance.now() - asked).toBeLessThan(1_000);
	expect(listing).toHaveBeenCalledTimes(2);

	finish([entry]);
});

test('a check lists the models afresh, so it reports an agent whose listing broke since the last list', async () => {
	const listing = spyOn(devin, 'models').mockResolvedValueOnce([entry]).mockRejectedValue(new Error('devin down'));

	restore = [...quietAgents(), listing];
	forgetAgentModels();
	await agentModels();

	expect((await devinStatus()).error).toBeNull();

	const checked = (await agentStatuses(true)).find((status) => status.id === 'devin')!;

	expect(checked.error).not.toBeNull();
	expect(listing).toHaveBeenCalledTimes(2);
});

test('a signed-out agent keeps its signed-out state when its models cannot be listed', async () => {
	restore = [
		...quietAgents({ ...ready('devin'), signedIn: false }),
		spyOn(devin, 'models').mockRejectedValue(new Error('not signed in'))
	];

	forgetAgentModels();
	await agentModels();

	expect(await devinStatus()).toMatchObject({ signedIn: false, error: null });
});

test('a bounded read does not wait out an agent’s slow first listing', async () => {
	const { finish } = slowDevin();

	expect(await pickedModels([entry.id], 20)).toEqual([]);

	finish([entry]);
});

test('a listing that a bounded read stopped waiting on still fills the cache', async () => {
	const { listing, slow, finish } = slowDevin();

	await pickedModels([entry.id], 20);
	finish([entry]);
	await slow;

	expect(await pickedModels([entry.id], 20)).toEqual([{ ...entry, agent: 'Devin' }]);
	expect(listing).toHaveBeenCalledTimes(1);
});

test('a bounded read after the caches were cleared answers with the models the agent listed last', async () => {
	const { listing, finish } = slowDevin();

	listing.mockResolvedValueOnce([entry]);
	await agentModels();
	clearAllCaches();

	expect(await pickedModels([entry.id], 20)).toEqual([{ ...entry, agent: 'Devin' }]);
	expect(listing).toHaveBeenCalledTimes(2);

	finish([entry]);
});

test('every registered adapter has its entry in the shared agent table, under the same name, and no entry lacks one', () => {
	const registered = registeredAgents().map(({ id, name }) => ({ id, name }));

	expect(registered).toEqual(AGENT_CLIS.map(({ id, name }) => ({ id, name })));
});

test('the agent list Settings shows has every agent CLI of the shared table', async () => {
	restore = quietAgents();

	const listed = (await agentStatuses()).map((status) => status.id);

	expect(listed).toEqual(AGENT_CLIS.map((cli) => cli.id));
});

test('the registry loads when an adapter is the first module of the server to load', () => {
	const source = join(import.meta.dir, '../../src');
	const adapterFirst = `await import(${JSON.stringify(join(source, 'agents/opencode/opencode'))}); await import(${JSON.stringify(join(source, 'agents/registry'))});`;
	const loaded = Bun.spawnSync([process.execPath, '-e', adapterFirst], { env: process.env, stderr: 'pipe' });

	expect(loaded.stderr.toString()).toBe('');
	expect(loaded.exitCode).toBe(0);
});
