import { afterEach } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Runs git in `cwd` as a fixed test author, returning trimmed stdout; throws with stderr when git fails. */
export function git(cwd: string, args: string[]): string {
	const result = Bun.spawnSync(['git', ...args], {
		cwd,
		stdout: 'pipe',
		stderr: 'pipe',
		env: {
			...process.env,
			GIT_AUTHOR_NAME: 't',
			GIT_AUTHOR_EMAIL: 't@t',
			GIT_COMMITTER_NAME: 't',
			GIT_COMMITTER_EMAIL: 't@t'
		}
	});

	if (result.exitCode !== 0) throw new Error(result.stderr.toString());

	return result.stdout.toString().trim();
}

/**
 * Makes throwaway repos for the calling test file: each holds `files` in one
 * commit, and every repo is removed after the test that made it.
 */
export function useCommittedRepos(prefix: string): (files: Record<string, string>) => Promise<string> {
	const roots: string[] = [];

	afterEach(async () => {
		await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
	});

	return async (files) => {
		const root = await mkdtemp(join(tmpdir(), prefix));

		roots.push(root);
		git(root, ['init', '-q']);

		for (const [path, text] of Object.entries(files)) {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), text);
		}

		commitAll(root, 'files');

		return root;
	};
}

/** Stages and commits everything in the work tree, unsigned. */
export function commitAll(root: string, message: string): void {
	git(root, ['add', '-A']);
	git(root, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message]);
}
