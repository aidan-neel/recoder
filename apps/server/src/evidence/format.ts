import type { RetrievalAction, ToolCallReport, ToolResult } from './types.js';

/** Characters of a result the dashboard preview keeps. */
const PREVIEW_CHARS = 12_000;

/** The shell-like line the dashboard shows for an action, e.g. `read src/a.ts:1-40`. */
export function actionCommand(action: RetrievalAction): string {
	switch (action.action) {
		case 'search':
			return `search ${JSON.stringify(action.query ?? '')} ${action.prefix || '.'}`;
		case 'readFile':
			return `read${action.path ? ` ${action.path}` : ''}${
				action.startLine ? `:${action.startLine}-${action.endLine ?? action.startLine}` : ''
			}`;
		case 'listFiles':
			return `list ${action.prefix || '.'}`;
		case 'readDiff':
			return `readDiff ${action.path ?? 'scoped hunks'}`;
		case 'run':
			return `$ ${action.command ?? ''}`;
		case 'writeFile':
			return `write ${action.path ?? ''}`;

		default: {
			const name = (action as { action?: unknown }).action;

			return typeof name === 'string' && name.trim() ? name : 'Unknown tool';
		}
	}
}

/** Short outcome line for the dashboard, e.g. `3 matches`, `a.ts:1-40` or `exit 1`. */
function toolSummary(result: ToolResult): string {
	if (result.action === 'run') {
		if (result.exitCode === null || result.exitCode === undefined) return result.error ?? 'timed out';

		return `exit ${result.exitCode}${result.cached ? ' · cached' : ''}`;
	}

	if (!result.ok) return result.error ?? 'failed';
	if (result.action === 'search') return `${result.matches ?? 0} match${result.matches === 1 ? '' : 'es'}`;
	if (result.path)
		return `${result.path}${result.startLine ? `:${result.startLine}-${result.endLine ?? result.startLine}` : ''}`;

	return result.truncated ? 'truncated' : 'ok';
}

/** What the dashboard shows as the tool's input: file content is the result, not the request. */
export function reportedInput(action: RetrievalAction): ToolCallReport['input'] {
	const { content: _content, ...rest } = action;

	return rest;
}

/** The finished report for a tool call. Only `run` is a process, so retrievals report no exit code. */
export function finishedReport(
	started: Omit<ToolCallReport, 'status' | 'exitCode'>,
	startedMs: number,
	result: ToolResult
): ToolCallReport {
	return {
		...started,
		status: result.ok ? 'done' : 'error',
		exitCode: result.exitCode ?? null,
		finishedAt: new Date().toISOString(),
		elapsedMs: result.cached ? result.elapsedMs : Date.now() - startedMs,
		...(result.cached ? { cached: true } : {}),
		summary: toolSummary(result),
		result: {
			content: result.content.slice(0, PREVIEW_CHARS),
			truncated: result.truncated || result.content.length > PREVIEW_CHARS,
			evidenceId: result.evidenceId,
			revision: result.revision,
			path: result.path,
			error: result.error
		}
	};
}

/** Tool results as the text block fed back to the agent, one header line per result. */
export function formatToolResults(results: ToolResult[]): string {
	return results
		.map((result) => {
			const header = [
				`action=${result.action}`,
				result.ok ? 'ok' : 'error',
				result.evidenceId ? `evidenceId=${result.evidenceId}` : '',
				result.path ? `path=${result.path}` : '',
				result.revision ? `revision=${result.revision}` : '',
				result.startLine ? `lines=${result.startLine}-${result.endLine}` : '',
				result.truncated ? 'truncated=true' : '',
				result.continuation ? `continuation=${result.continuation}` : '',
				result.error ? `error=${result.error}` : ''
			]
				.filter(Boolean)
				.join(' ');

			return `--- ${header} ---\n${result.content}`;
		})
		.join('\n\n');
}
