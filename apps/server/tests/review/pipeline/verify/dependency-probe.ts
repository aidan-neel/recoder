import { expect } from 'bun:test';

/** Runs the bounded inspector/probe, asserting that setup itself succeeded before testing its data. */
export async function dependencyProbe(command: string[], cwd: string, env = process.env) {
	const child = Bun.spawn(command, { cwd, env, stdout: 'pipe', stderr: 'pipe' });

	const [output, error, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited
	]);

	expect(error).toBe('');
	expect(exitCode).toBe(0);

	return { output, exitCode, truncated: false };
}
