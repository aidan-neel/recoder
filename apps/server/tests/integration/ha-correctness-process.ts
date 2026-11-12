import { subprocessOutput } from '../helpers/subprocess-output';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { HaProcesses } from './ha-processes';

export async function runCorrectnessProcess(url: string, program: string): Promise<string> {
	const fixture = new HaProcesses(url);
	const directory = await mkdtemp(join(tmpdir(), 'recoder-ha-correctness-'));
	let child: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined;

	try {
		await fixture.initialize();

		child = Bun.spawn([process.execPath, '-e', program], {
			cwd: resolve(import.meta.dir, '../../../..'),
			stdin: 'ignore',
			stdout: 'pipe',
			stderr: 'pipe',
			env: {
				...process.env,
				HOME: directory,
				RECODER_DATA_DIR: join(directory, 'data'),
				RECODER_WORKDIR: join(directory, 'work'),
				RECODER_DATABASE_URL: fixture.databaseUrl,
				RECODER_OPENCODE_BIN: '',
				RECODER_CLAUDE_BIN: '',
				GH_TOKEN: '',
				GITLAB_TOKEN: ''
			}
		});

		const timeout = setTimeout(() => child?.kill('SIGKILL'), 10_000);

		try {
			const stdout = await subprocessOutput(child);

			return stdout;
		} finally {
			clearTimeout(timeout);
		}
	} finally {
		if (child?.exitCode === null) child.kill('SIGKILL');
		await child?.exited;
		await fixture.close();
		await rm(directory, { recursive: true, force: true });
	}
}
