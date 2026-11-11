#!/usr/bin/env bun
import { parseInvocation, usageHint, type Invocation } from './args/command.js';
import { CliError, EXIT, describeError, loadOrNotReady, type ExitCode } from './exit.js';
import { writeStderrLine, writeStdout } from './output/streams.js';
import { runProgram } from './program.js';

const JSON_INDENT = 2;

await runProgram(Bun.argv.slice(2), runCli);

/** Runs one command and returns the exit code. Every error ends as one line on standard error, with no stack. */
async function runCli(argv: string[]): Promise<ExitCode> {
	try {
		return await execute(parseInvocation(argv, process.cwd()));
	} catch (error) {
		return reportFailure(error, argv);
	}
}

/** Each command loads only the modules it needs, so the run commands start fast and never load the pipeline. */
async function execute(invocation: Invocation): Promise<ExitCode> {
	switch (invocation.command) {
		case 'print':
			await writeStdout(`${invocation.text}\n`);

			return EXIT.ok;
		case 'doctor':
			return runDoctorCommand();
		case 'review':
			return (await import('./runs/review-command.js')).runReviewCommand(invocation);
		case 'status':
			return (await import('./runs/status-command.js')).runStatusCommand(invocation.runId);
		case 'wait':
			return (await import('./runs/wait-command.js')).runWaitCommand(invocation.runId, invocation.timeoutMs);
		case 'result':
			return (await import('./runs/result-command.js')).runResultCommand(invocation.runId, invocation.output);
		case 'cancel':
			return (await import('./runs/cancel-command.js')).runCancelCommand(invocation.runId);
		case 'runs':
			return (await import('./runs/list-command.js')).runListCommand(invocation.query);
		case 'models':
			return (await import('./models/models-command.js')).runModelsCommand(invocation.query);
		case 'mcp':
			return (await import('./mcp/mcp-command.js')).runMcpCommand();
		case 'skill':
			return (await import('./skill/skill-command.js')).runSkillCommand(invocation.argv, process.cwd());
	}
}

async function runDoctorCommand(): Promise<ExitCode> {
	const { runDoctor } = await loadOrNotReady(() => import('./doctor/doctor.js'));
	const report = await runDoctor();

	await writeStdout(`${JSON.stringify(report, null, JSON_INDENT)}\n`);

	return report.ok ? EXIT.ok : EXIT.notReady;
}

function reportFailure(error: unknown, argv: string[]): ExitCode {
	writeStderrLine(`recoder: ${describeError(error)}`);

	if (!(error instanceof CliError)) return EXIT.failed;

	if (error.exitCode === EXIT.usage) writeStderrLine(usageHint(argv));

	return error.exitCode;
}
