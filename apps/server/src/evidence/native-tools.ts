import { normalizeActions } from './parse-actions.js';
import type { ActionName, RetrievalAction } from './types.js';

/** One evidence action as a tool a model calls directly, rather than a JSON request Recoder parses. */
export interface NativeTool {
	name: string;
	action: ActionName;
	description: string;
	inputSchema: Record<string, unknown>;
}

const str = { type: 'string' };
const int = { type: 'integer' };
const revision = { type: 'string', enum: ['head', 'target', 'mergeBase'], description: 'Defaults to head.' };
const cursor = { type: 'string', description: 'The continuation token of a truncated result, for its next page.' };

function tool(
	name: string,
	action: ActionName,
	description: string,
	properties: Record<string, unknown>,
	required: string[]
): NativeTool {
	return { name, action, description, inputSchema: { type: 'object', properties, required } };
}

const READ_TOOLS: NativeTool[] = [
	tool(
		'read_diff',
		'readDiff',
		'Read the pull request patch for one file, or for the hunks named.',
		{ path: str, hunkIds: { type: 'array', items: str }, cursor },
		[]
	),
	tool(
		'read_file',
		'readFile',
		'Read lines of a repository file at a revision. At most 200 lines per call.',
		{ revision, path: str, startLine: int, endLine: int },
		['path']
	),
	tool(
		'search',
		'search',
		'Search the repository for a literal string (not a regex).',
		{ revision, query: str, prefix: { type: 'string', description: 'Only search under this directory.' }, cursor },
		['query']
	),
	tool(
		'list_files',
		'listFiles',
		'List repository files, optionally under a directory prefix.',
		{ revision, prefix: str, cursor },
		[]
	)
];

const EXEC_TOOLS: NativeTool[] = [
	tool(
		'run',
		'run',
		'Run a shell command from the repository root on the PR head, inside the review sandbox (no network, no secrets). Its output and exit code become evidence you can cite.',
		{ command: str, timeoutSec: { type: 'integer', description: 'Default 120, at most 300.' } },
		['command']
	),
	tool(
		'write_file',
		'writeFile',
		'Write a new, untracked scratch file in the sandbox checkout, for example a repro test to run.',
		{ path: str, content: str },
		['path', 'content']
	)
];

const DELEGATE_TOOL = tool(
	'delegate',
	'delegate',
	'Hand one narrow, self-contained evidence task to a worker on a cheaper model, for example finding the callers of a function or running a repro. It returns a short answer and the evidence ids it gathered.',
	{ task: { type: 'string', description: 'What to find or run, and what to return. The worker sees nothing else.' } },
	['task']
);

/** Every tool; `exec` tools run code and are offered only to agents with a sandbox, `delegate` only to agents with a worker. */
export const NATIVE_TOOLS: NativeTool[] = [...READ_TOOLS, ...EXEC_TOOLS, DELEGATE_TOOL];

/** What an agent may do besides read: run code in the sandbox, and hand tasks to a worker. */
export interface ToolOffer {
	exec: boolean;
	delegate: boolean;
}

function offered({ exec, delegate }: ToolOffer): NativeTool[] {
	return [...READ_TOOLS, ...(exec ? EXEC_TOOLS : []), ...(delegate ? [DELEGATE_TOOL] : [])];
}

/** The tools an agent may call: reads always, the sandbox when it can run code, `delegate` when it has a worker. */
export function nativeToolNames(offer: ToolOffer): string[] {
	return offered(offer).map((item) => item.name);
}

/** A tool call as the action it stands for; null when the tool is unknown or not offered. */
export function toolAction(name: string, args: unknown, offer: ToolOffer): RetrievalAction | null {
	const known = offered(offer).find((item) => item.name === name);

	if (!known) return null;

	const fields = args && typeof args === 'object' && !Array.isArray(args) ? args : {};

	return normalizeActions([{ ...fields, action: known.action }])[0] ?? null;
}
