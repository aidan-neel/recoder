import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyFixCommit, FixError } from './fix';

function sh(cwd: string, args: string[]): void {
	const result = Bun.spawnSync(['git', ...args], { cwd, stdout: 'ignore', stderr: 'ignore' });
	if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed`);
}

const hasGit = (): boolean => {
	try {
		return Bun.spawnSync(['git', '--version'], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0;
	} catch {
		return false;
	}
};

const it = hasGit() ? test : test.skip;

async function seedRepo(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'recoder-fix-test-'));
	sh(dir, ['init', '-b', 'main']);
	sh(dir, ['config', 'user.email', 'test@test']);
	sh(dir, ['config', 'user.name', 'test']);
	await writeFile(join(dir, 'a.ts'), 'const x = 1;\nconsole.log(x);\n');
	sh(dir, ['add', 'a.ts']);
	sh(dir, ['commit', '-m', 'init']);
	return dir;
}

const PATCH = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,2 @@
-const x = 1;
+const x = 2;
 console.log(x);
`;

describe('applyFixCommit', () => {
	it('applies the patch and commits it', async () => {
		const dir = await seedRepo();
		const { sha } = await applyFixCommit({
			sandboxPath: dir,
			patch: PATCH,
			summary: 'Bump x.',
			file: 'a.ts',
			line: 1,
			message: 'x should be 2'
		});
		expect(sha).toMatch(/^[0-9a-f]{40}$/);
		expect(await readFile(join(dir, 'a.ts'), 'utf8')).toContain('const x = 2;');
	});

	it('rejects patches that do not apply', async () => {
		const dir = await seedRepo();
		const stale = PATCH.replace('const x = 1;', 'const y = 1;');
		await expect(
			applyFixCommit({
				sandboxPath: dir,
				patch: stale,
				summary: 'Bump x.',
				file: 'a.ts',
				line: 1,
				message: 'x should be 2'
			})
		).rejects.toMatchObject({ status: 409 });
	});

	it('rejects non-diff output', async () => {
		const dir = await seedRepo();
		await expect(
			applyFixCommit({
				sandboxPath: dir,
				patch: 'just rewrite it',
				summary: 'Rewrite.',
				file: 'a.ts',
				line: 1,
				message: 'rewrite'
			})
		).rejects.toBeInstanceOf(FixError);
	});
});
