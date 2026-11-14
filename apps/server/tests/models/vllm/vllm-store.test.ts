import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	getVllmServer,
	initVllmServers,
	putVllmServer,
	type StoredVllmServer
} from '../../../src/models/vllm/vllm-store';
import { filesHolding } from '../../helpers/disk-secrets';

const originalDataDir = process.env.RECODER_DATA_DIR;

const server: StoredVllmServer = {
	id: 'v1234abcd',
	baseUrl: 'http://vllm.test:8000/v1',
	apiKey: 'sk-vllm-live-key',
	syncedAt: null,
	error: null,
	models: []
};

let serversFile: string;

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-vllm-secrets-'));
	serversFile = join(process.env.RECODER_DATA_DIR, 'vllm-servers.json');
	initVllmServers();
});

afterEach(() => {
	process.env.RECODER_DATA_DIR = originalDataDir;
	initVllmServers();
});

test('a server key saved before sealing is sealed on disk at start and still works', () => {
	writeFileSync(serversFile, JSON.stringify([server]));

	initVllmServers();

	const raw = readFileSync(serversFile, 'utf8');

	expect(raw).not.toContain('sk-vllm-live-key');
	expect(JSON.parse(raw)[0].apiKey).toStartWith('enc:v1:');
	expect(getVllmServer(server.id)?.apiKey).toBe('sk-vllm-live-key');
});

test('a saved server key is in no file, and survives a restart', () => {
	putVllmServer(server);

	expect(filesHolding(process.env.RECODER_DATA_DIR!, 'sk-vllm-live-key')).toEqual([]);

	initVllmServers();
	expect(getVllmServer(server.id)?.apiKey).toBe('sk-vllm-live-key');
});
