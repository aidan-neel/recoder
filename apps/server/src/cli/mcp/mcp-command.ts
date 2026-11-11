import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { EXIT, type ExitCode } from '../exit.js';
import { writeStdout } from '../output/streams.js';
import { redirectConsoleToStderr } from '../run/quiet-console.js';
import { selfCommand } from '../self-command.js';
import { spawnDetached } from '../runs/detach.js';
import { SYSTEM_CLOCK } from '../runs/wait-for-run.js';
import { abortOnSignal } from '../signals/abort-on-signal.js';
import { serveMcp } from './mcp-server.js';
import type { ToolEnvironment } from './tool.js';

/** The command line's entry. From source, a background review runs it as `recoder review`, whatever started this server. */
const CLI_ENTRY = fileURLToPath(new URL('../main.ts', import.meta.url));

/**
 * `recoder mcp`: serves MCP over standard input and output until the client closes the input, or until SIGINT or
 * SIGTERM. Standard output carries protocol messages only, so console output goes to standard error meanwhile.
 * Reviews the server started go on after it ends; `recoder_runs` finds them again.
 */
export async function runMcpCommand(): Promise<ExitCode> {
	const stop = abortOnSignal();
	const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
	const restoreConsole = redirectConsoleToStderr();

	stop.addEventListener('abort', () => input.close(), { once: true });

	try {
		await serveMcp({ lines: input, writeLine: (line) => writeStdout(`${line}\n`) }, processEnvironment());
	} finally {
		input.close();
		restoreConsole();
	}

	return stop.aborted ? EXIT.cancelled : EXIT.ok;
}

/** The real environment: this process's working directory and clock, and reviews started as `--detach` starts them. */
function processEnvironment(): ToolEnvironment {
	return {
		workingDirectory: process.cwd(),
		clock: SYSTEM_CLOCK,
		reviewCommand: [...selfCommand(CLI_ENTRY), 'review'],
		spawn: spawnDetached,
		stopProcess: (pid) => process.kill(pid, 'SIGTERM')
	};
}
