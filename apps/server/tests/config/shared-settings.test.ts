import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	initializeSharedSettings,
	readSharedSetting,
	SharedSettingsConflictError,
	withSharedSettings,
	withSharedSettingsTransaction,
	writeSharedSetting
} from '../../src/config/shared-settings';
import { getGitlabHost, setGitlabHost } from '../../src/forge/gitlab-host';
import { clearToken, getToken, setToken } from '../../src/forge/tokens';
import { readWatchState, writeWatchState } from '../../src/forge/watch/cursor';
import { readAutoReviewSettings, saveAutoReviewSettings } from '../../src/forge/watch/settings';
import { getVllmServer, listVllmServers, putVllmServer } from '../../src/models/vllm/vllm-store';
import {
	clearGlobalGuidelines,
	readGlobalGuidelines,
	writeGlobalGuidelines
} from '../../src/review/guidelines/guidelines';
import { listDismissals, recordDismissal } from '../../src/review/guidelines/learned/dismissals';
import { recordVote, topicTallies } from '../../src/review/guidelines/learned/votes';
import { getStoredSettings, saveReviewSettings, setReviewOverrides } from '../../src/review/session/review-settings';

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
	test.skip('shared settings integration requires TEST_DATABASE_URL', () => {});
} else {
	const admin = new SQL(databaseUrl);
	const originalDataDir = process.env.RECODER_DATA_DIR;
	const originalSettings = getStoredSettings();
	let schema: string;
	let dataDir: string;
	let first: SQL;
	let second: SQL;

	beforeAll(async () => {
		await admin`SELECT 1`;
	});

	beforeEach(async () => {
		schema = `settings_${crypto.randomUUID().replaceAll('-', '')}`;
		dataDir = mkdtempSync(join(tmpdir(), 'recoder-shared-settings-'));
		process.env.RECODER_DATA_DIR = dataDir;
		writeFileSync(join(dataDir, 'tokens.json'), '{"github":"local-only"}', { mode: 0o600 });
		setReviewOverrides({ baseUrl: 'http://local-only.invalid/v1' });
		await admin.unsafe(`CREATE SCHEMA "${schema}"`);
		first = new SQL(databaseUrl, { connection: { search_path: schema } });
		second = new SQL(databaseUrl, { connection: { search_path: schema } });
		await initializeSharedSettings(first);
	});

	afterEach(async () => {
		await Promise.all([first.close(), second.close()]);
		await admin.unsafe(`DROP SCHEMA "${schema}" CASCADE`);
		if (originalDataDir === undefined) delete process.env.RECODER_DATA_DIR;
		else process.env.RECODER_DATA_DIR = originalDataDir;
		setReviewOverrides(originalSettings);
	});

	afterAll(async () => {
		await admin.close();
	});

	test('independent replicas share every settings domain without reading or changing local files', async () => {
		const localServers = structuredClone(listVllmServers());

		await withSharedSettings(first, () => {
			expect(getToken('github')).toBeUndefined();
			expect(getStoredSettings()).toEqual({});
			setToken('github', 'shared-github');
			setToken('gitlab', 'shared-gitlab');
			setGitlabHost('gitlab.example.org');
			saveReviewSettings({ baseUrl: 'https://models.example.org/v1', maxFiles: 5 });
			putVllmServer({ id: 'v1', baseUrl: 'https://models.example.org/v1', syncedAt: null, error: null, models: [] });
			writeGlobalGuidelines('Check transaction boundaries');
			saveAutoReviewSettings({ enabled: true });
			writeWatchState({ repos: { repo: { checkedAt: 'now', pulls: {} } }, recent: [] });

			recordDismissal({
				repoId: 'repo',
				fingerprint: 'finding',
				file: 'a.ts',
				category: 'correctness',
				title: 'Expected',
				dismissedAt: 'now'
			});

			recordVote('repo', { findingKey: 'finding', topic: 'category:correctness', choice: 'dismissed', votedAt: 'now' });
		});

		await withSharedSettings(second, () => {
			expect(getToken('github')).toBe('shared-github');
			expect(getToken('gitlab')).toBe('shared-gitlab');
			expect(getGitlabHost()).toBe('gitlab.example.org');
			expect(getStoredSettings()).toMatchObject({ baseUrl: 'https://models.example.org/v1', maxFiles: 5 });
			expect(getVllmServer('v1')?.baseUrl).toBe('https://models.example.org/v1');
			expect(readGlobalGuidelines().content).toBe('Check transaction boundaries\n');
			expect(readAutoReviewSettings().enabled).toBe(true);
			expect(readWatchState().repos.repo.checkedAt).toBe('now');
			expect(listDismissals('repo')[0]?.fingerprint).toBe('finding');
			expect(topicTallies('repo').get('category:correctness')).toEqual({ useful: 0, dismissed: 1 });
			clearToken('github');
		});

		await withSharedSettings(first, () => {
			expect(getToken('github')).toBeUndefined();
			expect(getToken('gitlab')).toBe('shared-gitlab');
			setToken('github', '');
			expect(getToken('github')).toBeUndefined();
		});

		expect(getToken('github')).toBe('local-only');
		expect(getStoredSettings()).toEqual({ baseUrl: 'http://local-only.invalid/v1' });
		expect(listVllmServers()).toEqual(localServers);
		expect(readdirSync(dataDir)).toEqual(['tokens.json']);
		expect(readFileSync(join(dataDir, 'tokens.json'), 'utf8')).toBe('{"github":"local-only"}');
	});

	test('a stale settings edit fails and rolls back changes to other documents', async () => {
		await withSharedSettings(first, () => setToken('github', 'initial'));

		const ready = Promise.withResolvers<void>();
		const proceed = Promise.withResolvers<void>();

		const stale = withSharedSettings(first, async () => {
			setToken('github', 'stale');
			writeGlobalGuidelines('This must roll back');
			ready.resolve();
			await proceed.promise;
		});

		await ready.promise;
		await withSharedSettings(second, () => setToken('github', 'winner'));
		proceed.resolve();
		await expect(stale).rejects.toBeInstanceOf(SharedSettingsConflictError);

		await withSharedSettings(second, () => {
			expect(getToken('github')).toBe('winner');
			expect(readSharedSetting('global-guidelines')).toBeUndefined();
		});
	});

	test('clearing a document retains its version and refuses an earlier edit', async () => {
		await withSharedSettings(first, () => writeGlobalGuidelines('Before clear'));

		const ready = Promise.withResolvers<void>();
		const proceed = Promise.withResolvers<void>();

		const stale = withSharedSettings(first, async () => {
			writeGlobalGuidelines('Stale restoration');
			ready.resolve();
			await proceed.promise;
		});

		await ready.promise;
		await withSharedSettings(second, clearGlobalGuidelines);
		proceed.resolve();
		await expect(stale).rejects.toBeInstanceOf(SharedSettingsConflictError);

		await withSharedSettings(second, () => {
			expect(readSharedSetting('global-guidelines')).toBeNull();
			expect(readGlobalGuidelines().updatedAt).toBeNull();
		});
	});

	test('failed operations commit no settings and detached writes are rejected', async () => {
		await expect(
			withSharedSettings(first, () => {
				setToken('github', 'not-committed');
				throw new Error('operation failed');
			})
		).rejects.toThrow('operation failed');

		await withSharedSettings(second, () => expect(getToken('github')).toBeUndefined());

		const detached = await withSharedSettings(first, () => () => writeSharedSetting('tokens', {}));

		expect(detached).toThrow('active withSharedSettings');
	});

	test('invalid persisted domain values fail rather than use replica-local settings', async () => {
		await withSharedSettings(first, () => writeSharedSetting('tokens', { github: 42 }));
		await expect(withSharedSettings(second, () => getToken('github'))).rejects.toThrow();
	});

	test('settings and application writes commit or roll back in the caller transaction', async () => {
		await first`CREATE TABLE effects (id text PRIMARY KEY)`;

		await expect(
			first.begin((transaction) =>
				withSharedSettingsTransaction(transaction, async () => {
					setToken('github', 'rolled-back');
					await transaction`INSERT INTO effects (id) VALUES ('rolled-back')`;
					throw new Error('rollback both');
				})
			)
		).rejects.toThrow('rollback both');

		expect(await second`SELECT id FROM effects`).toHaveLength(0);
		await withSharedSettings(second, () => expect(getToken('github')).toBeUndefined());

		await first.begin((transaction) =>
			withSharedSettingsTransaction(transaction, async () => {
				setToken('github', 'committed');
				await transaction`INSERT INTO effects (id) VALUES ('committed')`;
			})
		);

		expect(await second`SELECT id FROM effects`).toHaveLength(1);
		await withSharedSettings(second, () => expect(getToken('github')).toBe('committed'));
	});

	test('concurrent initialization succeeds and newer setting domains do not break older readers', async () => {
		await first`DROP TABLE recoder_settings`;
		await Promise.all([initializeSharedSettings(first), initializeSharedSettings(second)]);
		await first`INSERT INTO recoder_settings (name, value, version) VALUES ('future-domain', '{}'::jsonb, 1)`;
		await withSharedSettings(second, () => expect(getStoredSettings()).toEqual({}));
	});
}
