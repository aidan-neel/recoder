import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../../../src/env';
import type { ReviewScope, ReviewTarget } from '../../../src/cli/review/options';
import type { TargetRequest } from '../../../src/cli/target/resolve-target';
import { fakeBin } from '../../helpers/fake-bin';
import { git } from '../../helpers/git';
import { localForgeFixture } from '../../helpers/local-forge';

const WHOLE_CHANGE: ReviewScope = { include: [], exclude: [] };

/** Temp folders the tests made, removed by `removeFixtureFolders` once a test file finishes. */
const fixtureFolders: string[] = [];

/** A new temp folder, by its real path, that `removeFixtureFolders` removes. */
export async function fixtureFolder(prefix: string): Promise<string> {
	const dir = realpathSync(await mkdtemp(join(tmpdir(), prefix)));

	fixtureFolders.push(dir);

	return dir;
}

/** Removes every folder the tests made; each test file runs it after its last test. */
export async function removeFixtureFolders(): Promise<void> {
	await Promise.all(fixtureFolders.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}

/** The shared local forge fixture, its folder removed with the others. */
export async function localForge(): ReturnType<typeof localForgeFixture> {
	const forge = await localForgeFixture();

	fixtureFolders.push(fileURLToPath(forge.repo.url));

	return forge;
}

/** A `PATH` that finds a fake `name` running `script` first; its folder is removed with the others. */
export async function pathWithFake(name: string, script: string): Promise<string> {
	const { PATH } = (await fakeBin(name, script)).env;
	const [folder] = PATH.split(':');

	if (!folder) throw new Error(`fakeBin gave no folder for ${name}`);

	fixtureFolders.push(folder);

	return PATH;
}

/**
 * A repository on `main` with one commit of `files` and a `.gitignore` that
 * ignores `*.log`, naming its objects in `objectFormat`.
 */
export async function userRepository(
	files: Record<string, string> = { 'a.ts': 'one\n' },
	objectFormat: 'sha1' | 'sha256' = 'sha1'
): Promise<string> {
	const dir = await fixtureFolder('recoder-target-');

	git(dir, ['init', '-b', 'main', `--object-format=${objectFormat}`]);
	await writeFiles(dir, { '.gitignore': '*.log\n', ...files });
	commitAll(dir, 'init');

	return dir;
}

/** Writes each file, creating its folder. */
export async function writeFiles(dir: string, files: Record<string, string>): Promise<void> {
	for (const [name, content] of Object.entries(files)) {
		await mkdir(dirname(join(dir, name)), { recursive: true });
		await writeFile(join(dir, name), content);
	}
}

/** Stages everything and commits it, returning the new commit. */
export function commitAll(dir: string, message: string): string {
	git(dir, ['add', '-A']);
	git(dir, ['commit', '-m', message]);

	return git(dir, ['rev-parse', 'HEAD']);
}

/** A request for `target` in `repoPath`: the whole change, never cancelled, unless `options` says otherwise. */
export function targetRequest(
	repoPath: string,
	target: ReviewTarget,
	options: Partial<Pick<TargetRequest, 'scope' | 'signal'>> = {}
): TargetRequest {
	return { repoPath, target, scope: WHOLE_CHANGE, signal: new AbortController().signal, ...options };
}

/** The error `resolving` rejects with; fails the test when it resolves instead. */
export async function rejection(resolving: Promise<unknown>): Promise<Error> {
	const outcome = await resolving.then(
		() => null,
		(err: unknown) => err
	);

	if (!(outcome instanceof Error)) throw new Error('expected the target to be refused');

	return outcome;
}

/**
 * Everything a review must not change, read without refreshing the index:
 * status, index entries and bytes, HEAD, every ref and the stash.
 */
export function repositoryState(dir: string): string {
	return [
		git(dir, ['--no-optional-locks', 'status', '--porcelain', '--untracked-files=all']),
		git(dir, ['ls-files', '--stage']),
		createHash('sha256')
			.update(readFileSync(join(dir, '.git', 'index')))
			.digest('hex'),
		git(dir, ['rev-parse', 'HEAD']),
		git(dir, ['for-each-ref']),
		git(dir, ['stash', 'list'])
	].join('\n---\n');
}

/** The throwaway checkouts left on disk for the repository at `dir`. */
export function checkoutsOf(dir: string): string[] {
	const prefix = `local__${basename(dir)}-`;
	const repos = join(env.RECODER_WORKDIR, 'repos');

	return existsSync(repos) ? readdirSync(repos).filter((name) => name.startsWith(prefix)) : [];
}
