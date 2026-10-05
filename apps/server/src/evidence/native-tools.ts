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

/** Every evidence tool; `exec` tools run code and are offered only to agents with a sandbox. */
export const NATIVE_TOOLS: NativeTool[] = [...READ_TOOLS, ...EXEC_TOOLS];

/** The tools an agent may call: reads always, the sandbox when it can run code. */
export function nativeToolNames(exec: boolean): string[] {
	return (exec ? NATIVE_TOOLS : READ_TOOLS).map((item) => item.name);
}

/** A tool call as the evidence action it stands for; null when the tool is unknown or not offered. */
export function toolAction(name: string, args: unknown, exec: boolean): RetrievalAction | null {
	const known = (exec ? NATIVE_TOOLS : READ_TOOLS).find((item) => item.name === name);

	if (!known) return null;

	const fields = args && typeof args === 'object' && !Array.isArray(args) ? args : {};

	return normalizeActions([{ ...fields, action: known.action }])[0] ?? null;
}
