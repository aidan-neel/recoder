import type { ReviewProgress, ReviewToolCall } from '@recoder/shared';

/** What the review does right now, as a verb and its object: `Reading` `src/limiter.ts, lines 61–84`. */
export interface RunActivity {
	/** Plain words: `Reading`, `Searching for`, `Running`. */
	verb: string;
	/** The file, the text or the command it acts on, shown as code; null when the verb says it all. */
	subject: string | null;
}

/** The prefix the server puts before a shell command in a tool's display line. */
const SHELL_PROMPT = '$ ';

/**
 * What the review does right now, from its newest tool call: the file it
 * reads, the text it searches for, the command it runs. Built from the
 * call's structured request, never from the server's log lines, which are
 * written for whoever debugs the pipeline. Null before the first call.
 */
export function runActivity(progress: ReviewProgress | null): RunActivity | null {
	const tools = progress?.toolCalls ?? [];
	const tool = tools.findLast((call) => call.status === 'running') ?? tools.at(-1);

	return tool ? describeTool(tool) : null;
}

function describeTool(tool: ReviewToolCall): RunActivity {
	const input = tool.input;

	switch (input?.action) {
		case 'readFile':
			return { verb: 'Reading', subject: input.path ? `${input.path}${lineRange(input)}` : null };
		case 'readDiff':
			return input.path
				? { verb: 'Reading the change to', subject: input.path }
				: { verb: 'Reading the change', subject: null };
		case 'search':
			return { verb: 'Searching for', subject: `${JSON.stringify(input.query ?? '')}${inFolder(input.prefix)}` };
		case 'listFiles':
			return input.prefix ? { verb: 'Listing', subject: input.prefix } : { verb: 'Listing the files', subject: null };
		case 'run':
			return { verb: 'Running', subject: input.command ?? withoutPrompt(tool.command) };
		case 'writeFile':
			return { verb: 'Writing', subject: input.path ?? null };
		case 'delegate':
			return { verb: 'Handing a check to a worker', subject: null };
		default:
			return { verb: 'Running', subject: withoutPrompt(tool.command) };
	}
}

/** `, lines 61–84` or `, line 61`; empty for a whole file. */
function lineRange(input: NonNullable<ReviewToolCall['input']>): string {
	if (!input.startLine) return '';

	const end = input.endLine ?? input.startLine;

	return end === input.startLine ? `, line ${input.startLine}` : `, lines ${input.startLine}–${end}`;
}

/** ` in src/rate-limit`; empty for the whole repository. */
function inFolder(prefix: string | undefined): string {
	return prefix && prefix !== '.' ? ` in ${prefix}` : '';
}

function withoutPrompt(command: string): string {
	return command.startsWith(SHELL_PROMPT) ? command.slice(SHELL_PROMPT.length) : command;
}
