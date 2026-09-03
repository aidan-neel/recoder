export interface PipelineStep {
	label: string;
	command: string;
	args: string[];
}

/**
 * Named review pipeline steps.
 *
 * Today these are `echo` stubs so the queued → running → passed/failed flow
 * works end to end with zero external dependencies. To plug in a real
 * reviewer (e.g. an OpenCode-style agent binary):
 *
 * 1. Add the binary to RECODER_ALLOWED_COMMANDS.
 * 2. Return its argv here (optionally per-repo/PR via `ctx`).
 * 3. Parse its output into findings in pipeline.ts.
 */
export function demoReviewSteps(ctx: { repo: string; pr: string }): PipelineStep[] {
	return [
		{
			label: 'collect diff',
			command: 'echo',
			args: [`[recoder] collecting diff for ${ctx.repo} PR #${ctx.pr}`]
		},
		{ label: 'run checks', command: 'echo', args: ['[recoder] running checks (stub)'] },
		{ label: 'write summary', command: 'echo', args: ['[recoder] writing summary (stub)'] }
	];
}
