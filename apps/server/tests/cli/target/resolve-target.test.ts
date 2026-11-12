import { afterAll, expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { EXIT } from '../../../src/cli/exit';
import { resolveTarget } from '../../../src/cli/target/resolve-target';
import { sandboxLayout } from '../../../src/sandbox/sandbox-layout';
import { scopeOfCheckout } from '../../../src/sandbox/shared-install';
import { git } from '../../helpers/git';
import {
	checkoutsOf,
	commitAll,
	fixtureFolder,
	removeFixtureFolders,
	targetRequest,
	userRepository,
	writeFiles
} from './fixture';

afterAll(removeFixtureFolders);

/** A folder a Go module cache leaves behind: readable, not writable. */
const READ_ONLY_DIR = 0o555;

/** A folder's usual mode, to put back after a test made it read-only. */
const WRITABLE_DIR = 0o755;

/** The folder overlayfs leaves in a work dir. */
const NO_ACCESS = 0o000;

/** A repository whose `feature` branch changes a source file, its test and a doc. */
async function featureRepository(): Promise<string> {
	const dir = await userRepository({ 'src/a.ts': 'a\n', 'src/a.test.ts': 'test\n', 'docs/x.md': 'doc\n' });

	git(dir, ['checkout', '-b', 'feature']);
	await writeFiles(dir, { 'src/a.ts': 'a2\n', 'src/a.test.ts': 'test2\n', 'docs/x.md': 'doc2\n' });
	commitAll(dir, 'Change everything');

	return dir;
}

const FEATURE = { kind: 'range', base: 'main', head: 'feature', start: { kind: 'continue' } } as const;

test('include and exclude narrow the diff to the matching paths', async () => {
	const dir = await featureRepository();
	const scope = { include: ['src/**'], exclude: ['**/*.test.ts'] };

	const resolved = await resolveTarget(targetRequest(dir, FEATURE, { scope }));

	expect(resolved.diff).toContain('b/src/a.ts');
	expect(resolved.diff).not.toContain('a.test.ts');
	expect(resolved.diff).not.toContain('x.md');
	expect(resolved.report.changedFiles).toBe(1);

	await resolved.dispose();
});

test('dispose removes the throwaway checkout', async () => {
	const dir = await featureRepository();
	const resolved = await resolveTarget(targetRequest(dir, FEATURE));

	expect(existsSync(resolved.sandboxPath ?? '')).toBe(true);

	await resolved.dispose();

	expect(existsSync(resolved.sandboxPath ?? '')).toBe(false);
	expect(checkoutsOf(dir)).toEqual([]);
});

test('the checkout holds its own objects and borrows none from the repository', async () => {
	const dir = await featureRepository();
	const resolved = await resolveTarget(targetRequest(dir, FEATURE));
	const checkout = resolved.sandboxPath ?? '';

	expect(existsSync(join(checkout, '.git', 'objects', 'info', 'alternates'))).toBe(false);
	expect(git(checkout, ['cat-file', '-t', resolved.report.baseSha ?? ''])).toBe('commit');
	expect(git(checkout, ['rev-parse', 'HEAD'])).toBe(resolved.report.headSha ?? '');

	await resolved.dispose();
});

test('a change that is empty within the scope is refused and leaves no checkout behind', async () => {
	const dir = await featureRepository();
	const scope = { include: ['nothing/**'], exclude: [] };

	const resolving = resolveTarget(targetRequest(dir, FEATURE, { scope }));

	await expect(resolving).rejects.toMatchObject({ exitCode: EXIT.usage, message: expect.stringContaining('main') });
	expect(checkoutsOf(dir)).toEqual([]);
});

test('a cancelled request stops with the cancelled exit code and leaves no checkout behind', async () => {
	const dir = await featureRepository();
	const controller = new AbortController();

	controller.abort();

	const resolving = resolveTarget(targetRequest(dir, FEATURE, { signal: controller.signal }));

	await expect(resolving).rejects.toMatchObject({ exitCode: EXIT.cancelled });
	expect(checkoutsOf(dir)).toEqual([]);
});

test('two repositories with the same folder name never share dependency installs', async () => {
	const first = await featureRepository();
	const second = join(await fixtureFolder('recoder-twin-'), basename(first));

	git(first, ['clone', '--quiet', first, second]);

	const resolvedFirst = await resolveTarget(targetRequest(first, FEATURE));

	const resolvedSecond = await resolveTarget(
		targetRequest(second, { kind: 'range', base: 'origin/main', head: 'origin/feature', start: { kind: 'continue' } })
	);

	const scopes = [resolvedFirst, resolvedSecond].map((resolved) => scopeOfCheckout(resolved.sandboxPath ?? ''));

	expect(scopes[0]).not.toBeNull();
	expect(scopes[0]).not.toBe(scopes[1]);

	await resolvedFirst.dispose();
	await resolvedSecond.dispose();
});

test('dispose removes every folder the sandbox keeps under the checkout name and keeps shared ones', async () => {
	const dir = await featureRepository();
	const resolved = await resolveTarget(targetRequest(dir, FEATURE));
	const layout = sandboxLayout(resolved.sandboxPath ?? '');
	const name = basename(layout.cacheDir);
	const shared = join(layout.sharedDir, 'installs', 'some-scope', 'kept');
	const mergeBase = resolved.report.mergeBaseSha ?? '';

	await writeFiles(layout.cacheDir, { 'gomod/pkg/mod.go': 'read-only\n' });
	await chmod(join(layout.cacheDir, 'gomod', 'pkg'), READ_ONLY_DIR);
	await mkdir(join(layout.layersDir, 'store.wk', 'work'), { recursive: true });
	await chmod(join(layout.layersDir, 'store.wk', 'work'), NO_ACCESS);
	await writeFile(join(dirname(layout.cacheDir), `${name}.base-${mergeBase.slice(0, 12)}.index`), '');
	await writeFiles(shared, { 'ready.json': '{}' });

	await resolved.dispose();

	expect(readdirSync(dirname(layout.cacheDir)).filter((entry) => entry.startsWith(name))).toEqual([]);
	expect(existsSync(resolved.sandboxPath ?? '')).toBe(false);
	expect(existsSync(join(shared, 'ready.json'))).toBe(true);
});

test('dispose still removes the checkout when another folder cannot be removed, and names that folder', async () => {
	const dir = await featureRepository();
	const resolved = await resolveTarget(targetRequest(dir, FEATURE));
	const layout = sandboxLayout(resolved.sandboxPath ?? '');
	const cacheRoot = dirname(layout.cacheDir);

	await writeFiles(layout.cacheDir, { 'xdg/kept': 'cached\n' });
	await chmod(cacheRoot, READ_ONLY_DIR);

	try {
		await expect(resolved.dispose()).rejects.toThrow(layout.cacheDir);
	} finally {
		await chmod(cacheRoot, WRITABLE_DIR);
	}

	expect(existsSync(resolved.sandboxPath ?? '')).toBe(false);

	await rm(layout.cacheDir, { recursive: true, force: true });
});
