/** The program's entry, for a test that starts it and has to signal it while it runs. */
export const MAIN_ENTRY = new URL('../../src/cli/main.ts', import.meta.url).pathname;

/** Where and with which variables `recoder` runs. */
interface MainSetup {
	env: Record<string, string>;
	cwd?: string;
}

/** Runs `recoder` as the command line does, its output piped, and returns what it wrote and how it ended. */
export async function runMain(args: string[], setup: MainSetup) {
	const child = Bun.spawn([process.execPath, MAIN_ENTRY, ...args], { ...setup, stdout: 'pipe', stderr: 'pipe' });

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited
	]);

	return { stdout, stderr, exitCode };
}
