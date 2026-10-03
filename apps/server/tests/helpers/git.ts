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
