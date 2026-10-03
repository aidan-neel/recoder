import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from '../../commands/runner.js';

/** Check a suggested patch against a checkout without applying it. */
export async function patchApplies(sandboxPath: string, patch: string): Promise<boolean> {
	const dir = await mkdtemp(join(tmpdir(), 'recoder-fix-'));
	const file = join(dir, 'fix.patch');

	try {
		await writeFile(file, patch.endsWith('\n') ? patch : `${patch}\n`);

		const run = await runCommand({
			label: 'fix apply check',
			command: 'git',
			args: ['apply', '--recount', '--check', file],
			cwd: sandboxPath
		});

		return run.status === 'succeeded';
	} catch {
		return false;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
