import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serverDataDir } from '../../../src/util/data-dir';
import { deleteChatGptTokens } from '../../../src/review/session/chatgpt-migration';
import { getStoredSettings, initReviewSettings, setReviewOverrides } from '../../../src/review/session/review-settings';
import { isolateSettings } from '../../helpers/settings-env';

isolateSettings();

const CHATGPT_SOL = { provider: 'codex', id: 'chatgpt-sol', label: 'GPT-6-Sol', model: 'gpt-6-sol', efforts: ['low'] };
const CHATGPT_LUNA = { provider: 'codex', id: 'chatgpt-luna', label: 'GPT-6-Luna', model: 'gpt-6-luna' };
const LOCAL_ENTRY = { id: 'local', label: 'Local', model: 'qwen', baseUrl: 'http://localhost:8000/v1' };

/** An install from before the Codex CLI: a ChatGPT model picked twice, a local model picked once, and saved tokens. */
function writeChatGptInstall(dataDir: string): void {
	const settings = {
		models: [CHATGPT_SOL, LOCAL_ENTRY],
		orchestratorModelId: 'chatgpt-sol',
		specialistModelId: 'chatgpt-sol',
		sharedModelId: 'local'
	};

	writeFileSync(join(dataDir, 'review-config.json'), JSON.stringify(settings));
	writeFileSync(join(dataDir, 'chatgpt-auth.json'), '{"access_token":"t"}');
	mkdirSync(join(dataDir, 'codex'));
	writeFileSync(join(dataDir, 'codex', 'auth.json'), '{"tokens":{}}');
}

/** What the server does with settings and tokens when it starts. */
async function startServer(dataDir: string): Promise<void> {
	setReviewOverrides({});
	await deleteChatGptTokens(dataDir);
	initReviewSettings();
}

test('starting an install with a ChatGPT pick moves the pick to the Codex CLI and deletes the saved tokens', async () => {
	const dataDir = serverDataDir();

	writeChatGptInstall(dataDir);

	await startServer(dataDir);

	const saved = JSON.parse(readFileSync(join(dataDir, 'review-config.json'), 'utf8'));

	expect(getStoredSettings()).toMatchObject({
		orchestratorModelId: 'codex:gpt-6-sol',
		specialistModelId: 'codex:gpt-6-sol',
		sharedModelId: 'local'
	});

	expect(saved.orchestratorModelId).toBe('codex:gpt-6-sol');
	expect(saved.models.map((entry: { id: string }) => entry.id)).toEqual(['local']);
	expect(existsSync(join(dataDir, 'chatgpt-auth.json'))).toBe(false);
	expect(existsSync(join(dataDir, 'codex', 'auth.json'))).toBe(false);
});

test('a second start after the move changes nothing', async () => {
	const dataDir = serverDataDir();

	writeChatGptInstall(dataDir);
	await startServer(dataDir);

	const afterFirst = readFileSync(join(dataDir, 'review-config.json'), 'utf8');
	const settingsAfterFirst = getStoredSettings();

	await startServer(dataDir);

	expect(readFileSync(join(dataDir, 'review-config.json'), 'utf8')).toBe(afterFirst);
	expect(getStoredSettings()).toEqual(settingsAfterFirst);
});

test('a saved verifier pick of a ChatGPT entry moves to the same model through the Codex CLI', async () => {
	const dataDir = serverDataDir();

	const settings = {
		models: [CHATGPT_SOL, CHATGPT_LUNA, LOCAL_ENTRY],
		orchestratorModelId: 'local',
		verifierModelId: 'chatgpt-luna',
		verifierEffort: 'high'
	};

	writeFileSync(join(dataDir, 'review-config.json'), JSON.stringify(settings));

	await startServer(dataDir);

	expect(getStoredSettings()).toMatchObject({ verifierModelId: 'codex:gpt-6-luna', verifierEffort: 'high' });
});
