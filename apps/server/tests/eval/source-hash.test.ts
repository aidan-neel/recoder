import { afterAll, expect, test } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { sourceVersion } from '../../src/eval/source-hash';

const root = mkdtempSync(join(tmpdir(), 'recoder-source-'));

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

function write(dir: string, path: string, text: string): void {
	mkdirSync(dirname(join(dir, path)), { recursive: true });
	writeFileSync(join(dir, path), text);
}

/** A checkout with no `.git`: server and shared sources, the manifests, the lockfile and a README. */
function checkout(name: string): string {
	const dir = join(root, name);

	write(dir, 'apps/server/src/review/review.ts', 'export const review = 1;\n');
	write(dir, 'packages/shared/src/index.ts', 'export const shared = 1;\n');
	write(dir, 'apps/server/package.json', '{"name":"@recoder/server"}\n');
	write(dir, 'package.json', '{"name":"recoder"}\n');
	write(dir, 'bun.lock', '{}\n');
	write(dir, 'README.md', '# Recoder\n');

	return dir;
}

test('the code hash reads content only: no .git still hashes, and a byte-identical copy hashes alike', () => {
	const dir = checkout('plain');
	const copy = join(root, 'copy');

	cpSync(dir, copy, { recursive: true });

	expect(sourceVersion(dir)).toMatch(/^source:[0-9a-f]{16}$/);
	expect(sourceVersion(copy)).toBe(sourceVersion(dir));
	expect(sourceVersion(join(root, 'missing'))).toBe('unknown');
});

test('a README change leaves the code hash alone; a server or shared source change changes it', () => {
	const dir = checkout('edited');
	const before = sourceVersion(dir);

	write(dir, 'README.md', '# Recoder, edited\n');
	expect(sourceVersion(dir)).toBe(before);

	write(dir, 'apps/server/src/review/review.ts', 'export const review = 2;\n');

	const server = sourceVersion(dir);

	expect(server).not.toBe(before);

	write(dir, 'packages/shared/src/index.ts', 'export const shared = 2;\n');
	expect(sourceVersion(dir)).not.toBe(server);

	const lock = sourceVersion(dir);

	write(dir, 'bun.lock', '{"lockfileVersion":1}\n');
	expect(sourceVersion(dir)).not.toBe(lock);
});
