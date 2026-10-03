import type { DiffHunk } from '@recoder/shared';
import type { ReviewInventory } from '../review/pipeline/inventory.js';
import { REVIEW_POLICY } from '../review/session/review-policy.js';
import { git, readBlob, regularFiles } from './git.js';
import { sanitizePrefix, sanitizeRepoPath } from './paths.js';
import { cursorIndex, newSideText, paginateList, sliceLines } from './text.js';
import {
	REVISION_ALIASES,
	failure,
	type RetrievalAction,
	type ReviewRevision,
	type RevisionAlias,
	type ToolResult
} from './types.js';

/** What read-only retrievals see: the checkout (null for diff-only reviews) and the review inventory. */
export interface RetrievalContext {
	readonly revision: ReviewRevision | null;
	readonly inventory: ReviewInventory;
	readonly maxFileChars: number;
}

type ResolvedRevision = { alias: RevisionAlias; sha: string } | { error: string };

const UNSUPPORTED_HINT =
	'Use exactly one of: {"action":"readDiff","path":"src/a.ts"} | {"action":"readFile","revision":"head","path":"src/a.ts","startLine":1,"endLine":150} | {"action":"search","revision":"head","query":"literalText"} | {"action":"listFiles","revision":"head","prefix":"src/"}';

/** Runs one read-only retrieval. */
export async function retrieve(
	context: RetrievalContext,
	action: RetrievalAction,
	signal?: AbortSignal
): Promise<ToolResult> {
	switch (action.action) {
		case 'listFiles':
			return listFiles(context, action, signal);
		case 'readFile':
			return readFile(context, action, signal);
		case 'search':
			return search(context, action, signal);
		case 'readDiff':
			return readDiff(context, action);
		default:
			return failure('unknown', `unsupported action ${JSON.stringify(action).slice(0, 160)}. ${UNSUPPORTED_HINT}`);
	}
}

/** Maps a revision alias to its commit; without a checkout only `head` exists. */
function resolveRevision(revision: ReviewRevision | null, raw: string | undefined): ResolvedRevision {
	const alias = (raw ?? 'head') as RevisionAlias;

	if (!REVISION_ALIASES.includes(alias)) return { error: `revision must be one of ${REVISION_ALIASES.join(', ')}` };

	if (!revision) {
		if (alias === 'head') return { alias, sha: 'HEAD' };

		return { error: `revision "${alias}" requires a local checkout` };
	}

	const sha = alias === 'head' ? revision.headSha : alias === 'target' ? revision.targetSha : revision.mergeBaseSha;

	if (!sha) return { error: `revision "${alias}" is unavailable` };

	return { alias, sha };
}

/** Discover optional regular files before issuing observable read requests. */
export async function existingFiles(
	context: RetrievalContext,
	revision: RevisionAlias,
	paths: readonly string[],
	signal?: AbortSignal
): Promise<string[]> {
	const resolved = resolveRevision(context.revision, revision);

	if ('error' in resolved) throw new Error(resolved.error);
	if (!paths.length) return [];
	if (paths.some((path) => !sanitizeRepoPath(path))) throw new Error('invalid path');
	if (!context.revision) return paths.filter((path) => context.inventory.files.some((file) => file.path === path));

	const listed = await git(context.revision.checkoutPath, ['ls-tree', '-z', resolved.sha, '--', ...paths], signal);

	if (listed.code !== 0) throw new Error(listed.stderr.slice(0, 400) || 'File discovery failed');

	const found = regularFiles(listed.stdout);

	return paths.filter((path) => found.has(path));
}

async function listFiles(
	context: RetrievalContext,
	action: RetrievalAction,
	signal?: AbortSignal
): Promise<ToolResult> {
	const resolved = resolveRevision(context.revision, action.revision);

	if ('error' in resolved) return failure('listFiles', resolved.error);

	const prefix = sanitizePrefix(action.prefix ?? '');

	if (prefix === null) return failure('listFiles', 'invalid prefix');

	if (!context.revision) {
		const paths = context.inventory.files.map((file) => file.path).filter((path) => !prefix || path.startsWith(prefix));

		return paginateList('listFiles', resolved.alias, paths, action.cursor);
	}

	const args = ['ls-tree', '-r', '--name-only', '--full-tree', resolved.sha];

	if (prefix) args.push('--', prefix);

	const listed = await git(context.revision.checkoutPath, args, signal);

	if (listed.code !== 0) return failure('listFiles', listed.stderr.slice(0, 400) || 'listFiles failed');

	const paths = listed.stdout
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);

	return paginateList('listFiles', resolved.alias, paths, action.cursor);
}

/** The requested line window, clamped to `maxReadLines`. */
function lineWindow(action: RetrievalAction): { startLine: number; endLine: number } {
	const startLine = Number.isInteger(action.startLine) && (action.startLine ?? 0) > 0 ? action.startLine! : 1;

	const requestedEnd =
		Number.isInteger(action.endLine) && (action.endLine ?? 0) >= startLine
			? action.endLine!
			: startLine + REVIEW_POLICY.maxReadLines - 1;

	return { startLine, endLine: Math.min(requestedEnd, startLine + REVIEW_POLICY.maxReadLines - 1) };
}

async function readFile(context: RetrievalContext, action: RetrievalAction, signal?: AbortSignal): Promise<ToolResult> {
	const path = sanitizeRepoPath(action.path);

	if (!path) return failure('readFile', 'invalid path');

	const resolved = resolveRevision(context.revision, action.revision);

	if ('error' in resolved) return failure('readFile', resolved.error);

	const { startLine, endLine } = lineWindow(action);

	if (context.revision) {
		const blob = await readBlob(context.revision.checkoutPath, resolved.sha, path, signal);

		if (!blob.ok) return failure('readFile', blob.error, { revision: resolved.alias, path });

		return sliceLines(blob.text, startLine, endLine, resolved.alias, path, context.maxFileChars);
	}

	if (resolved.alias !== 'head') return failure('readFile', 'checkout required for this revision');

	const file = context.inventory.diffs.find((item) => item.path === path);

	if (!file) return failure('readFile', 'path is not in the review diff');

	const text = newSideText(file);

	if (text === null) {
		return failure('readFile', 'new-side text is unavailable (deleted file)', { revision: 'head', path });
	}

	return sliceLines(text, startLine, endLine, 'head', path, context.maxFileChars);
}

async function search(context: RetrievalContext, action: RetrievalAction, signal?: AbortSignal): Promise<ToolResult> {
	const query = action.query;

	if (typeof query !== 'string' || query.length === 0 || query.length > 200) {
		return failure('search', 'query must be 1–200 characters of literal text');
	}

	const resolved = resolveRevision(context.revision, action.revision);

	if ('error' in resolved) return failure('search', resolved.error);

	const prefix = sanitizePrefix(action.prefix ?? '');

	if (prefix === null) return failure('search', 'invalid prefix');
	if (!context.revision) return failure('search', 'search requires a local checkout');

	const args = ['grep', '-n', '-I', '-F', '-e', query, resolved.sha, '--', prefix || '.'];
	const grepped = await git(context.revision.checkoutPath, args, signal);

	if (grepped.code !== 0 && grepped.code !== 1) {
		return failure('search', grepped.stderr.slice(0, 400) || 'search failed');
	}

	const lines = grepped.stdout.split('\n').filter(Boolean);
	const start = cursorIndex(lines, action.cursor);
	const page = lines.slice(start, start + REVIEW_POLICY.maxSearchMatches);
	const truncated = start + page.length < lines.length;

	return {
		action: 'search',
		ok: true,
		revision: resolved.alias,
		content: page.join('\n'),
		truncated,
		continuation: truncated ? (page.at(-1) ?? null) : null,
		matches: page.length
	};
}

function hunkId(path: string, hunk: DiffHunk): string {
	return `${path}:${hunk.oldStart},${hunk.oldCount}:${hunk.newStart},${hunk.newCount}`;
}

function hunkPatch(hunk: DiffHunk): string {
	const body = hunk.lines
		.map((line) => (line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ') + line.text)
		.join('\n');

	return `${hunk.header}\n${body}`;
}

/** The scoped hunks of one diff file as patch text, from `cursor` until the round budget runs out. */
function readDiff(context: RetrievalContext, action: RetrievalAction): ToolResult {
	const path = sanitizeRepoPath(action.path);

	if (!path) return failure('readDiff', 'invalid path');

	const file = context.inventory.diffs.find((item) => item.path === path);

	if (!file) return failure('readDiff', 'path is not in the review diff');

	const wanted = new Set(action.hunkIds ?? file.hunks.map((hunk) => hunkId(path, hunk)));
	const hunks = file.hunks.filter((hunk) => wanted.has(hunkId(path, hunk)));

	if (hunks.length === 0) return failure('readDiff', 'no matching hunks', { path });

	const start = cursorIndex(
		hunks.map((hunk) => hunkId(path, hunk)),
		action.cursor
	);

	const rendered: string[] = [`--- a/${file.path}`, `+++ b/${file.path}`];
	let chars = rendered.join('\n').length;
	let lastId: string | null = null;
	let truncated = false;
	const shown: string[] = [];

	for (let i = start; i < hunks.length; i++) {
		const id = hunkId(path, hunks[i]);
		const chunk = hunkPatch(hunks[i]);

		if (rendered.length > 2 && chars + chunk.length > REVIEW_POLICY.maxToolRoundChars) {
			truncated = true;
			break;
		}

		rendered.push(chunk);
		chars += chunk.length + 1;
		lastId = id;
		shown.push(id);
	}

	const shownEnd = lastId ? hunks.findIndex((hunk) => hunkId(path, hunk) === lastId) + 1 : start;

	if (shownEnd < hunks.length) {
		truncated = truncated || (start + 1 < hunks.length && lastId !== hunkId(path, hunks.at(-1)!));
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
