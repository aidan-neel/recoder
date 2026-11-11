import { parseUnifiedDiff, type FileDiff } from '@recoder/shared';
import { CliError, usageError } from '../exit.js';
import { assertNotCancelled } from './git.js';
import type { ResolvedTarget, TargetRequest } from './resolve-target.js';
import { isScoped } from './scope.js';

/** The `source` that means standard input. */
const STANDARD_INPUT = '-';

/** The first line of a file header, in git's form or a plain patch's. */
const FILE_HEADER_LINE = /^(?:diff --git |--- |\+\+\+ )/m;

/**
 * A unified diff read from a file or standard input, with no repository and
 * no checkout. Scope is refused: the shared diff parser keeps no raw text per
 * file, so a narrowed diff could not be written back out.
 */
export async function resolveDiffFile(source: string, request: TargetRequest): Promise<ResolvedTarget> {
	if (isScoped(request.scope))
		throw usageError('--include and --exclude need a repository; they do not apply to a diff file.');

	const diff = await readSource(source, request.signal);
	const files = checkedDiff(diff, source);

	return {
		diff,
		sandboxPath: null,
		revision: null,
		title: null,
		body: null,
		report: {
			kind: 'diff',
			repoPath: null,
			base: null,
			head: null,
			baseSha: null,
			mergeBaseSha: null,
			headSha: null,
			url: null,
			changedFiles: files.length
		},
		dispose: () => Promise.resolve()
	};
}

/**
 * The files of the diff; refuses an empty source, text with no hunk, and a
 * hunk with no file header, since a review needs to know which file it is in.
 */
function checkedDiff(diff: string, source: string): FileDiff[] {
	if (!diff.trim()) throw usageError(`Nothing to review: ${describeSource(source)} is empty.`);

	const files = parseUnifiedDiff(diff);

	if (!files.length) {
		throw usageError(`The text from ${describeSource(source)} is not a unified diff with at least one hunk.`);
	}

	if (hasHunkBeforeFileHeader(diff)) {
		throw usageError(
			`The text from ${describeSource(source)} has a hunk with no file header; each file needs its --- and +++ lines.`
		);
	}

	return files;
}

/**
 * Whether a readable hunk comes before the first file header. Only there can
 * a hunk have no file: the parser, like `git apply`, gives every later hunk
 * to the file whose header came last, so a file really called `unknown` (the
 * parser's name for a hunk with no file) is judged by its own place, not by
 * its name.
 */
function hasHunkBeforeFileHeader(diff: string): boolean {
	const firstHeader = diff.search(FILE_HEADER_LINE);
	const beforeHeaders = firstHeader === -1 ? diff : diff.slice(0, firstHeader);

	return parseUnifiedDiff(beforeHeaders).length > 0;
}

/** The whole source as text. A file and standard input both read through the same cancellable stream. */
async function readSource(source: string, signal: AbortSignal): Promise<string> {
	const stream = source === STANDARD_INPUT ? Bun.stdin.stream() : Bun.file(source).stream();

	try {
		return await readUntilCancelled(stream, signal);
	} catch (err) {
		if (err instanceof CliError) throw err;
		throw usageError(`Could not read ${describeSource(source)}: ${err instanceof Error ? err.message : String(err)}`);
	}
}

/**
 * Reads the stream to its end, or until `signal` aborts. An abort cancels the
 * reader, which ends the pending read and lets go of the input, so standard
 * input left open never keeps the process waiting.
 */
async function readUntilCancelled(stream: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<string> {
	assertNotCancelled(signal);

	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let cancelling: Promise<void> | null = null;
	let text = '';

	const cancel = () => {
		cancelling = reader.cancel();
	};

	signal.addEventListener('abort', cancel, { once: true });

	try {
		for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
			text += decoder.decode(chunk.value, { stream: true });
		}
	} finally {
		signal.removeEventListener('abort', cancel);
		await cancelling;
		reader.releaseLock();
	}

	assertNotCancelled(signal);

	return text + decoder.decode();
}

function describeSource(source: string): string {
	return source === STANDARD_INPUT ? 'standard input' : `the file ${source}`;
}
