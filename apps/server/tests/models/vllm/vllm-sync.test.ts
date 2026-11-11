import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vllmModelId } from '@recoder/shared';
import { ModelConfigError, configForOrchestrator } from '../../../src/models/models';
import { vllmEntries } from '../../../src/models/vllm/vllm-models';
import {
	getVllmServer,
	initVllmServers,
	listVllmServers,
	removeVllmServer,
	toVllmServer
} from '../../../src/models/vllm/vllm-store';
import { connectVllm, mergeServed, syncVllmServer } from '../../../src/models/vllm/vllm-sync';
import { getStoredSettings, setReviewOverrides } from '../../../src/review/session/review-settings';
import { fakeVllm } from '../../helpers/fake-vllm';

const QWEN = 'Qwen/Qwen3-Coder-30B-A3B-Instruct';
const LLAMA = 'meta-llama/Llama-3.3-70B-Instruct';
const dataDir = process.env.RECODER_DATA_DIR;

let vllm: ReturnType<typeof fakeVllm>;

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-vllm-'));
	initVllmServers();
	setReviewOverrides({});

	vllm = fakeVllm([
		{ id: QWEN, len: 131072 },
		{ id: LLAMA, len: 32768 }
	]);
});

afterEach(() => {
	vllm.restore();
	process.env.RECODER_DATA_DIR = dataDir;
	initVllmServers();
	setReviewOverrides({});
});

/** The connected server's id after connecting `vllm.test:8000`. */
async function connect(key?: string): Promise<string> {
	return (await connectVllm('vllm.test:8000', key)).id;
}

describe('connecting a vLLM server', () => {
	test('adds /v1, takes each model with its max_model_len, and calls it by the id the server lists', async () => {
		const id = await connect('sk-secret-1234');
		const server = getVllmServer(id)!;

		expect(server.baseUrl).toBe('http://vllm.test:8000/v1');

		expect(server.models).toEqual([
			{ id: QWEN, contextWindow: 131072, served: true },
			{ id: LLAMA, contextWindow: 32768, served: true }
		]);

		expect(getStoredSettings().orchestratorModelId).toBe(vllmModelId(id, QWEN));

		expect(configForOrchestrator()).toMatchObject({
			baseUrl: 'http://vllm.test:8000/v1',
			apiKey: 'sk-secret-1234',
			model: QWEN
		});

		const shown = JSON.stringify([toVllmServer(server), vllmEntries()]);

		expect(shown).toContain('••••1234');
		expect(shown).not.toContain('sk-secret');
	});

	test('connecting the same address again with no key keeps the saved key', async () => {
		vllm.state.key = 'sk-secret-1234';

		const id = await connect('sk-secret-1234');

		await connect();
		expect(getVllmServer(id)?.apiKey).toBe('sk-secret-1234');
		expect(listVllmServers()).toHaveLength(1);
	});

	test('an address that is not a URL, a rejected key and an empty list are refused with a reason', async () => {
		await expect(connectVllm('http://', undefined)).rejects.toMatchObject({ status: 400 });

		vllm.state.key = 'right';
		await expect(connectVllm('vllm.test:8000', 'wrong')).rejects.toMatchObject({ status: 502 });

		vllm.state.key = null;
		vllm.state.models = [];
		await expect(connectVllm('vllm.test:8000', undefined)).rejects.toMatchObject({ status: 422 });
		expect(listVllmServers()).toHaveLength(0);
	});
});

describe('keeping the list in step', () => {
	test('a sync adds new models and drops ones the server stopped serving', async () => {
		const id = await connect();

		vllm.state.models = [{ id: QWEN, len: 65536 }, { id: 'new/model' }];
		await syncVllmServer(id);

		expect(getVllmServer(id)?.models).toEqual([
			{ id: QWEN, contextWindow: 65536, served: true },
			{ id: 'new/model', contextWindow: null, served: true }
		]);
	});

	test('a model still picked for a review stays, marked missing, and the review stops with a message', async () => {
		const id = await connect();

		setReviewOverrides({ orchestratorModelId: vllmModelId(id, LLAMA) });
		vllm.state.models = [{ id: QWEN, len: 131072 }];
		await syncVllmServer(id);

		expect(getVllmServer(id)?.models.find((model) => model.id === LLAMA)).toMatchObject({ served: false });
		expect(vllmEntries().find((entry) => entry.model === LLAMA)).toMatchObject({ unavailable: true });
		expect(() => configForOrchestrator()).toThrow(ModelConfigError);
		expect(() => configForOrchestrator()).toThrow(/no longer served/);
	});

	test('a failed sync keeps the last good list and says why; the next good one clears it', async () => {
		const id = await connect();
		const syncedAt = getVllmServer(id)!.syncedAt;

		vllm.state.down = true;
		await syncVllmServer(id);

		expect(getVllmServer(id)).toMatchObject({ syncedAt, error: expect.stringContaining('vllm.test:8000') });
		expect(getVllmServer(id)?.models).toHaveLength(2);

		vllm.state.down = false;
		vllm.state.models = [];
		await syncVllmServer(id);

		expect(getVllmServer(id)?.error).toContain('no models');
		expect(getVllmServer(id)?.models).toHaveLength(2);

		vllm.state.models = [{ id: QWEN }];
		await syncVllmServer(id);

		expect(getVllmServer(id)).toMatchObject({ error: null, models: [{ id: QWEN }] });
	});

	test('a server disconnected while a sync is in flight stays disconnected', async () => {
		const id = await connect();

		vllm.hold();

		const sync = syncVllmServer(id);

		removeVllmServer(id);
		vllm.release();
		await sync;

		expect(listVllmServers()).toHaveLength(0);
	});

	test('the servers and their models survive a restart', async () => {
		const id = await connect('sk-secret-1234');
		const saved = process.env.RECODER_DATA_DIR;

		process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-vllm-empty-'));
		initVllmServers();
		expect(listVllmServers()).toHaveLength(0);

		process.env.RECODER_DATA_DIR = saved;
		initVllmServers();

		expect(getVllmServer(id)).toMatchObject({ apiKey: 'sk-secret-1234', models: [{ id: QWEN }, { id: LLAMA }] });
	});
});

describe('mergeServed', () => {
	test('lists what is served in the server’s order and keeps only picked models that went missing', () => {
		const previous = [
			{ id: 'a', contextWindow: 10, served: true },
			{ id: 'b', contextWindow: 20, served: true },
			{ id: 'c', contextWindow: 30, served: true }
		];

		const merged = mergeServed(
			previous,
			[
				{ id: 'z', contextWindow: null, ownedBy: null },
				{ id: 'a', contextWindow: 11, ownedBy: null }
			],
			new Set(['b'])
		);

		expect(merged).toEqual([
			{ id: 'z', contextWindow: null, served: true },
			{ id: 'a', contextWindow: 11, served: true },
			{ id: 'b', contextWindow: 20, served: false }
		]);
	});
});
