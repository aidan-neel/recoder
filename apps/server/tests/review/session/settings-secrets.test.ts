import { afterEach, beforeEach, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SealedValueError } from '../../../src/secrets/seal';
import {
	getStoredSettings,
	initReviewSettings,
	saveReviewSettings,
	setConnection,
	setReviewOverrides
} from '../../../src/review/session/review-settings';
import { filesHolding } from '../../helpers/disk-secrets';

const savedEnv = { dataDir: process.env.RECODER_DATA_DIR, key: process.env.RECODER_SECRET_KEY };

let settingsFile: string;

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-settings-secrets-'));
	settingsFile = join(process.env.RECODER_DATA_DIR, 'review-config.json');
	setReviewOverrides({});
});

afterEach(() => {
	process.env.RECODER_DATA_DIR = savedEnv.dataDir;

	if (savedEnv.key === undefined) delete process.env.RECODER_SECRET_KEY;
	else process.env.RECODER_SECRET_KEY = savedEnv.key;

	setReviewOverrides({});
});

test('keys saved before sealing are sealed on disk at start and still work', () => {
	writeFileSync(
		settingsFile,
		JSON.stringify({
			apiKey: 'sk-plain-endpoint',
			connections: { openrouter: { apiKey: 'sk-or-plain-provider' } },
			models: [{ id: 'm1', label: 'Mine', model: 'gpt', baseUrl: 'http://x/v1', apiKey: 'sk-plain-model' }]
		})
	);

	initReviewSettings();

	const raw = readFileSync(settingsFile, 'utf8');

	for (const secret of ['sk-plain-endpoint', 'sk-or-plain-provider', 'sk-plain-model'])
		expect(raw).not.toContain(secret);

	expect(JSON.parse(raw).apiKey).toStartWith('enc:v1:');
	expect(JSON.parse(raw).connections.openrouter.apiKey).toStartWith('enc:v1:');
	expect(JSON.parse(raw).models[0].apiKey).toStartWith('enc:v1:');

	expect(getStoredSettings()).toMatchObject({
		apiKey: 'sk-plain-endpoint',
		connections: { openrouter: { apiKey: 'sk-or-plain-provider' } },
		models: [{ id: 'm1', apiKey: 'sk-plain-model' }]
	});
});

test('keys saved from the settings are not in any file, and they survive a restart', () => {
	setConnection('opencode-go', 'sk-go-live-key');
	saveReviewSettings({ apiKey: 'sk-endpoint-live-key' });

	expect(filesHolding(process.env.RECODER_DATA_DIR!, 'sk-go-live-key')).toEqual([]);
	expect(filesHolding(process.env.RECODER_DATA_DIR!, 'sk-endpoint-live-key')).toEqual([]);

	setReviewOverrides({});
	initReviewSettings();

	expect(getStoredSettings()).toMatchObject({
		apiKey: 'sk-endpoint-live-key',
		connections: { 'opencode-go': { apiKey: 'sk-go-live-key' } }
	});
});

test('keys that cannot be opened stop the start and are not overwritten', () => {
	process.env.RECODER_SECRET_KEY = randomBytes(32).toString('base64');
	setConnection('opencode-go', 'sk-go-live-key');

	const sealedFile = readFileSync(settingsFile, 'utf8');

	process.env.RECODER_SECRET_KEY = randomBytes(32).toString('base64');
	setReviewOverrides({});

	expect(() => initReviewSettings()).toThrow(SealedValueError);
	expect(readFileSync(settingsFile, 'utf8')).toBe(sealedFile);
});
