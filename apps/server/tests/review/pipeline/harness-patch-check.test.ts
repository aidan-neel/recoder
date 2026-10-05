import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { patchFromEdits } from '../../../src/review/fixes/fix-edits';
import { PATCH_FILE, patchCheckCommand } from '../../../src/review/pipeline/harness/patch-check';
import { git } from '../../helpers/git';

let root = '';

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'recoder-patch-check-'));
	await writeFile(join(root, 'a.ts'), 'const value = old;\n');
	git(root, ['init', '-q', '-b', 'main']);
	git(root, ['add', '.']);
	git(root, ['commit', '-qm', 'base']);
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

/** Runs the check command in the repo the way the sandbox does: one shell command, patch file beside it. */
function exitOf(check: string): number {
	return Bun.spawnSync(['sh', '-c', patchCheckCommand(check)], { cwd: root, stdout: 'pipe', stderr: 'pipe' }).exitCode;
}

test('the check runs against the patched tree in the same command that applies the patch', async () => {
	const diff = await patchFromEdits(root, [{ file: 'a.ts', find: 'old', replace: 'renamed' }]);

	await writeFile(join(root, PATCH_FILE), diff);

	expect(exitOf('grep -q renamed a.ts')).toBe(0);
	expect(exitOf('grep -q "= old" a.ts')).not.toBe(0);
});

test('a patch that does not apply fails the check even when the check alone would pass', async () => {
	await writeFile(join(root, PATCH_FILE), 'not a patch\n');

	expect(exitOf('false || true')).not.toBe(0);
});
