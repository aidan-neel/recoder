import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { FixEdit } from '@recoder/shared';

/** A character span inside a file's text. */
interface Span {
	start: number;
	end: number;
}

/** Why edits could not be placed in the current code. */
export class EditMismatchError extends Error {}

/** A checkout file's full text; null when it is missing, a symlink, or outside the checkout. */
export async function readCheckoutFile(root: string, file: string): Promise<string | null> {
	const base = resolve(root);
	const path = resolve(base, file);

	if (!path.startsWith(base + '/')) return null;

	try {
		const info = await lstat(path);

		if (info.isSymbolicLink() || !info.isFile()) return null;

		return await readFile(path, 'utf8');
	} catch {
		return null;
	}
}

/** The span of `needle` when it occurs exactly once in `content`. */
function locateOnce(content: string, needle: string): Span | null {
	const at = content.indexOf(needle);

	return at >= 0 && content.indexOf(needle, at + 1) < 0 ? { start: at, end: at + needle.length } : null;
}

/** Drop `12: ` prefixes when every line has one: the excerpt the model saw was numbered, and a verbatim copy may keep them. */
function stripLineNumbers(lines: string[]): string[] {
	return lines.every((line) => /^\s*\d+: /.test(line)) ? lines.map((line) => line.replace(/^\s*\d+: /, '')) : lines;
}

/** Last resort: the one window of whole lines that equal `lines` after trimming. */
function locateTrimmedLines(content: string, lines: string[]): Span | null {
	const want = lines.map((line) => line.trim());

	while (want.length && want[0] === '') want.shift();
	while (want.length && want.at(-1) === '') want.pop();
	if (!want.length) return null;

	const have = content.split('\n');
	const offsets: number[] = [];

	for (let i = 0, at = 0; i < have.length; i++) {
		offsets.push(at);
		at += have[i].length + 1;
	}

	let found: Span | null = null;

	for (let i = 0; i + want.length <= have.length; i++) {
		if (!want.every((line, j) => have[i + j].trim() === line)) continue;
		if (found) return null;

		const last = i + want.length - 1;

		found = { start: offsets[i], end: offsets[last] + have[last].length };
	}

	return found;
}

/** The single place `find` occurs in `content`, forgiving copied line numbers and indentation. */
export function locateEdit(content: string, find: string): Span | null {
	const exact = locateOnce(content, find);

	if (exact) return exact;

	const lines = find.replace(/\n$/, '').split('\n');
	const unnumbered = stripLineNumbers(lines);

	if (unnumbered !== lines) {
		const stripped = locateOnce(content, unnumbered.join('\n'));

		if (stripped) return stripped;
	}

	return locateTrimmedLines(content, unnumbered);
}

/** Apply edits to the checkout's current files (in memory). Throws EditMismatchError. */
async function editedFiles(
	sandboxPath: string,
	edits: FixEdit[]
): Promise<Map<string, { before: string; after: string }>> {
	const files = new Map<string, { before: string; after: string }>();

	for (const [index, edit] of edits.entries()) {
		const file = edit.file.replace(/^[ab]\//, '');

		if (file.startsWith('/') || file.split('/').includes('..'))
			throw new EditMismatchError(`edit ${index + 1}: invalid path ${edit.file}`);

		let entry = files.get(file);

		if (!entry) {
			const before = await readCheckoutFile(sandboxPath, file);

			if (before === null) throw new EditMismatchError(`edit ${index + 1}: ${file} does not exist`);
			entry = { before, after: before };
			files.set(file, entry);
		}

		const span = locateEdit(entry.after, edit.find);

		if (!span)
			throw new EditMismatchError(`edit ${index + 1}: the "find" text does not match exactly one place in ${file}`);
		entry.after = entry.after.slice(0, span.start) + edit.replace + entry.after.slice(span.end);
	}

	return files;
}

/** A `git diff --no-index` of one file's two versions, written side by side under `dir`. */
async function diffFile(dir: string, file: string, before: string, after: string): Promise<string> {
	for (const [side, text] of [
		['a', before],
		['b', after]
	] as const) {
		await mkdir(dirname(join(dir, side, file)), { recursive: true });
		await writeFile(join(dir, side, file), text);
	}

	const proc = Bun.spawn(['git', 'diff', '--no-index', '--no-color', '--no-prefix', '--', `a/${file}`, `b/${file}`], {
		cwd: dir,
		stdout: 'pipe',
		stderr: 'pipe'
	});

	const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

	return out;
}

/**
 * A unified diff (`a/` and `b/` prefixes) from the checkout's files to the edited ones.
 * The server builds the patch rather than the model, because hand-written hunks get line counts
 * and context wrong; it is rebuilt at apply time so earlier fixes don't break it.
 */
export async function patchFromEdits(sandboxPath: string, edits: FixEdit[]): Promise<string> {
	const files = await editedFiles(sandboxPath, edits);
	const dir = await mkdtemp(join(tmpdir(), 'recoder-fix-'));

	try {
		const parts: string[] = [];

		for (const [file, { before, after }] of files) {
			if (before !== after) parts.push(await diffFile(dir, file, before, after));
		}

		const patch = parts.join('');

		if (!patch.trim()) throw new EditMismatchError('the edits change nothing');

		return patch;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
