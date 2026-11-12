type PipedProcess = Pick<Bun.Subprocess<'ignore', 'pipe', 'pipe'>, 'exited' | 'stdout' | 'stderr'>;

export async function subprocessOutput(child: PipedProcess): Promise<string> {
	const [exit, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text()
	]);

	if (exit !== 0) throw new Error(stderr);

	return stdout;
}
