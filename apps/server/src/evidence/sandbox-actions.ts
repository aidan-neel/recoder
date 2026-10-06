import { REVIEW_POLICY } from '../review/session/review-policy.js';
import type { ExecWorkspace } from '../sandbox/exec-workspace.js';
import { sanitizeRepoPath } from './paths.js';
import { failure, type EvidenceRecord, type ExecutionOutcome, type RetrievalAction, type ToolResult } from './types.js';

/** Where `run` and `writeFile` execute; `exec` is null when the review is read-only, and `execUnavailable` says why. */
export interface SandboxContext {
	exec: ExecWorkspace | null;
	execUnavailable: string;
}

/** A finished run: the result for the agent and, when it ran, the record to keep as evidence. */
interface RunOutcome {
	result: ToolResult;
	record?: Omit<EvidenceRecord, 'id'>;
}

function runTimeoutMs(action: RetrievalAction): number {
	const seconds =
		typeof action.timeoutSec === 'number' && action.timeoutSec > 0
			? action.timeoutSec
			: REVIEW_POLICY.defaultRunTimeoutMs / 1000;

	return Math.min(seconds * 1000, REVIEW_POLICY.maxRunTimeoutMs);
}

/** Runs a shell command offline. A failing command is still evidence; only a run that never finished is an error. */
export async function runCommand(
	context: SandboxContext,
	action: RetrievalAction,
	signal?: AbortSignal,
	owner?: string
): Promise<RunOutcome> {
	const command = typeof action.command === 'string' ? action.command.trim() : '';

	if (!command || command.length > 4000) return { result: failure('run', 'command must be 1–4000 characters') };
	if (!context.exec) return { result: failure('run', context.execUnavailable) };

	const result = await context.exec.runInvestigation(command, runTimeoutMs(action), signal, owner);

	const status = result.timedOut
		? `timed out after ${(result.elapsedMs / 1000).toFixed(1)}s`
		: `exit ${result.exitCode} · ${(result.elapsedMs / 1000).toFixed(1)}s`;

	const content = `$ ${command}\n${result.output}${result.output.endsWith('\n') || !result.output ? '' : '\n'}[${status}]`;

	return {
		result: {
			action: 'run',
			ok: !result.timedOut,
			error: result.timedOut ? status : undefined,
			content,
			truncated: result.truncated,
			exitCode: result.exitCode,
			elapsedMs: result.elapsedMs,
			...(result.outcome ? { outcome: result.outcome } : {})
		},
		record: runRecord(command, content, result.truncated, result.exitCode, owner, result.outcome)
	};
}

/** The evidence record of a finished run of `command`, whose `content` is the command, its output and its status line. */
export function runRecord(
	command: string,
	content: string,
	truncated: boolean,
	exitCode: number | null,
	owner?: string,
	outcome?: ExecutionOutcome
): Omit<EvidenceRecord, 'id'> {
	return {
		revision: 'head',
		path: '',
		startLine: 1,
		endLine: 1,
		content,
		truncated,
		kind: 'run',
		command,
		exitCode,
		...(owner ? { agentId: owner } : {}),
		...(outcome ? { outcome } : {})
	};
}

/** Describes a non-string `content` so the model can see what it sent wrong. */
function contentShape(content: unknown): string {
	if (content === undefined) return 'no content field';

	return Array.isArray(content) ? 'an array' : typeof content;
}

/** Writes a whole file into the sandbox checkout and echoes it back. */
export async function writeSandboxFile(
	context: SandboxContext,
	action: RetrievalAction,
	signal?: AbortSignal,
	owner?: string
): Promise<ToolResult> {
	const path = sanitizeRepoPath(action.path);

	if (!path) return failure('writeFile', 'invalid path');

	if (typeof action.content !== 'string') {
		return failure('writeFile', `"content" must be the whole file as one string; got ${contentShape(action.content)}`, {
			path
		});
	}

	if (!context.exec) return failure('writeFile', context.execUnavailable, { path });

	const written = await context.exec.writeFile(path, action.content, signal, owner);

	if (!written.ok) return failure('writeFile', written.error, { path });

	const lines = action.content.split('\n').length;

	return {
		action: 'writeFile',
		ok: true,
		path,
		content: `Wrote ${path} (${lines} line${lines === 1 ? '' : 's'}).\n${action.content}`,
		truncated: false
	};
}
