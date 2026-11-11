#!/usr/bin/env bun
import { parseInvocation, type Invocation } from './args/command.js';
import { splitAudience } from './audience.js';
import { EXIT, type ExitCode } from './exit.js';
import { reportFailure } from './failure.js';
import { writeStdout } from './output/streams.js';
import { runProgram } from './program.js';
import { processTerminal, type Terminal } from './terminal/terminal.js';
import { VERSION } from '../version.js';

await runProgram(Bun.argv.slice(2), runCli);

/** Runs one command and returns the exit code. Every error is reported on standard error, with no stack. */
async function runCli(argv: string[]): Promise<ExitCode> {
	const { audience, argv: command } = splitAudience(argv);
	const terminal = processTerminal(audience);

	try {
		return await execute(parseInvocation(command, { workingDirectory: process.cwd(), audience }), terminal);
	} catch (error) {
		return reportFailure(error, command, terminal);
	}
}

/** Each command loads only the modules it needs, so the run commands start fast and never load the pipeline. */
async function execute(invocation: Invocation, terminal: Terminal): Promise<ExitCode> {
	switch (invocation.command) {
		case 'help':
			return print((await import('./args/help.js')).renderHelp(invocation.topic, terminal.out));
		case 'version':
			return print(VERSION);
		case 'doctor':
			return (await import('./doctor/doctor-command.js')).runDoctorCommand(terminal);
		case 'init':
			return (await import('./init/init-command.js')).runInitCommand(invocation.request, terminal);
		case 'upgrade':
			return (await import('./upgrade/upgrade-command.js')).runUpgradeCommand(invocation.request, terminal);
		case 'review':
			return (await import('./runs/review-command.js')).runReviewCommand(invocation, terminal);
		case 'status':
			return (await import('./runs/status-command.js')).runStatusCommand(invocation.run, terminal);
		case 'wait':
			return (await import('./runs/wait-command.js')).runWaitCommand(invocation.run, invocation.timeoutMs, terminal);
		case 'result':
			return (await import('./runs/result-command.js')).runResultCommand(invocation.run, invocation.output, terminal);
		case 'cancel':
			return (await import('./runs/cancel-command.js')).runCancelCommand(invocation.run, terminal);
		case 'runs':
			return (await import('./runs/list-command.js')).runListCommand(invocation.query, terminal);
		case 'models':
			return (await import('./models/models-command.js')).runModelsCommand(invocation.query, terminal);
		case 'mcp':
			return (await import('./mcp/mcp-command.js')).runMcpCommand();
		case 'skill':
			return (await import('./skill/skill-command.js')).runSkillCommand(invocation.argv, process.cwd(), terminal);
	}
}

async function print(text: string): Promise<ExitCode> {
	await writeStdout(`${text}\n`);

	return EXIT.ok;
}
