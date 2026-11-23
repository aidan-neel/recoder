import { afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from '../../src/env';
import { locateRepo, refspecFor } from '../../src/forge/providers';
import { prepareSandbox } from '../../src/sandbox/sandbox';
import { localForgeFixture, type LocalForgeFixture } from '../helpers/local-forge';

const originalWorkDir = env.RECODER_WORKDIR;

/**
 * A git that records every invocation and, when told, fails the first clone
 * with a mid-transfer drop or every clone with a refusal. Anything else runs
 * the real git, so the checkouts it prepares are genuine.
 */
const FAKE_GIT = `#!/usr/bin/env bun
const { appendFileSync, existsSync, writeFileSync } = require('node:fs');

const args = process.argv.slice(2);

appendFileSync(process.env.FAKE_GIT_LOG, args.join(' ') + '\\n');

if (args[0] === 'clone' && process.env.FAKE_GIT_FAIL !== 'none') {
	const marker = process.env.FAKE_GIT_LOG + '.failed-clone';

	if (process.env.FAKE_GIT_FAIL === 'transient' && !existsSync(marker)) {
		writeFileSync(marker, '');
		process.stderr.write('Receiving objects: 36% (243804/668773), 509.13 MiB | 3.50 MiB/s\\r\\n');
		process.stderr.write('error: RPC failed; curl 56 Recv failure: Connection reset by peer\\r\\n');
		process.stderr.write('fatal: early EOF\\r\\n');
		process.exit(128);
	}

	if (process.env.FAKE_GIT_FAIL === 'permanent') {
		process.stderr.write('Receiving objects: 5% (33438/668773), 62.00 MiB | 1.00 MiB/s\\r\\n');
		process.stderr.write("fatal: Authentication failed for 'https://github.com/test/local.git'\\r\\n");
		process.exit(128);
	}
}

const rewritten = args.map((arg) => (arg.startsWith('https://github.com/') ? process.env.FAKE_GIT_URL : arg));
const proc = Bun.spawn([process.env.FAKE_GIT_REAL, ...rewritten], { stdio: ['ignore', 'inherit', 'inherit'] });

process.exit(await proc.exited);
`;

/** The repository every test clones from, and the fake git that fronts it. */
let origin: LocalForgeFixture;
let fakeBin: string;
let logPath: string;
let realGit: string;

beforeAll(async () => {
	origin = await localForgeFixture();
	realGit = Bun.spawnSync(['which', 'git']).stdout.toString().trim();
	fakeBin = await mkdtemp(join(tmpdir(), 'recoder-fake-git-'));
	logPath = join(fakeBin, 'invocations.log');

	await writeFile(join(fakeBin, 'git'), FAKE_GIT);
	await chmod(join(fakeBin, 'git'), 0o755);
});

beforeEach(async () => {
	env.RECODER_WORKDIR = await mkdtemp(join(tmpdir(), 'recoder-clone-'));
	await rm(logPath, { force: true });
	await rm(logPath + '.failed-clone', { force: true });
});

afterEach(async () => {
	env.RECODER_WORKDIR = originalWorkDir;
	await rm(env.RECODER_WORKDIR, { recursive: true, force: true });
});

/** Prepares a review checkout through the fake git, which fronts the local fixture as GitHub when asked. */
function prepare(provider: 'local' | 'github', fail: 'transient' | 'permanent' | 'none') {
	const located = provider === 'github' ? { provider, slug: 'test/local' } : locateRepo(origin.repo.url);

	return prepareSandbox({
		repoSlug: located.slug,
		prNumber: 7,
		repoUrl: provider === 'github' ? 'https://github.com/test/local.git' : origin.repo.url,
		...refspecFor(located.provider, 7),
		reviewId: crypto.randomUUID(),
		provider: located.provider,
		expectedHeadSha: origin.pull7Head,
		retryDelaysMs: [0],
		env: {
			PATH: `${fakeBin}:${process.env.PATH}`,
			FAKE_GIT_LOG: logPath,
			FAKE_GIT_REAL: realGit,
			FAKE_GIT_URL: origin.repo.url,
			FAKE_GIT_FAIL: fail
		}
	});
}

/** The clone commands the fake git recorded. */
async function clones(): Promise<string[]> {
	return (await readFile(logPath, 'utf8')).split('\n').filter((line) => line.startsWith('clone '));
}

test('a clone that drops mid-transfer is retried and the review checkout is still prepared', async () => {
	const checkout = await prepare('local', 'transient');

	expect(checkout.headSha).toBe(origin.pull7Head);

	const recorded = await clones();

	expect(recorded).toHaveLength(3);
	expect(recorded[0]).toContain('--bare');
	expect(recorded[1]).toBe(recorded[0]);
	expect(recorded[2]).not.toContain('--bare');
});

test('a refused clone is never retried and fails with one readable cause', async () => {
	const preparing = prepare('local', 'permanent');

	await expect(preparing).rejects.toThrow(
		"git clone failed: Authentication failed for 'https://github.com/test/local.git'"
	);

	expect(await clones()).toHaveLength(2);
});

test('the clones fetch no blobs and no other branches, and the checkout can read blobs on its own', async () => {
	const checkout = await prepare('github', 'none');

	expect(checkout.headSha).toBe(origin.pull7Head);

	const recorded = await clones();

	expect(recorded).toHaveLength(2);

	for (const line of recorded) {
		expect(line).toContain('--filter=blob:none');
		expect(line).not.toContain('--depth');
	}

	expect(recorded[0]).toContain('--bare');
	expect(recorded[1]).toContain('--single-branch');
	expect(recorded[1]).toContain('-c credential.https://github.com.helper=!gh auth git-credential');
	expect(existsSync(join(checkout.path, '.git', 'shallow'))).toBe(false);
});
