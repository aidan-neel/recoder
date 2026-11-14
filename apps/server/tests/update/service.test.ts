import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Review } from '@recoder/shared';
import { assetFor } from '../../src/cli/upgrade/install-binary';
import { parseReleaseTag } from '../../src/cli/upgrade/release-tag';
import type { ReleaseSource } from '../../src/cli/upgrade/release-source';
import { commitAll } from '../helpers/git';
import { fakeBin } from '../helpers/fake-bin';
import { restoreEnvAfterEach } from '../helpers/env';
import { useTempStore } from '../helpers/temp-store';
import { closeReviewControl, openReviewControl, type ReviewControl } from '../../src/review/session/review-control';
import { recoverStaleReviews, db } from '../../src/store';
import { releaseReviewStarts, reviewStartsHeld } from '../../src/update/hold';
import { resumeAfterUpdate } from '../../src/update/pauses';
import { UPDATE_RECORD_ID, updateRecords, type UpdateRecord } from '../../src/update/record';
import { spawnProcess } from '../../src/update/run';
import { createUpdateService, UpdateRefusedError, type UpdateDeps, type UpdateService } from '../../src/update/service';
import { makeCheckout, upstreamCommit } from './fixture';

useTempStore('recoder-update-');

restoreEnvAfterEach(['RECODER_REVIEW_BASE_URL', 'RECODER_REVIEW_API_KEY', 'RECODER_REVIEW_MODEL']);

/** An executable `bun` on PATH that logs its arguments and exits with `exitCode`. */
async function fakeBun(dir: string, exitCode = 0): Promise<{ env: Record<string, string>; callsFile: string }> {
	const callsFile = join(dir, 'bun-calls');
	const { env } = await fakeBin('bun', `#!/bin/sh\necho "$*" >> '${callsFile}'\nexit ${exitCode}`);

	return { env, callsFile };
}

/** Waits until the durable record reaches one of `states` and returns it. */
async function waitForRecord(states: string[], attempts = 100): Promise<UpdateRecord> {
	for (let i = 0; i < attempts; i++) {
		const record = await updateRecords.get(UPDATE_RECORD_ID);

		if (record && states.includes(record.state)) return record;

		await new Promise((resolve) => setTimeout(resolve, 20));
	}

	throw new Error(`the update record never reached ${states.join(' or ')}`);
}

const tracked: { id: string; control: ReviewControl }[] = [];

/** A review marked running with a live control, the way the pipeline leaves one. */
async function seedRunningReview(): Promise<{ id: string; control: ReviewControl }> {
	const now = '2020-01-01T00:00:00.000Z';

	const review: Review = {
		id: crypto.randomUUID(),
		repoId: 'repo-missing',
		prNumber: 7,
		headSha: 'abc',
		status: 'running',
		summary: null,
		findings: [],
		runs: [],
		source: 'github',
		prTitle: null,
		prUrl: null,
		createdAt: now,
		updatedAt: now
	};

	await db.reviews.set(review);

	const control = openReviewControl(review.id);

	tracked.push({ id: review.id, control });

	return { id: review.id, control };
}

function serviceFor(overrides: Partial<UpdateDeps>): { service: UpdateService; restarts: number[] } {
	const restarts: number[] = [];

	const service = createUpdateService({
		environment: { root: '/nonexistent', managed: false, compiledBinary: false },
		run: spawnProcess,
		restart: () => restarts.push(Date.now()),
		detectWeb: async () => 'hot-reload',
		...overrides
	});

	return { service, restarts };
}

/** A git-mode service at `root`, with a fake `bun` logging its calls. */
async function bunGitService(root: string, exitCode = 0) {
	const dir = await mkdtemp(join(tmpdir(), 'recoder-update-bun-'));
	const { env, callsFile } = await fakeBun(dir, exitCode);

	const { service, restarts } = serviceFor({
		environment: { root, managed: false, compiledBinary: false },
		toolEnv: env
	});

	return { service, restarts, callsFile };
}

beforeEach(() => {
	releaseReviewStarts();
});

afterEach(async () => {
	releaseReviewStarts();

	for (const { id, control } of tracked.splice(0)) {
		closeReviewControl(id, control);
		await db.reviews.delete(id);
	}

	await updateRecords.clear();
});

describe('check', () => {
	test('reports the commits and classified changes a web-only update brings', async () => {
		const { source, root } = await makeCheckout();

		await upstreamCommit(source, { 'apps/app/new-page.tsx': 'export {};\n' }, 'add a page');

		const { service } = serviceFor({ environment: { root, managed: false, compiledBinary: false } });
		const status = await service.check();

		expect(status.mode).toBe('git');
		expect(status.state).toBe('idle');
		expect(status.current.branch).toBe('main');
		expect(status.available?.commits.map((commit) => commit.subject)).toEqual(['add a page']);
		expect(status.available?.changes).toEqual({ server: false, web: true, install: false });
	});

	test('reports blockedReason instead of refusing the check on a dirty or diverged tree', async () => {
		const { source, root } = await makeCheckout();
		const { service } = serviceFor({ environment: { root, managed: false, compiledBinary: false } });

		await writeFile(join(root, 'apps/server/src/index.ts'), 'dirty\n');
		await upstreamCommit(source, { 'apps/web/src/new.ts': 'export {};\n' });

		let status = await service.check();

		expect(status.blockedReason).toContain('uncommitted');
		await expect(service.apply()).rejects.toBeInstanceOf(UpdateRefusedError);

		await commitAll(root, 'local work');
		status = await service.check();

		expect(status.blockedReason).toContain('diverged');
		await expect(service.apply()).rejects.toBeInstanceOf(UpdateRefusedError);
	});

	test('a managed install reports redeploying and never touches git or reviews', async () => {
		const { service, restarts } = serviceFor({
			environment: { root: '/nonexistent', managed: true, compiledBinary: false }
		});

		const status = await service.check();

		expect(status).toMatchObject({ mode: 'managed', state: 'idle', available: null });
		expect(status.managedNote).toContain('redeploy');
		await expect(service.apply()).rejects.toBeInstanceOf(UpdateRefusedError);
		expect(restarts).toHaveLength(0);
	});
});

describe('apply', () => {
	test('a web-only update pulls and reports the web app without pausing reviews or restarting', async () => {
		const { source, root } = await makeCheckout();
		const { id, control } = await seedRunningReview();
		const { service, restarts, callsFile } = await bunGitService(root);

		await upstreamCommit(source, { 'apps/app/another.tsx': 'export {};\n' });
		await service.apply();

		const record = await waitForRecord(['idle', 'failed']);

		expect(record.state).toBe('idle');
		expect(record.webRestart).toBe('hot-reload');
		expect(control.paused).toBe(false);
		expect(reviewStartsHeld()).toBe(false);
		expect(restarts).toHaveLength(0);
		expect(existsSync(callsFile)).toBe(false);
		expect((await db.reviews.get(id))?.status).toBe('running');
	});

	test('a server update pauses running reviews, records them, and restarts', async () => {
		const { source, root } = await makeCheckout();
		const { id, control } = await seedRunningReview();
		const { service, restarts } = serviceFor({ environment: { root, managed: false, compiledBinary: false } });

		await upstreamCommit(source, { 'apps/server/src/changed.ts': 'export const y = 2;\n' });
		await service.apply();

		const record = await waitForRecord(['restarting', 'failed']);

		expect(record.state).toBe('restarting');
		expect(record.pausedReviewIds).toEqual([id]);
		expect(control.paused).toBe(true);
		expect(restarts).toHaveLength(1);
	});

	test('the successor resumes exactly the reviews the update paused, and clears the record', async () => {
		process.env.RECODER_REVIEW_BASE_URL = 'http://localhost:9/v1';
		process.env.RECODER_REVIEW_API_KEY = 'test';
		process.env.RECODER_REVIEW_MODEL = 'test-model';

		const { source, root } = await makeCheckout();
		const { id } = await seedRunningReview();
		const before = await db.reviews.get(id);
		const { service } = serviceFor({ environment: { root, managed: false, compiledBinary: false } });

		await upstreamCommit(source, { 'apps/server/src/changed.ts': 'export const y = 2;\n' });
		await service.apply();
		await waitForRecord(['restarting', 'failed']);

		await recoverStaleReviews();
		expect((await db.reviews.get(id))?.status).toBe('failed');

		await resumeAfterUpdate();

		const after = await db.reviews.get(id);

		expect(await updateRecords.get(UPDATE_RECORD_ID)).toBeUndefined();
		expect(after?.updatedAt).not.toBe(before?.updatedAt);
	});

	test('a failure before the restart resumes the paused reviews and reports it', async () => {
		const { source, root } = await makeCheckout();
		const { control } = await seedRunningReview();
		const { service, restarts } = await bunGitService(root, 1);

		await upstreamCommit(source, {
			'apps/server/src/changed.ts': 'export const y = 2;\n',
			'apps/app/package.json': JSON.stringify({ name: '@recoder/app', dependencies: { 'new-dep': '1.0.0' } })
		});

		await service.apply();

		const record = await waitForRecord(['idle', 'failed']);

		expect(record.state).toBe('failed');
		expect(record.error).toContain('bun install');
		expect(record.error).toContain('restart the server to finish it');
		expect(record.pausedReviewIds).toEqual([]);
		expect(control.paused).toBe(false);
		expect(reviewStartsHeld()).toBe(false);
		expect(restarts).toHaveLength(0);
	});

	test('an update that touches nothing owned still pulls, without installing or restarting', async () => {
		const { source, root } = await makeCheckout();
		const { service, restarts, callsFile } = await bunGitService(root);

		await upstreamCommit(source, { 'docs/new-guide.md': '# guide\n' });

		const head = (await service.check()).current.commit;

		await service.apply();

		const record = await waitForRecord(['idle', 'failed']);

		expect(record.state).toBe('idle');
		expect(existsSync(callsFile)).toBe(false);
		expect(restarts).toHaveLength(0);
		expect((await service.check()).current.commit).not.toBe(head);
	});

	test('binary mode replaces the executable and restarts like a server update', async () => {
		const { control } = await seedRunningReview();
		const dir = await mkdtemp(join(tmpdir(), 'recoder-update-bin-'));
		const executable = join(dir, 'recoder');

		await writeFile(executable, 'old binary\n');
		await chmod(executable, 0o755);

		const content = new TextEncoder().encode('#!/bin/sh\necho 9.9.9\n');
		const asset = assetFor(process.platform, process.arch);

		const releases: ReleaseSource = {
			latestTag: async () => parseReleaseTag('9.9.9'),
			checksums: async () => `${createHash('sha256').update(content).digest('hex')}  ${asset}\n`,
			binary: async () => content
		};

		const { service, restarts } = serviceFor({
			environment: { root: '/nonexistent', managed: false, compiledBinary: true },
			executable,
			releases
		});

		expect((await service.check()).available?.version).toBe('v9.9.9');
		await service.apply();

		const record = await waitForRecord(['restarting', 'failed']);

		expect(record.state).toBe('restarting');
		expect(control.paused).toBe(true);
		expect(restarts).toHaveLength(1);
		expect(await readFile(executable, 'utf8')).toBe('#!/bin/sh\necho 9.9.9\n');
	});
});
