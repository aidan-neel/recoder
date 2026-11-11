import { afterAll, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EXIT } from '../../../src/cli/exit';
import { resolveTarget } from '../../../src/cli/target/resolve-target';
import { git } from '../../helpers/git';
import {
	fixtureFolder,
	localForge,
	pathWithFake,
	removeFixtureFolders,
	targetRequest,
	userRepository
} from './fixture';

afterAll(removeFixtureFolders);

test('a pull number is found through the origin remote and carries the forge title, body and address', async () => {
	const forge = await localForge();
	const dir = await userRepository();

	git(dir, ['remote', 'add', 'origin', forge.repo.url]);

	const resolved = await resolveTarget(targetRequest(dir, { kind: 'pull', pull: '7' }));

	expect(resolved.title).toBe('Change a');
	expect(resolved.body).toBe('Makes two loud. Closes #5.');
	expect(resolved.report.url).toBe(`${forge.repo.url}#pull/7`);
	expect(resolved.revision?.headSha).toBe(forge.pull7Head);
	expect(resolved.revision?.mergeBaseSha).toBe(forge.squash);
	expect(resolved.diff).toContain('+TWO');
	expect(resolved.diff).not.toContain('helper.ts');

	await resolved.dispose();

	expect(existsSync(resolved.sandboxPath ?? '')).toBe(false);
});

test('a pull URL needs no repository and no origin remote', async () => {
	const forge = await localForge();
	const elsewhere = await fixtureFolder('recoder-no-repo-');

	const resolved = await resolveTarget(targetRequest(elsewhere, { kind: 'pull', pull: `${forge.repo.url}#pull/7` }));

	expect(resolved.revision?.headSha).toBe(forge.pull7Head);

	await resolved.dispose();
});

test('a pull number in a repository without an origin remote asks for the URL', async () => {
	const dir = await userRepository();

	const resolving = resolveTarget(targetRequest(dir, { kind: 'pull', pull: '7' }));

	await expect(resolving).rejects.toMatchObject({ exitCode: EXIT.notReady, message: expect.stringContaining('URL') });
});

test('a rejected pull address is never quoted back, wherever it hides a secret', async () => {
	const dir = await userRepository();

	const hostile = {
		'https://u:SEC/RET@github.com/o/r/issues/7': ['SEC', 'RET'],
		'https://github.com/o/r/issues/7#access_token=SECRET': ['SECRET'],
		'https://github.com/o/TOKEN-IN-PATH/issues/7': ['TOKEN-IN-PATH'],
		'https://user:SECRET@github.com/o/r/issues/7?private_token=TOKEN': ['SECRET', 'TOKEN']
	};

	for (const [pull, secrets] of Object.entries(hostile)) {
		const error = await rejection(resolveTarget(targetRequest(dir, { kind: 'pull', pull })));

		expect(error).toMatchObject({ exitCode: EXIT.usage });
		expect(error.message).toContain('pull request URL');
		for (const secret of secrets) expect(error.message).not.toContain(secret);
	}
});

test('an origin remote that is not on a forge is shown without its query string', async () => {
	const dir = await userRepository();

	git(dir, ['remote', 'add', 'origin', 'https://github.com/o/r/extra?private_token=SECRET']);

	const error = await rejection(resolveTarget(targetRequest(dir, { kind: 'pull', pull: '7' })));

	expect(error).toMatchObject({ exitCode: EXIT.notReady });
	expect(error.message).toContain('https://github.com/o/r/extra ');
	expect(error.message).not.toContain('SECRET');
});

test('a forge that cannot be read is named without its own error text', async () => {
	const dir = await userRepository();

	git(dir, ['remote', 'add', 'origin', 'https://github.com/o/r.git']);

	const { error } = await pullWithFailingGh(dir);

	expect(error).toMatchObject({ exitCode: EXIT.notReady });
	expect(error.message).toContain('the forge has no such pull request');
	expect(error.message).not.toContain(GH_ERROR_TEXT);
});

test('the forge CLI gets an http origin without its query string', async () => {
	const dir = await userRepository();

	git(dir, ['remote', 'add', 'origin', 'https://github.com/o/r?private_token=SECRET']);

	const { ghArgs } = await pullWithFailingGh(dir);

	expect(ghArgs).toContain('--repo o/r ');
	expect(ghArgs).not.toContain('SECRET');
});

test('a failed checkout shows the end of git error with every credential removed', async () => {
	const forge = await localForge();
	const dir = await userRepository();

	git(dir, ['remote', 'add', 'origin', forge.repo.url.replace('file://', 'file://oauth2:ORIGIN-SECRET@')]);

	const error = await pullWithFailingClone(dir);

	expect(error).toMatchObject({ exitCode: EXIT.notReady });
	expect(error.message).toContain('git said:');
	expect(error.message).toContain("unable to access 'https://[redacted]@example.test/r.git/");
	for (const secret of CLONE_SECRETS) expect(error.message).not.toContain(secret);
});

/** Secrets a failing `git clone` prints: in a URL, a query string, an authorization header and a token. */
const CLONE_SECRETS = ['ORIGIN-SECRET', 'URL-SECRET', 'QUERY-SECRET', 'HEADER-SECRET', `ghp_${'A'.repeat(30)}`];

/** Resolves pull request 7 of `dir` with a `git` whose every clone fails, quoting credentials. */
async function pullWithFailingClone(dir: string): Promise<Error> {
	const stderr = [
		"fatal: unable to access 'https://user:URL-SECRET@example.test/r.git/?private_token=QUERY-SECRET': not found",
		'Authorization: Bearer HEADER-SECRET',
		`remote token ${CLONE_SECRETS[4]}`
	];

	const realGit = Bun.which('git') ?? 'git';
	const lines = stderr.map((line) => `echo "${line}" >&2`).join('\n');

	const path = await pathWithFake(
		'git',
		`#!/bin/sh\nif [ "$1" = clone ]; then\n${lines}\nexit 128\nfi\nexec '${realGit}' "$@"\n`
	);

	return withPath(path, () => rejection(resolveTarget(targetRequest(dir, { kind: 'pull', pull: '7' }))));
}

/** What a fake `gh` prints when it fails, standing in for forge output that can quote the remote URL. */
const GH_ERROR_TEXT = 'could not resolve FORGE-OWN-TEXT';

/** Resolves pull request 7 of `dir` with a `gh` that records its arguments and fails. */
async function pullWithFailingGh(dir: string): Promise<{ error: Error; ghArgs: string }> {
	const argsFile = join(await fixtureFolder('recoder-gh-args-'), 'args');
	const path = await pathWithFake('gh', `#!/bin/sh\necho "$*" > '${argsFile}'\necho '${GH_ERROR_TEXT}' >&2\nexit 1\n`);
	const error = await withPath(path, () => rejection(resolveTarget(targetRequest(dir, { kind: 'pull', pull: '7' }))));

	return { error, ghArgs: await readFile(argsFile, 'utf8') };
}

/**
 * Runs `run` with `PATH` set to `path`, then puts it back. Child processes
 * the code under test starts inherit `process.env`, so a fake binary is found
 * first.
 */
async function withPath<T>(path: string | undefined, run: () => Promise<T>): Promise<T> {
	const original = process.env.PATH;

	process.env.PATH = path;

	try {
		return await run();
	} finally {
		process.env.PATH = original;
	}
}

/** The error `resolving` rejects with; fails the test when it resolves instead. */
async function rejection(resolving: Promise<unknown>): Promise<Error> {
	const outcome = await resolving.then(
		() => null,
		(err: unknown) => err
	);

	if (!(outcome instanceof Error)) throw new Error('expected the target to be refused');

	return outcome;
}
