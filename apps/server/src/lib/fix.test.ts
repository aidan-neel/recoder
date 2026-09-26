import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyFixCommit, FixError, locateEdit, patchFromEdits } from './fix';

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

describe('fix edits', () => {
	test('an edit copied with the excerpt line numbers still finds its place', () => {
		const content = 'function a() {\n\treturn 1;\n}\n';
		expect(locateEdit(content, '2: \treturn 1;')).toEqual({ start: 15, end: 25 });
	});

	test('an edit matching more than one place is refused', () => {
		expect(locateEdit('x = 1;\nx = 1;\n', 'x = 1;')).toBeNull();
	});

	it('a fix written before another fix in the same file still applies', async () => {
		const dir = await seedRepo();
		await applyFixCommit({ sandboxPath: dir, patch: PATCH, summary: 'Bump x.', file: 'a.ts', line: 1, message: 'x should be 2' });
		// Built when line 1 still said `const x = 1;`; the edit only touches line 2.
		const edits = [{ file: 'a.ts', find: 'console.log(x);', replace: 'console.info(x);' }];
		await applyFixCommit({ sandboxPath: dir, patch: PATCH, edits, summary: 'Use info.', file: 'a.ts', line: 2, message: 'use info' });
		expect(await readFile(join(dir, 'a.ts'), 'utf8')).toBe('const x = 2;\nconsole.info(x);\n');
	});

	it('an edit whose code is gone asks for the fix to be written again', async () => {
		const dir = await seedRepo();
		const edits = [{ file: 'a.ts', find: 'const y = 1;', replace: 'const y = 2;' }];
		await expect(applyFixCommit({ sandboxPath: dir, patch: PATCH, edits, summary: 's', file: 'a.ts', line: 1, message: 'm' }))
			.rejects.toMatchObject({ status: 409, message: expect.stringContaining('Write the fix again') });
	});

	it('patches built from edits use repo paths', async () => {
		const dir = await seedRepo();
		const patch = await patchFromEdits(dir, [{ file: 'a.ts', find: 'const x = 1;', replace: 'const x = 3;' }]);
		expect(patch).toContain('--- a/a.ts\n+++ b/a.ts\n');
		expect(patch).toContain('-const x = 1;\n+const x = 3;');
	});
});
