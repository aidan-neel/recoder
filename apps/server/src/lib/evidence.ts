import { REVIEW_POLICY } from './review-policy.js';
import type { ReviewInventory } from './inventory.js';
import type { FileDiff, ReviewToolCall } from '@recoder/shared';
import type { ExecWorkspace } from './exec-workspace.js';

export type RevisionAlias = 'head' | 'target' | 'mergeBase';

export interface ReviewRevision {
	checkoutPath: string;
	checkoutKey?: string;
	headSha: string;
	targetSha: string;
	mergeBaseSha: string;
	targetRef: string;
}

export interface EvidenceRecord {
	id: string;
	revision: RevisionAlias;
	path: string;
	startLine: number;
	endLine: number;
	content: string;
	truncated: boolean;
	/** A command run in the review sandbox, rather than a read of repository content. */
	kind?: 'run';
	command?: string;
	exitCode?: number | null;
}

export interface RetrievalAction {
	action: 'listFiles' | 'readFile' | 'search' | 'readDiff' | 'run' | 'writeFile';
	revision?: string;
	path?: string;
	prefix?: string;
	startLine?: number;
	endLine?: number;
	query?: string;
	hunkIds?: string[];
	cursor?: string;
	/** run: shell command, executed offline in the review sandbox. */
	command?: string;
	timeoutSec?: number;
	/** writeFile: full file content. */
	content?: string;
}

/** Observable tool/retrieval call reported to the live review dashboard. */
export type ToolCallReport = Omit<ReviewToolCall, 'assignmentId' | 'role'>;

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

function toolSummary(result: ToolResult): string {
	if (result.action === 'run') {
		if (result.exitCode === null || result.exitCode === undefined) return result.error ?? 'timed out';
		return `exit ${result.exitCode}`;
	}
	if (!result.ok) return result.error ?? 'failed';
	if (result.action === 'search') return `${result.matches ?? 0} match${result.matches === 1 ? '' : 'es'}`;
	if (result.path) return `${result.path}${result.startLine ? `:${result.startLine}-${result.endLine ?? result.startLine}` : ''}`;
	return result.truncated ? 'truncated' : 'ok';
}

export interface ToolResult {
	action: string;
	ok: boolean;
	error?: string;
	evidenceId?: string;
	revision?: RevisionAlias;
	path?: string;
	startLine?: number;
	endLine?: number;
	content: string;
	truncated: boolean;
	continuation?: string | null;
	matches?: number;
	/** readDiff: the hunks whose patch text this result contains. */
	hunkIds?: string[];
	/** run: the command's exit code; null when it timed out or was stopped. */
	exitCode?: number | null;
}

const ALIASES: RevisionAlias[] = ['head', 'target', 'mergeBase'];

export class EvidenceStore {
	readonly records = new Map<string, EvidenceRecord>();
	private readonly cache = new Map<string, ToolResult>();
	private seq = 0;
	private toolSeq = 0;
	/** Where `run` and `writeFile` execute; null keeps the review read-only. */
	exec: ExecWorkspace | null = null;
	/** Why `exec` is null, shown to agents that ask to run something. */
	execUnavailable = 'Running code is unavailable in this review.';
	constructor(
		readonly revision: ReviewRevision | null,
		readonly inventory: ReviewInventory,
		readonly maxFileChars: number
	) {}

	providedIds(): Set<string> {
		return new Set(this.records.keys());
	}

	get(id: string): EvidenceRecord | undefined {
		return this.records.get(id);
	}

	/** Discover optional regular files before issuing observable read requests. */
	async existingFiles(revision: RevisionAlias, paths: readonly string[], signal?: AbortSignal): Promise<string[]> {
		const resolved = this.resolveRevision(revision);
		if ('error' in resolved) throw new Error(resolved.error);
		if (!paths.length) return [];
		if (paths.some((path) => !sanitizeRepoPath(path))) throw new Error('invalid path');
		if (!this.revision) return paths.filter((path) => this.inventory.files.some((file) => file.path === path));
		const listed = await git(this.revision.checkoutPath, ['ls-tree', '-z', resolved.sha, '--', ...paths], signal);
		if (listed.code !== 0) throw new Error(listed.stderr.slice(0, 400) || 'File discovery failed');
		const found = new Set<string>();
		for (const record of listed.stdout.split('\0')) {
			const tab = record.indexOf('\t');
			if (tab < 0) continue;
			const [mode, type] = record.slice(0, tab).split(/\s+/);
			if (type === 'blob' && (mode === '100644' || mode === '100755')) found.add(record.slice(tab + 1));
		}
		return paths.filter((path) => found.has(path));
	}

	private async run(action: RetrievalAction, signal?: AbortSignal): Promise<ToolResult> {
		const command = typeof action.command === 'string' ? action.command.trim() : '';
		if (!command || command.length > 4000) return { action: 'run', ok: false, error: 'command must be 1–4000 characters', content: '', truncated: false };
		if (!this.exec) return { action: 'run', ok: false, error: this.execUnavailable, content: '', truncated: false };
		const seconds = typeof action.timeoutSec === 'number' && action.timeoutSec > 0 ? action.timeoutSec : REVIEW_POLICY.defaultRunTimeoutMs / 1000;
		const result = await this.exec.run(command, Math.min(seconds * 1000, REVIEW_POLICY.maxRunTimeoutMs), signal);
		const status = result.timedOut ? `timed out after ${(result.elapsedMs / 1000).toFixed(1)}s` : `exit ${result.exitCode} · ${(result.elapsedMs / 1000).toFixed(1)}s`;
		const content = `$ ${command}\n${result.output}${result.output.endsWith('\n') || !result.output ? '' : '\n'}[${status}]`;
		const stored = this.remember({ revision: 'head', path: '', startLine: 1, endLine: 1, content, truncated: result.truncated, kind: 'run', command, exitCode: result.exitCode });
		return {
			action: 'run',
			// A failing command is still evidence; only a run that never finished is an error.
			ok: !result.timedOut,
			error: result.timedOut ? status : undefined,
			evidenceId: stored.id,
			content,
			truncated: result.truncated,
			exitCode: result.exitCode
		};
	}

	private async writeFile(action: RetrievalAction, signal?: AbortSignal): Promise<ToolResult> {
		const path = sanitizeRepoPath(action.path);
		if (!path) return { action: 'writeFile', ok: false, error: 'invalid path', content: '', truncated: false };
		if (typeof action.content !== 'string') return { action: 'writeFile', ok: false, error: 'content must be a string', content: '', truncated: false, path };
		if (!this.exec) return { action: 'writeFile', ok: false, error: this.execUnavailable, content: '', truncated: false, path };
		const written = await this.exec.writeFile(path, action.content, signal);
		if (!written.ok) return { action: 'writeFile', ok: false, error: written.error, content: '', truncated: false, path };
		const lines = action.content.split('\n').length;
		return { action: 'writeFile', ok: true, path, content: `Wrote ${path} (${lines} line${lines === 1 ? '' : 's'}).\n${action.content}`, truncated: false };
	}

	private remember(record: Omit<EvidenceRecord, 'id'>): EvidenceRecord {
		const key = `${record.revision}:${record.path}:${record.startLine}-${record.endLine}:${record.content.length}`;
		for (const existing of this.records.values()) {
			if (
				existing.revision === record.revision &&
				existing.path === record.path &&
				existing.startLine === record.startLine &&
				existing.endLine === record.endLine &&
				existing.content === record.content
			) {
				return existing;
			}
		}
		const stored: EvidenceRecord = { ...record, id: `ev_${++this.seq}` };
		this.records.set(stored.id, stored);
		void key;
		return stored;
	}

	/** Runs up to `maxActions` retrievals whose combined content stays within one round's character budget. */
	async executeRound(
		rawActions: unknown,
		signal?: AbortSignal,
		onTool?: (tool: ToolCallReport) => void,
		maxActions: number = REVIEW_POLICY.maxRetrievalsPerTurn
	): Promise<ToolResult[]> {
		const actions = normalizeActions(rawActions).slice(0, maxActions);
		const results: ToolResult[] = [];
		let used = 0;
		let runs = 0;
		for (const action of actions) {
			if (signal?.aborted) {
				results.push({ action: action.action, ok: false, error: 'review aborted', content: '', truncated: false });
				continue;
			}
			if (action.action === 'run' && ++runs > REVIEW_POLICY.maxRunsPerTurn) {
				results.push({ action: 'run', ok: false, error: `at most ${REVIEW_POLICY.maxRunsPerTurn} run actions per turn; request it next turn`, content: '', truncated: false });
				continue;
			}
			const toolId = `tool_${++this.toolSeq}`;
			const command = actionCommand(action);
			const started = Date.now();
			const startedAt = new Date(started).toISOString();
			const report = (tool: ToolCallReport) => {
				try { onTool?.(tool); } catch { /* Observers cannot break retrieval. */ }
			};
			const input = reportedInput(action);
			report({ id: toolId, command, input, status: 'running', exitCode: null, startedAt });
			let result: ToolResult;
			try {
				result = await this.executeOne(action, signal);
			} catch (error) {
				report({ id: toolId, command, input, status: 'error', exitCode: null, startedAt,
					finishedAt: new Date().toISOString(), elapsedMs: Date.now() - started,
					summary: error instanceof Error ? error.message : 'Retrieval failed' });
				throw error;
			}
			// Report the same bounded evidence the agent actually receives.
			if (used + result.content.length > REVIEW_POLICY.maxToolRoundChars) {
				const room = Math.max(0, REVIEW_POLICY.maxToolRoundChars - used);
				result = {
					...result,
					content: result.content.slice(0, room),
					// The cut may land inside the last hunk: don't claim it was shown.
					hunkIds: room === 0 ? [] : result.hunkIds?.slice(0, -1),
					truncated: true,
					continuation: result.continuation ?? 'round-budget'
				};
			}
			results.push(result);
			used += result.content.length;
			report({
				id: toolId, command, input,
				status: result.ok ? 'done' : 'error',
				// Only `run` is a process; retrievals do not invent exit codes.
				exitCode: result.exitCode ?? null, startedAt,
				finishedAt: new Date().toISOString(), elapsedMs: Date.now() - started,
				summary: toolSummary(result),
				result: {
					content: result.content.slice(0, 12_000),
					truncated: result.truncated || result.content.length > 12_000,
					evidenceId: result.evidenceId, revision: result.revision, path: result.path, error: result.error
				}
			});
		}
		return results;
	}

	private async executeOne(action: RetrievalAction, signal?: AbortSignal): Promise<ToolResult> {
		// Runs and writes change state, so they are never served from the cache.
		if (action.action === 'run') return this.run(action, signal);
		if (action.action === 'writeFile') return this.writeFile(action, signal);
		const cacheKey = JSON.stringify(action);
		const cached = this.cache.get(cacheKey);
		if (cached) return cached;
		const result = await this.dispatch(action, signal);
		if (result.ok && result.content) {
			const revision = result.revision ?? 'head';
			const stored = this.remember({
				revision,
				path: result.path ?? '',
				startLine: result.startLine ?? 1,
				endLine: result.endLine ?? result.startLine ?? 1,
				content: result.content,
				truncated: result.truncated
			});
			result.evidenceId = stored.id;
		}
		this.cache.set(cacheKey, result);
		return result;
	}

	private async dispatch(action: RetrievalAction, signal?: AbortSignal): Promise<ToolResult> {
		switch (action.action) {
			case 'listFiles':
				return this.listFiles(action, signal);
			case 'readFile':
				return this.readFile(action, signal);
			case 'search':
				return this.search(action, signal);
			case 'readDiff':
				return this.readDiff(action);
			default:
				return {
					action: 'unknown', ok: false, content: '', truncated: false,
					error: `unsupported action ${JSON.stringify(action).slice(0, 160)}. Use exactly one of: {"action":"readDiff","path":"src/a.ts"} | {"action":"readFile","revision":"head","path":"src/a.ts","startLine":1,"endLine":150} | {"action":"search","revision":"head","query":"literalText"} | {"action":"listFiles","revision":"head","prefix":"src/"}`
				};
		}
	}

	private resolveRevision(raw: string | undefined): { alias: RevisionAlias; sha: string } | { error: string } {
		const alias = (raw ?? 'head') as RevisionAlias;
		if (!ALIASES.includes(alias)) return { error: `revision must be one of ${ALIASES.join(', ')}` };
		if (!this.revision) {
			if (alias === 'head') return { alias, sha: 'HEAD' };
			return { error: `revision "${alias}" requires a local checkout` };
		}
		const sha =
			alias === 'head' ? this.revision.headSha : alias === 'target' ? this.revision.targetSha : this.revision.mergeBaseSha;
		if (!sha) return { error: `revision "${alias}" is unavailable` };
		return { alias, sha };
	}

	private async listFiles(action: RetrievalAction, signal?: AbortSignal): Promise<ToolResult> {
		const resolved = this.resolveRevision(action.revision);
		if ('error' in resolved) {
			return { action: 'listFiles', ok: false, error: resolved.error, content: '', truncated: false };
		}
		const prefix = sanitizePrefix(action.prefix ?? '');
		if (prefix === null) {
			return { action: 'listFiles', ok: false, error: 'invalid prefix', content: '', truncated: false };
		}
		if (!this.revision) {
			const paths = this.inventory.files.map((file) => file.path).filter((path) => !prefix || path.startsWith(prefix));
			return paginateList('listFiles', resolved.alias, paths, action.cursor);
		}
		const args = ['ls-tree', '-r', '--name-only', '--full-tree', resolved.sha];
		if (prefix) args.push('--', prefix);
		const listed = await git(this.revision.checkoutPath, args, signal);
		if (listed.code !== 0) {
			return { action: 'listFiles', ok: false, error: listed.stderr.slice(0, 400) || 'listFiles failed', content: '', truncated: false };
		}
		const paths = listed.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
		return paginateList('listFiles', resolved.alias, paths, action.cursor);
	}

	private async readFile(action: RetrievalAction, signal?: AbortSignal): Promise<ToolResult> {
		const path = sanitizeRepoPath(action.path);
		if (!path) return { action: 'readFile', ok: false, error: 'invalid path', content: '', truncated: false };
		const resolved = this.resolveRevision(action.revision);
		if ('error' in resolved) {
			return { action: 'readFile', ok: false, error: resolved.error, content: '', truncated: false };
		}
		const startLine = Number.isInteger(action.startLine) && (action.startLine ?? 0) > 0 ? action.startLine! : 1;
		const requestedEnd =
			Number.isInteger(action.endLine) && (action.endLine ?? 0) >= startLine
				? action.endLine!
				: startLine + REVIEW_POLICY.maxReadLines - 1;
		const endLine = Math.min(requestedEnd, startLine + REVIEW_POLICY.maxReadLines - 1);
		if (this.revision) {
			const blob = await readBlob(this.revision.checkoutPath, resolved.sha, path, signal);
			if (!blob.ok) {
				return { action: 'readFile', ok: false, error: blob.error, content: '', truncated: false, revision: resolved.alias, path };
			}
			return sliceLines(blob.text, startLine, endLine, resolved.alias, path, this.maxFileChars);
		}
		if (resolved.alias !== 'head') {
			return { action: 'readFile', ok: false, error: 'checkout required for this revision', content: '', truncated: false };
		}
		const file = this.inventory.diffs.find((item) => item.path === path);
		if (!file) return { action: 'readFile', ok: false, error: 'path is not in the review diff', content: '', truncated: false };
		const text = newSideText(file);
		if (text === null) {
			return { action: 'readFile', ok: false, error: 'new-side text is unavailable (deleted file)', content: '', truncated: false, revision: 'head', path };
		}
		return sliceLines(text, startLine, endLine, 'head', path, this.maxFileChars);
	}

	private async search(action: RetrievalAction, signal?: AbortSignal): Promise<ToolResult> {
		const query = action.query;
		if (typeof query !== 'string' || query.length === 0 || query.length > 200) {
			return { action: 'search', ok: false, error: 'query must be 1–200 characters of literal text', content: '', truncated: false };
		}
		const resolved = this.resolveRevision(action.revision);
		if ('error' in resolved) {
			return { action: 'search', ok: false, error: resolved.error, content: '', truncated: false };
		}
		const prefix = sanitizePrefix(action.prefix ?? '');
		if (prefix === null) return { action: 'search', ok: false, error: 'invalid prefix', content: '', truncated: false };
		if (!this.revision) {
			return { action: 'search', ok: false, error: 'search requires a local checkout', content: '', truncated: false };
		}
		const args = ['grep', '-n', '-I', '-F', '-e', query, resolved.sha];
		if (prefix) args.push('--', prefix);
		else args.push('--', '.');
		const grepped = await git(this.revision.checkoutPath, args, signal);
		if (grepped.code !== 0 && grepped.code !== 1) {
			return { action: 'search', ok: false, error: grepped.stderr.slice(0, 400) || 'search failed', content: '', truncated: false };
		}
		const lines = grepped.stdout.split('\n').filter(Boolean);
		const start = cursorIndex(lines, action.cursor);
		const page = lines.slice(start, start + REVIEW_POLICY.maxSearchMatches);
		const truncated = start + page.length < lines.length;
		const content = page.join('\n');
		return {
			action: 'search',
			ok: true,
			revision: resolved.alias,
			content,
			truncated,
			continuation: truncated ? page.at(-1) ?? null : null,
			matches: page.length
		};
	}

	private readDiff(action: RetrievalAction): ToolResult {
		const path = sanitizeRepoPath(action.path);
		if (!path) return { action: 'readDiff', ok: false, error: 'invalid path', content: '', truncated: false };
		const file = this.inventory.diffs.find((item) => item.path === path);
		if (!file) return { action: 'readDiff', ok: false, error: 'path is not in the review diff', content: '', truncated: false };
		const wanted = new Set(action.hunkIds ?? file.hunks.map((hunk) => `${path}:${hunk.oldStart},${hunk.oldCount}:${hunk.newStart},${hunk.newCount}`));
		const hunks = file.hunks.filter((hunk) =>
			wanted.has(`${path}:${hunk.oldStart},${hunk.oldCount}:${hunk.newStart},${hunk.newCount}`)
		);
		if (hunks.length === 0) {
			return { action: 'readDiff', ok: false, error: 'no matching hunks', content: '', truncated: false, path };
		}
		const start = cursorIndex(
			hunks.map((hunk) => `${path}:${hunk.oldStart},${hunk.oldCount}:${hunk.newStart},${hunk.newCount}`),
			action.cursor
		);
		const rendered: string[] = [`--- a/${file.path}`, `+++ b/${file.path}`];
		let chars = rendered.join('\n').length;
		let lastId: string | null = null;
		let truncated = false;
		const shown: string[] = [];
		for (let i = start; i < hunks.length; i++) {
			const hunk = hunks[i];
			const id = `${path}:${hunk.oldStart},${hunk.oldCount}:${hunk.newStart},${hunk.newCount}`;
			const body = hunk.lines
				.map((line) => (line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ') + line.text)
				.join('\n');
			const chunk = `${hunk.header}\n${body}`;
			if (rendered.length > 2 && chars + chunk.length > REVIEW_POLICY.maxToolRoundChars) {
				truncated = true;
				break;
			}
			rendered.push(chunk);
			chars += chunk.length + 1;
			lastId = id;
			shown.push(id);
		}
		if (start + (lastId ? hunks.findIndex((hunk) => `${path}:${hunk.oldStart},${hunk.oldCount}:${hunk.newStart},${hunk.newCount}` === lastId) + 1 - start : 0) < hunks.length) {
			truncated = truncated || start + 1 < hunks.length && lastId !== `${path}:${hunks.at(-1)!.oldStart},${hunks.at(-1)!.oldCount}:${hunks.at(-1)!.newStart},${hunks.at(-1)!.newCount}`;
		}
		return {
			action: 'readDiff',
			ok: true,
			path,
			content: rendered.join('\n'),
			truncated,
			continuation: truncated ? lastId : null,
			hunkIds: shown,
			startLine: hunks[start]?.newStart,
			endLine: hunks.at(-1)?.newStart
		};
	}
}

const ACTION_NAMES = ['listFiles', 'readFile', 'search', 'readDiff', 'run', 'writeFile'] as const;

/** Names weaker models use for the four actions. */
const ACTION_ALIASES: Record<string, (typeof ACTION_NAMES)[number]> = {
	listfiles: 'listFiles', list_files: 'listFiles', list: 'listFiles', ls: 'listFiles',
	readfile: 'readFile', read_file: 'readFile', read: 'readFile', open: 'readFile', cat: 'readFile', view: 'readFile',
	search: 'search', grep: 'search', find: 'search', search_code: 'search', searchcode: 'search',
	readdiff: 'readDiff', read_diff: 'readDiff', diff: 'readDiff', getdiff: 'readDiff', get_diff: 'readDiff',
	run: 'run', bash: 'run', shell: 'run', sh: 'run', exec: 'run', execute: 'run', run_command: 'run', runcommand: 'run', terminal: 'run',
	writefile: 'writeFile', write_file: 'writeFile', write: 'writeFile', create_file: 'writeFile', createfile: 'writeFile'
};

function actionName(value: unknown): (typeof ACTION_NAMES)[number] | null {
	if (typeof value !== 'string') return null;
	if ((ACTION_NAMES as readonly string[]).includes(value)) return value as (typeof ACTION_NAMES)[number];
	return ACTION_ALIASES[value.trim().toLowerCase()] ?? null;
}

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function toInt(value: unknown): number | undefined {
	const n = typeof value === 'string' ? Number.parseInt(value, 10) : value;
	return typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : undefined;
}

/** Field names models reach for instead of ours: `pattern` → `query`, `file` → `path`, `lines: "10-40"` … */
function canonicalFields(args: Record<string, unknown>, action?: string): Record<string, unknown> {
	const out: Record<string, unknown> = { ...args };
	const pick = (target: string, ...keys: string[]) => {
		if (out[target] !== undefined) return;
		for (const key of keys) if (out[key] !== undefined) { out[target] = out[key]; delete out[key]; return; }
	};
	if (action === 'run') {
		pick('command', 'cmd', 'script', 'shell', 'bash');
		pick('timeoutSec', 'timeout', 'timeout_sec', 'timeoutSeconds');
		if (Array.isArray(out.command)) out.command = out.command.filter((part) => typeof part === 'string').join(' ');
		if (out.timeoutSec !== undefined) out.timeoutSec = toInt(out.timeoutSec);
	}
	if (action === 'writeFile') pick('content', 'contents', 'text', 'body', 'code', 'data');
	pick('query', 'pattern', 'regex', 'text', 'term', 'q', 'keyword', 'symbol');
	pick('path', 'file', 'filePath', 'file_path', 'filepath', 'filename', 'fileName');
	pick('prefix', 'dir', 'directory', 'folder', 'scope');
	pick('startLine', 'start_line', 'start', 'from', 'line', 'offset');
	pick('endLine', 'end_line', 'end', 'to');
	pick('hunkIds', 'hunks', 'hunk_ids');
	if (typeof out.lines === 'string') {
		const m = /^(\d+)\s*[-:–,]\s*(\d+)$/.exec(out.lines.trim());
		if (m) { out.startLine ??= Number(m[1]); out.endLine ??= Number(m[2]); }
		delete out.lines;
	}
	if (out.startLine !== undefined) out.startLine = toInt(out.startLine);
	if (out.endLine !== undefined) out.endLine = toInt(out.endLine);
	if (typeof out.hunkIds === 'string') out.hunkIds = [out.hunkIds];
	if (typeof out.revision === 'string') {
		const revision = out.revision.toLowerCase();
		out.revision = revision === 'base' || revision === 'old' || revision === 'main' ? 'target' : revision === 'new' || revision === 'pr' ? 'head' : revision === 'mergebase' ? 'mergeBase' : out.revision;
	}
	return out;
}

/**
 * Local models phrase the same request many ways: `{"readDiff": {…}}`,
 * `{"type": "readDiff", "args": {…}}`, `{"name": "read_file", "arguments": "{…}"}`,
 * OpenAI-style `{"function": {"name", "arguments"}}`. Fold them all into
 * `{"action": "readDiff", …}`; unknown shapes pass through and get a helpful error.
 */
function canonicalAction(item: Record<string, unknown>): RetrievalAction {
	const fn = item.function && typeof item.function === 'object' ? (item.function as Record<string, unknown>) : null;
	const named = actionName(item.action) ?? actionName(item.name) ?? actionName(item.tool) ?? actionName(item.type) ?? actionName(fn?.name);
	if (named) {
		const rawArgs = [item.arguments, item.args, item.input, item.parameters, item.params, fn?.arguments].find((value) => value !== undefined);
		const args = typeof rawArgs === 'string' ? safeJson(rawArgs) : rawArgs;
		const rest = { ...item };
		for (const key of ['action', 'name', 'tool', 'type', 'function', 'arguments', 'args', 'input', 'parameters', 'params']) delete rest[key];
		return { ...canonicalFields({ ...rest, ...(args && typeof args === 'object' ? (args as object) : {}) }, named), action: named } as RetrievalAction;
	}
	const keys = Object.keys(item);
	const key = keys.length === 1 ? actionName(keys[0]) : null;
	if (key) {
		const args = item[keys[0]];
		return { ...canonicalFields(args && typeof args === 'object' ? (args as Record<string, unknown>) : typeof args === 'string' && key === 'run' ? { command: args } : {}, key), action: key } as RetrievalAction;
	}
	return item as unknown as RetrievalAction;
}

function isAction(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	return actionName((canonicalAction(value as Record<string, unknown>) as { action?: unknown }).action) !== null;
}

/** Keys models use for the list of requests. */
const ACTION_LIST_KEYS = ['actions', 'tool_calls', 'toolCalls', 'tools', 'calls', 'requests', 'retrieval', 'retrievals', 'retrieve'];

export function parseActions(parsed: unknown): RetrievalAction[] | null {
	if (!parsed || typeof parsed !== 'object') return null;
	if (Array.isArray(parsed)) {
		const actions = parsed.filter(isAction).map((item) => canonicalAction(item as Record<string, unknown>));
		return actions.length ? actions : null;
	}
	const obj = parsed as Record<string, unknown>;
	for (const key of ACTION_LIST_KEYS) {
		const list = obj[key];
		if (Array.isArray(list)) {
			const actions = list.filter((item) => item && typeof item === 'object').map((item) => canonicalAction(item as Record<string, unknown>));
			if (actions.length) return actions;
		} else if (list && typeof list === 'object' && isAction(list)) {
			return [canonicalAction(list as Record<string, unknown>)];
		}
	}
	if (isAction(obj)) return [canonicalAction(obj)];
	return null;
}

/** What the dashboard shows as the tool's input: file content is the result, not the request. */
function reportedInput(action: RetrievalAction): ToolCallReport['input'] {
	const { content: _content, ...rest } = action;
	return rest;
}

function normalizeActions(raw: unknown): RetrievalAction[] {
	if (Array.isArray(raw)) return raw.filter((item) => item && typeof item === 'object').map((item) => canonicalAction(item as Record<string, unknown>));
	return parseActions(raw) ?? [];
}

function paginateList(action: string, revision: RevisionAlias, paths: string[], cursor?: string): ToolResult {
	const start = cursorIndex(paths, cursor);
	const page = paths.slice(start, start + REVIEW_POLICY.maxListPage);
	const truncated = start + page.length < paths.length;
	return {
		action,
		ok: true,
		revision,
		content: page.join('\n'),
		truncated,
		continuation: truncated ? page.at(-1) ?? null : null,
		matches: page.length
	};
}

function cursorIndex(items: string[], cursor?: string): number {
	if (!cursor) return 0;
	const index = items.indexOf(cursor);
	return index >= 0 ? index + 1 : 0;
}

function sliceLines(
	text: string,
	startLine: number,
	endLine: number,
	revision: RevisionAlias,
	path: string,
	maxChars: number
): ToolResult {
	const lines = splitFileLines(text);
	if (startLine > lines.length) {
		return {
			action: 'readFile',
			ok: false,
			error: `startLine ${startLine} is past end of file (${lines.length} lines)`,
			content: '',
			truncated: false,
			revision,
			path
		};
	}
	const slice = lines.slice(startLine - 1, Math.min(endLine, lines.length));
	const numbered = slice.map((line, i) => `${startLine + i}|${line}`).join('\n');
	const cap = Math.min(maxChars, REVIEW_POLICY.maxToolRoundChars);
	const truncated = numbered.length > cap || endLine < Math.min(endLine, lines.length) && startLine + slice.length - 1 < lines.length && endLine < lines.length;
	const content = numbered.length > cap ? numbered.slice(0, cap) : numbered;
	return {
		action: 'readFile',
		ok: true,
		revision,
		path,
		startLine,
		endLine: startLine + slice.length - 1,
		content,
		truncated: truncated || numbered.length > cap,
		continuation: startLine + slice.length <= lines.length && (endLine < lines.length || numbered.length > cap) ? String(startLine + slice.length) : null
	};
}

function splitFileLines(text: string): string[] {
	if (text === '') return [];
	const lines = text.split('\n');
	if (lines[lines.length - 1] === '') lines.pop();
	return lines;
}

function newSideText(file: FileDiff): string | null {
	const byNumber = new Map<number, string>();
	let max = 0;
	for (const hunk of file.hunks) {
		for (const line of hunk.lines) {
			if (line.newNo === null) continue;
			byNumber.set(line.newNo, line.text);
			if (line.newNo > max) max = line.newNo;
		}
	}
	if (max === 0) return null;
	const lines: string[] = [];
	for (let n = 1; n <= max; n++) {
		if (!byNumber.has(n)) return null;
		lines.push(byNumber.get(n)!);
	}
	return lines.join('\n');
}

export function sanitizeRepoPath(path: string | undefined): string | null {
	if (typeof path !== 'string' || path === '' || path.includes('\0')) return null;
	if (path.startsWith('/') || path.startsWith('~')) return null;
	const parts = path.replace(/\\/g, '/').split('/');
	if (parts.some((part) => part === '' || part === '.' || part === '..')) return null;
	return parts.join('/');
}

function sanitizePrefix(prefix: string): string | null {
	if (prefix === '') return '';
	return sanitizeRepoPath(prefix.endsWith('/') ? prefix.slice(0, -1) : prefix);
}

interface GitResult {
	code: number;
	stdout: string;
	stderr: string;
}

async function git(cwd: string, args: string[], signal?: AbortSignal): Promise<GitResult> {
	const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
	const abort = () => proc.kill();
	signal?.addEventListener('abort', abort, { once: true });
	try {
		const [stdout, stderr, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited
		]);
		return { code, stdout, stderr };
	} finally {
		signal?.removeEventListener('abort', abort);
	}
}

async function readBlob(
	cwd: string,
	sha: string,
	path: string,
	signal?: AbortSignal
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
	const listed = await git(cwd, ['ls-tree', '-z', sha, '--', path], signal);
	if (listed.code !== 0) return { ok: false, error: listed.stderr.slice(0, 400) || 'path not found' };
	const record = listed.stdout.split('\0').find(Boolean);
	if (!record) return { ok: false, error: 'path not found at this revision' };
	const tab = record.indexOf('\t');
	const meta = tab === -1 ? record : record.slice(0, tab);
	const [mode, type, hash] = meta.split(/\s+/);
	if (mode === '120000') return { ok: false, error: 'refusing to follow symlink' };
	if (type === 'commit' || mode === '160000') return { ok: false, error: 'refusing to enter submodule' };
	if (type !== 'blob' || !hash) return { ok: false, error: 'not a file at this revision' };
	const blob = await git(cwd, ['cat-file', '-p', hash], signal);
	if (blob.code !== 0) return { ok: false, error: blob.stderr.slice(0, 400) || 'read failed' };
	if (blob.stdout.includes('\0')) return { ok: false, error: 'binary file' };
	return { ok: true, text: blob.stdout };
}

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
