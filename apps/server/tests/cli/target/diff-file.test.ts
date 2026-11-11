import { afterAll, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EXIT } from '../../../src/cli/exit';
import { resolveTarget } from '../../../src/cli/target/resolve-target';
import { childEnvironment } from '../child-env';
import { fixtureFolder, removeFixtureFolders, targetRequest } from './fixture';

afterAll(removeFixtureFolders);

const PATCH = ['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -1 +1 @@', '-one', '+two', ''].join('\n');

/** A hunk with no file header before it, so no file it belongs to. */
const HEADERLESS_HUNK = ['@@ -1 +1 @@', '-one', '+two', ''].join('\n');

/** A patch for a file really called `unknown`, the parser's name for a hunk with no file. */
const UNKNOWN_PATCH = PATCH.replaceAll('a.ts', 'unknown');

const ENTRY = join(import.meta.dir, '../../../src/cli/target/resolve-target.ts');

/**
 * Reads a diff from standard input, aborting once the read is waiting when
 * `ABORT` is set (the read starts before `resolveTarget` returns its promise).
 * Prints the exit code the review would end with, and must then exit on its own.
 */
const READ_STANDARD_INPUT = `
import { resolveTarget } from ${JSON.stringify(ENTRY)};
const controller = new AbortController();
const target = { kind: 'diff', source: '-' };
const pending = resolveTarget({ repoPath: '/', target, scope: { include: [], exclude: [] }, signal: controller.signal });
if (process.env.ABORT) controller.abort();
pending.then(() => console.log('resolved'), (err) => console.log(err.exitCode));
`;

/** Long enough for bun to start; a child still running after this has hung. */
const CHILD_TIMEOUT_MS = 20_000;

test('a diff target reads the file as the change, with no checkout', async () => {
	const file = await diffFile('change.diff', PATCH);

	const resolved = await resolveTarget(targetRequest('/', { kind: 'diff', source: file }));

	expect(resolved.diff).toBe(PATCH);
	expect(resolved.sandboxPath).toBeNull();
	expect(resolved.revision).toBeNull();
	expect(resolved.report.changedFiles).toBe(1);
});

test('a diff target refuses text that is not a unified diff', async () => {
	const file = await diffFile('notes.txt', 'just some notes\n');

	const resolving = resolveTarget(targetRequest('/', { kind: 'diff', source: file }));

	await expect(resolving).rejects.toMatchObject({ exitCode: EXIT.usage });
});

test('a diff target refuses a hunk with no file header and names the file', async () => {
	const file = await diffFile('headless.diff', HEADERLESS_HUNK);

	const error = await refusal(file);

	expect(error).toMatchObject({ exitCode: EXIT.usage });
	expect(error.message).toContain(file);
});

test('a diff target refuses a hunk with no file header even when a file called unknown follows', async () => {
	const file = await diffFile('headless-then-unknown.diff', HEADERLESS_HUNK + UNKNOWN_PATCH);

	await expect(refusal(file)).resolves.toMatchObject({ exitCode: EXIT.usage });
});

test('a diff target accepts a file that is really called unknown', async () => {
	const file = await diffFile('unknown.diff', UNKNOWN_PATCH);

	const resolved = await resolveTarget(targetRequest('/', { kind: 'diff', source: file }));

	expect(resolved.report.changedFiles).toBe(1);
});

test('a diff target refuses an empty file and names it', async () => {
	const file = await diffFile('empty.diff', '');

	const error = await refusal(file);

	expect(error).toMatchObject({ exitCode: EXIT.usage });
	expect(error.message).toContain(`${file} is empty`);
});

test(
	'standard input gets the same check as a file',
	async () => {
		const { output, code } = await readInChild(HEADERLESS_HUNK);

		expect(output).toBe(String(EXIT.usage));
		expect(code).toBe(0);
	},
	CHILD_TIMEOUT_MS + 5_000
);

test(
	'an abort ends a wait on standard input that never closes, with the cancelled exit code',
	async () => {
		const { output, code } = await readInChild(null);

		expect(output).toBe(String(EXIT.cancelled));
		expect(code).toBe(0);
	},
	CHILD_TIMEOUT_MS + 5_000
);

/** Writes `text` as `name` in a fresh temp folder and returns its path. */
async function diffFile(name: string, text: string): Promise<string> {
	const file = join(await fixtureFolder('recoder-patch-'), name);

	await writeFile(file, text);

	return file;
}

/** The error a diff target from `file` is refused with; fails the test when it is accepted. */
async function refusal(file: string): Promise<Error> {
	const outcome = await resolveTarget(targetRequest('/', { kind: 'diff', source: file })).then(
		() => null,
		(err: unknown) => err
	);

	if (!(outcome instanceof Error)) throw new Error(`expected ${file} to be refused`);

	return outcome;
}

/**
 * Runs `READ_STANDARD_INPUT` in its own process, feeding it `stdin` and
 * closing it; null leaves standard input open and aborts the waiting read.
 * Returns what the child printed and its exit code.
 */
async function readInChild(stdin: string | null): Promise<{ output: string; code: number }> {
	const dataDir = await fixtureFolder('recoder-diff-child-');
	const env = { ...childEnvironment(dataDir), ...(stdin === null ? { ABORT: '1' } : {}) };

	const child = Bun.spawn([process.execPath, '-e', READ_STANDARD_INPUT], {
		env,
		stdin: 'pipe',
		stdout: 'pipe',
		stderr: 'pipe',
		timeout: CHILD_TIMEOUT_MS
	});

	if (stdin !== null) {
		await child.stdin.write(stdin);
		await child.stdin.end();
	}

	const [output, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);

	if (stdin === null) await child.stdin.end();

	return { output: output.trim(), code };
}
