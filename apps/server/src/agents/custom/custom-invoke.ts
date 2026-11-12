import type { TokenUsage } from '@recoder/shared';
import { LlmError } from '../../models/llm/errors';
import { LineSplitter, streamCli, type CliExit } from '../cli-stream';
import type { AgentEvent } from '../contract';
import type { CustomCommand } from './custom-config';
import {
	PROTOCOL,
	PROTOCOL_VERSION,
	failureError,
	parseEvent,
	type CommandEvent,
	type DescribeRequest,
	type TurnRequest
} from './custom-protocol';
import { quotedLine } from '../quoted-line';

/** Where and how a command runs: its configuration, environment and working directory, and the processes in flight. */
export interface CommandHost {
	command: CustomCommand;
	env: Record<string, string>;
	cwd: string;
	running: Set<Bun.Subprocess>;
}

type Ending = Extract<CommandEvent, { type: 'result' | 'describe' }>;

type Result = Extract<CommandEvent, { type: 'result' }>;

type Description = Extract<CommandEvent, { type: 'describe' }>;

/** Longest stretch of stderr quoted in an error. */
const QUOTED_CHARS = 300;

/** Runs one turn; see {@link runCommand}. Throws when the command answers with anything but a result. */
export async function runTurn(
	host: CommandHost,
	request: TurnRequest,
	signal: AbortSignal,
	onEvent: (event: AgentEvent) => void
): Promise<Result> {
	const ending = await runCommand(host, request, signal, onEvent);

	if (ending.type !== 'result') throw new LlmError(0, `${host.command.name} answered a turn with a describe event.`);

	return ending;
}

/** Asks the command who it is and what it runs. Throws when it answers with anything but a description. */
export async function runDescribe(host: CommandHost, signal: AbortSignal): Promise<Description> {
	const request: DescribeRequest = { protocol: PROTOCOL, version: PROTOCOL_VERSION, kind: 'describe' };
	const ending = await runCommand(host, request, signal, () => {});

	if (ending.type !== 'describe') throw new LlmError(0, `${host.command.name} answered describe with a result.`);

	return ending;
}

/**
 * Runs the command on one request and reads its events. Progress goes to `onEvent` as the contract's events; the
 * `result` (for a turn) or `describe` event is returned. Throws an `LlmError` for an `error` event, an invalid
 * line, output after the ending event, a failed exit, or an exit without an ending; the process group is killed
 * at the first invalid line.
 */
async function runCommand(
	host: CommandHost,
	request: DescribeRequest | TurnRequest,
	signal: AbortSignal,
	onEvent: (event: AgentEvent) => void
): Promise<Ending> {
	const { name } = host.command;
	const reader = new EventReader(name, onEvent);
	const lines = new LineSplitter(reader.line);

	const exit = await streamCli({
		argv: host.command.argv,
		cwd: host.cwd,
		env: host.env,
		stdin: JSON.stringify(request),
		signal,
		maxOutputBytes: host.command.maxOutputBytes,
		onOutput: lines.push,
		running: host.running,
		name
	});

	lines.end();

	return reader.ending(exit);
}

/** A usage event as the contract's usage; a count the command left out is unknown. */
function tokenUsage(event: Extract<CommandEvent, { type: 'usage' }>): TokenUsage {
	const inputTokens = event.inputTokens ?? null;
	const outputTokens = event.outputTokens ?? null;

	return {
		inputTokens,
		outputTokens,
		totalTokens: inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null,
		cachedInputTokens: event.cachedInputTokens ?? null,
		cacheWriteInputTokens: event.cacheWriteInputTokens ?? null,
		reasoningOutputTokens: event.reasoningOutputTokens ?? null
	};
}

/** The last non-empty line of the command's stderr, cut short, for an error message. */
function stderrLine(stderr: string): string | undefined {
	const line = stderr.trim().split('\n').at(-1)?.trim();

	return line ? quotedLine(line, QUOTED_CHARS) : undefined;
}

/** Reads a command's events in order: progress until the one event that ends the request. */
class EventReader {
	private ended: Ending | null = null;
	private failure: LlmError | null = null;
	private steps = 0;

	constructor(
		private readonly name: string,
		private readonly onEvent: (event: AgentEvent) => void
	) {}

	readonly line = (line: string): void => {
		if (this.ended || this.failure) throw new LlmError(0, `${this.name} printed more after its last event.`);

		const event = parseEvent(line, this.name);

		if (event.type === 'result' || event.type === 'describe') this.ended = event;
		else if (event.type === 'error') this.failure = failureError(event.kind, event.message, this.name);
		else this.progress(event);
	};

	/** What the request ended with, now the command has exited. */
	ending(exit: CliExit): Ending {
		if (this.failure) throw this.failure;
		if (exit.code !== 0) throw this.exitError(exit);
		if (!this.ended) throw new LlmError(0, `${this.name} exited without a result.`);

		return this.ended;
	}

	private exitError({ code, stderr }: CliExit): LlmError {
		const quoted = stderrLine(stderr);

		return new LlmError(0, `${this.name} exited with code ${code}${quoted ? `: ${quoted}` : '.'}`);
	}

	private progress(event: Exclude<CommandEvent, Ending | { type: 'error' }>): void {
		const partId = `custom_${this.steps}`;

		if (event.type === 'step') {
			this.steps++;
			this.onEvent({ type: 'step-start', step: event.id });
		} else if (event.type === 'text') this.onEvent({ type: 'text', delta: event.text, partId });
		else if (event.type === 'reasoning') this.onEvent({ type: 'reasoning', delta: event.text, partId });
		else if (event.type === 'usage') this.onEvent({ type: 'usage', usage: tokenUsage(event), step: event.id });
		else this.onEvent({ type: 'error', message: `${this.name}: ${event.message}` });
	}
}
