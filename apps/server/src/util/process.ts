/** A spawned process with piped stdout and stderr. */
interface PipedProcess {
	stdout: ReadableStream<Uint8Array>;
	stderr: ReadableStream<Uint8Array>;
	exited: Promise<number>;
}

/** What a finished process printed, and its exit code. */
export interface ProcessOutput {
	stdout: string;
	stderr: string;
	code: number;
}

/** Waits for the process to exit and reads both of its streams in full. */
export async function processOutput(proc: PipedProcess): Promise<ProcessOutput> {
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited
	]);

	return { stdout, stderr, code };
}
