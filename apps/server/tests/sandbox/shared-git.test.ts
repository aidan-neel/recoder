import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from '../../src/env';
import { locateRepo, refspecFor } from '../../src/forge/providers';
import { execUnavailableReason, runSandboxed, sandboxLayout } from '../../src/sandbox/exec-sandbox';
import { prepareSandbox } from '../../src/sandbox/sandbox';
import { localForgeFixture } from '../helpers/local-forge';

const available = (await execUnavailableReason()) === null;
const originalWorkDir = env.RECODER_WORKDIR;

beforeEach(async () => {
	env.RECODER_WORKDIR = await mkdtemp(join(tmpdir(), 'recoder-shared-git-'));
});

afterEach(() => {
	env.RECODER_WORKDIR = originalWorkDir;
});

/** Two checkouts of the same pull request, the way two reviews of it are prepared. */
async function twoCheckouts() {
	const { repo, pull7Head } = await localForgeFixture();
	const { provider, slug } = locateRepo(repo.url);

	const prepare = () =>
		prepareSandbox({
			repoSlug: slug,
			prNumber: 7,
			repoUrl: repo.url,
			...refspecFor(provider, 7),
			reviewId: crypto.randomUUID(),
			provider,
			expectedHeadSha: pull7Head
		});

	return { first: await prepare(), second: await prepare(), head: pull7Head };
}

test('a second checkout of the same repo reads its objects from the shared copy', async () => {
	const { first, second } = await twoCheckouts();
	const shared = await readdir(join(env.RECODER_WORKDIR, 'shared', 'git'));

	expect(shared).toHaveLength(1);

	for (const checkout of [first, second]) {
		const alternates = await readFile(join(checkout.path, '.git/objects/info/alternates'), 'utf8');

		expect(alternates.trim()).toBe(join(await realpath(env.RECODER_WORKDIR), 'shared', 'git', shared[0]!, 'objects'));
	}
});

test.skipIf(!available)(
	'a sandboxed command reads the shared git objects but cannot write them, and the next review still reads them',
	async () => {
		const { second, head } = await twoCheckouts();
		const gitDir = join(env.RECODER_WORKDIR, 'shared', 'git');
		const objects = join(gitDir, (await readdir(gitDir))[0]!, 'objects');
		const layout = sandboxLayout(second.path);

		const read = await runSandboxed(layout, `git cat-file -t ${head}`, { timeoutMs: 10_000 });

		expect(read.output.trim()).toBe('commit');

		await runSandboxed(layout, `touch ${objects}/planted; echo x >> ${objects}/info/packs; rm -rf ${objects}/pack`, {
			timeoutMs: 10_000
		});

		expect(existsSync(join(objects, 'planted'))).toBe(false);
		expect(existsSync(join(objects, 'pack'))).toBe(true);
	}
);

test('a repo whose shared copy cannot be made is cloned on its own', async () => {
	const { repo, pull7Head } = await localForgeFixture();
	const { provider, slug } = locateRepo(repo.url);
	const gitDir = join(env.RECODER_WORKDIR, 'shared', 'git');

	await mkdir(join(env.RECODER_WORKDIR, 'shared'), { recursive: true });
	await writeFile(gitDir, 'a file where the directory should be');

	const checkout = await prepareSandbox({
		repoSlug: slug,
		prNumber: 7,
		repoUrl: repo.url,
		...refspecFor(provider, 7),
		reviewId: crypto.randomUUID(),
		provider,
		expectedHeadSha: pull7Head
	});

	expect(checkout.headSha).toBe(pull7Head);
	expect(existsSync(join(checkout.path, '.git/objects/info/alternates'))).toBe(false);
});

test('a shallow clone is not kept as the shared copy, because git refuses it as a reference', async () => {
	const { ensureSharedClone } = await import('../../src/sandbox/shared-git');

	const shared = await ensureSharedClone({
		workDir: env.RECODER_WORKDIR,
		repoSlug: 'synth/shallow',
		cloneUrl: 'file:///nowhere',
		run: async (_cwd, args) => {
			if (args[0] === 'clone') {
				await mkdir(args.at(-1)!, { recursive: true });
				await writeFile(join(args.at(-1)!, 'shallow'), 'abc\n');
			}

			return '';
		}
	});

	expect(shared).toBeNull();
	expect(existsSync(join(env.RECODER_WORKDIR, 'shared', 'git', 'synth__shallow.git'))).toBe(false);
});
