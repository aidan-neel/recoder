import { REVIEW_POLICY } from './review-policy.js';
import type { ReviewInventory } from './inventory.js';
import type { FileDiff } from '@recoder/shared';

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
}

export interface RetrievalAction {
	action: 'listFiles' | 'readFile' | 'search' | 'readDiff';
	revision?: string;
	path?: string;
	prefix?: string;
	startLine?: number;
	endLine?: number;
	query?: string;
	hunkIds?: string[];
	cursor?: string;
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
}

const ALIASES: RevisionAlias[] = ['head', 'target', 'mergeBase'];

export class EvidenceStore {
	readonly records = new Map<string, EvidenceRecord>();
	private readonly cache = new Map<string, ToolResult>();
	private seq = 0;
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

	async executeRound(rawActions: unknown, signal?: AbortSignal): Promise<ToolResult[]> {
		const actions = normalizeActions(rawActions).slice(0, REVIEW_POLICY.maxRetrievalsPerTurn);
		const results: ToolResult[] = [];
		let used = 0;
		for (const action of actions) {
			if (signal?.aborted) {
				results.push({ action: action.action, ok: false, error: 'review aborted', content: '', truncated: false });
				continue;
			}
			const result = await this.executeOne(action, signal);
			if (used >= REVIEW_POLICY.maxToolRoundChars) {
				results.push({
					...result,
					content: '',
					truncated: true,
					continuation: result.continuation ?? 'round-budget',
					error: result.error,
					ok: result.ok
				});
				continue;
			}
			if (used + result.content.length > REVIEW_POLICY.maxToolRoundChars) {
				const room = REVIEW_POLICY.maxToolRoundChars - used;
				results.push({
					...result,
					content: result.content.slice(0, room),
					truncated: true,
					continuation: result.continuation ?? 'round-budget'
				});
				used = REVIEW_POLICY.maxToolRoundChars;
			} else {
				results.push(result);
				used += result.content.length;
			}
		}
		return results;
	}

	private async executeOne(action: RetrievalAction, signal?: AbortSignal): Promise<ToolResult> {
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
				return { action: 'unknown', ok: false, error: 'unsupported action', content: '', truncated: false };
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
			startLine: hunks[start]?.newStart,
			endLine: hunks.at(-1)?.newStart
		};
	}
}

export function parseActions(parsed: unknown): RetrievalAction[] | null {
	if (!parsed || typeof parsed !== 'object') return null;
	const obj = parsed as Record<string, unknown>;
	if (Array.isArray(obj.actions)) {
		const actions = obj.actions.filter((item) => item && typeof item === 'object') as RetrievalAction[];
		return actions.length ? actions : null;
	}
	if (typeof obj.action === 'string') return [obj as unknown as RetrievalAction];
	return null;
}

function normalizeActions(raw: unknown): RetrievalAction[] {
	if (Array.isArray(raw)) return raw.filter((item) => item && typeof item === 'object') as RetrievalAction[];
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
