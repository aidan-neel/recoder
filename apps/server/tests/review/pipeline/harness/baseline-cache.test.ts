import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
	baselineCacheDir,
	evictBaselineCache,
	readCachedCheck,
	writeCachedCheck
} from '../../../../src/review/pipeline/harness/baseline-cache';
import { execUnavailableReason, runSandboxed, sandboxLayout } from '../../../../src/sandbox/exec-sandbox';
import type { CheckInputs } from '../../../../src/sandbox/exec-workspace';

const inputs: CheckInputs = { scope: 'acme__app', headSha: 'a'.repeat(40), dependencies: 'deps', tools: 'node 22' };
const entry = { exitCode: 1, content: 'FAIL', elapsedMs: 5 };
const DAY = 24 * 60 * 60 * 1000;

let base = '';

beforeAll(async () => {
	base = await mkdtemp(join(import.meta.dir, '.baseline-cache-'));
});

afterAll(async () => {
	await rm(base, { recursive: true, force: true });
	await rm(baselineCacheDir(), { recursive: true, force: true });
});

test('every input that can change a result is part of the key', async () => {
	await writeCachedCheck(inputs, 'bun test src/a/', entry);

	expect(await readCachedCheck(inputs, 'bun test src/a/')).toEqual(entry);

	const changed: Array<[CheckInputs, string]> = [
		[{ ...inputs, scope: 'acme__other' }, 'bun test src/a/'],
		[{ ...inputs, headSha: 'b'.repeat(40) }, 'bun test src/a/'],
		[{ ...inputs, dependencies: 'other deps' }, 'bun test src/a/'],
		[{ ...inputs, tools: 'node 24' }, 'bun test src/a/'],
		[inputs, 'bun test src/b/'],
		[inputs, 'cd packages/x && bun test src/a/']
	];

	for (const [other, command] of changed) expect(await readCachedCheck(other, command)).toBeNull();
});

test('a result that cannot be parsed is a miss', async () => {
	await writeCachedCheck(inputs, 'bun check', entry);

	const scope = join(baselineCacheDir(), 'acme__app');

	for (const name of await readdir(scope)) await writeFile(join(scope, name), '{"exitCode":"x"');

	expect(await readCachedCheck(inputs, 'bun check')).toBeNull();
});

test('eviction drops entries past the age limit, then the least recently used past the size limit', async () => {
	const root = join(base, 'evict');
	const now = Date.now();

	await mkdir(join(root, 'scope'), { recursive: true });

	const put = async (name: string, ageDays: number) => {
		const path = join(root, 'scope', `${name}.json`);
		const time = new Date(now - ageDays * DAY);

		await writeFile(path, 'x'.repeat(100));
		await utimes(path, time, time);
	};

	await put('old', 20);
	await put('older-fresh', 3);
	await put('newer-fresh', 2);
	await put('newest', 1);

	await evictBaselineCache(root, { maxAgeMs: 14 * DAY, maxBytes: 250 }, now);

	expect((await readdir(join(root, 'scope'))).sort()).toEqual(['newer-fresh.json', 'newest.json']);
});

const available = (await execUnavailableReason()) === null;

test.skipIf(!available)('a sandboxed command can neither read nor write the cache', async () => {
	const dataDir = join(base, 'data');
	const cache = join(dataDir, 'baseline-cache');
	const checkout = join(base, 'work/repos/pr-1');

	await mkdir(join(cache, 'acme__app'), { recursive: true });
	await mkdir(join(checkout, '.git'), { recursive: true });
	await writeFile(join(cache, 'acme__app/entry.json'), '{"content":"SECRET RESULT"}');

	const layout = sandboxLayout(checkout, { home: join(base, 'home'), dataDir, workDir: join(base, 'work') });

	const result = await runSandboxed(
		layout,
		`cat ${join(cache, 'acme__app/entry.json')}; echo forged > ${join(cache, 'acme__app/forged.json')}; echo planted > ${join(cache, 'planted.json')}; echo done`,
		{ timeoutMs: 10_000 }
	);

	expect(result.output).not.toContain('SECRET RESULT');
	expect(result.output).toContain('done');
	expect(existsSync(join(cache, 'acme__app/forged.json'))).toBe(false);
	expect(existsSync(join(cache, 'planted.json'))).toBe(false);
});
