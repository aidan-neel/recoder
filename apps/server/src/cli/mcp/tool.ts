import { z } from 'zod';
import { describeError } from '../exit.js';
import type { DetachRequest } from '../runs/detach.js';
import type { WaitClock } from '../runs/wait-for-run.js';
import type { PendingStarts } from './pending-starts.js';

/** What the tools reach outside the server; injected so tests own the clock and the processes started. */
export interface ToolEnvironment {
	/** Where `repo` and other relative paths resolve: the server's working directory. */
	workingDirectory: string;
	clock: WaitClock;
	/** The argv that runs `recoder review`; a background review's flags follow it. */
	reviewCommand: readonly string[];
	spawn: DetachRequest['spawn'];
	/** Asks a run's process to stop: SIGTERM, as `recoder cancel` sends it. */
	stopProcess: (pid: number) => void;
}

/** The commands this server offers as tools, each as `recoder_<command>`. */
const TOOL_COMMANDS = ['doctor', 'models', 'review', 'wait', 'status', 'result', 'cancel', 'runs'];

/**
 * A hint written for the command line, such as "run recoder runs" or "Run `recoder doctor`": the verb, then the
 * command. The verb is part of the pattern, so "recoder runs" inside a path or any other data is never taken for one.
 */
const COMMAND_HINT = new RegExp(`\\b([Rr])un \`?recoder (${TOOL_COMMANDS.join('|')})\\b\`?`, 'g');

/** One tool call: the environment, the server's pending starts, and the signal that ends the call early. */
export interface ToolCallContext {
	environment: ToolEnvironment;
	starts: PendingStarts;
	/** Aborts on the client's cancel, or when the server stops. */
	signal: AbortSignal;
}

/** What `tools/call` returns: one text item, and whether the tool failed. */
export interface ToolResult {
	content: { type: 'text'; text: string }[];
	isError: boolean;
}

/** A tool as `tools/list` shows it and `tools/call` runs it. */
export interface McpTool {
	definition: { name: string; description: string; inputSchema: z.core.JSONSchema.JSONSchema };
	/** Checks the arguments, then runs. Never rejects: a failure is a result with `isError`. */
	call: (args: Record<string, unknown>, context: ToolCallContext) => Promise<ToolResult>;
}

interface ToolSpec<Input> {
	name: string;
	description: string;
	input: z.ZodType<Input>;
	run: (input: Input, context: ToolCallContext) => Promise<ToolResult>;
}

/**
 * A tool whose input schema is advertised and checked from the same zod schema. Bad arguments and a failed run are
 * tool results with `isError` and one line of text, as MCP asks for errors a model can act on.
 */
export function defineTool<Input>(spec: ToolSpec<Input>): McpTool {
	return {
		definition: { name: spec.name, description: spec.description, inputSchema: z.toJSONSchema(spec.input) },
		call: async (args, context) => {
			const input = spec.input.safeParse(args);

			if (!input.success) {
				return failedResult(`invalid arguments for ${spec.name}: ${oneLine(z.prettifyError(input.error))}`);
			}

			try {
				return await spec.run(input.data, context);
			} catch (error) {
				return failedCommandResult(oneLine(describeError(error)));
			}
		}
	};
}

/** A result holding a value as one line of JSON. */
export function jsonResult(value: unknown): ToolResult {
	return textResult(JSON.stringify(value));
}

export function textResult(text: string): ToolResult {
	return { content: [{ type: 'text', text }], isError: false };
}

/** A failed result carrying `text` as it is, for data such as a serialized status that must not be rewritten. */
export function failedResult(text: string): ToolResult {
	return { content: [{ type: 'text', text }], isError: true };
}

/**
 * A failed result for a message the command line's own code wrote. Such a message tells the reader to run a command;
 * an agent here has tools, so each hint names the tool that stands for the command.
 */
export function failedCommandResult(message: string): ToolResult {
	return failedResult(message.replace(COMMAND_HINT, toolHint));
}

/** "run recoder wait" becomes "call recoder_wait", and "Run `recoder doctor`" becomes "Call recoder_doctor". */
function toolHint(_hint: string, verbInitial: string, command: string): string {
	return `${verbInitial === 'R' ? 'Call' : 'call'} recoder_${command}`;
}

function oneLine(text: string): string {
	return text.replace(/\s*\n\s*/g, ' ');
}
