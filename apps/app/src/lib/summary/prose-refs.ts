import type { PullCommit } from '@recoder/shared';

/** What the pull request holds that its prose may name: the paths it changes and its commits. */
export interface ProseSources {
	paths: readonly string[];
	commits: readonly PullCommit[];
}

/** A file the pull request changes, named in prose, with the lines the prose gave. */
export interface FileRef {
	/** The changed file's whole path. */
	path: string;
	/** `20` or `20-30`, as a file chip shows them; null when the prose named the file alone. */
	lines: string | null;
	/** The first of those lines, where Changes opens; null for the whole file. */
	line: number | null;
}

/** What a span of inline code in the prose names. */
export type ProseRef = ({ kind: 'file' } & FileRef) | { kind: 'commit'; commit: PullCommit };

/** The lines after a path, as prose writes them: `:20`, `:20-30`, `:20:4`, `#L20` or `#L20-L30`. */
const LINES = /(?::(\d+)(?:-(\d+)|:\d+)?|#L(\d+)(?:-L?(\d+))?)$/;

/** A commit's hash, whole or cut to seven characters or more. */
const HASH = '[0-9a-f]{7,40}';

const COMMIT_HASH = new RegExp(`^${HASH}$`, 'i');

const INLINE_HASH = new RegExp(`(?:\`${HASH}\`|<code\\b[^>]*>${HASH}</code>)`, 'i');

/**
 * Something in running text shaped like a file: folders, a name with an extension, and the lines after it. It starts
 * and ends at a word's edge, so a sentence's full stop or comma after it stays text.
 */
const MENTION =
	/(?<![\w./@~-])(?:\.\/)?(?:[\w@~-][\w.@~-]*\/)*[\w-][\w.-]*\.[a-z]\w*(?:#L\d+(?:-L?\d+)?|:\d+(?:-\d+|:\d+)?)?(?![\w/])/gi;

/** Markdown that is not running text: a code span (its content captured), a link, an autolink or a web address. */
const NOT_TEXT = /(`+)(?!`)([\s\S]*?[^`])\1(?!`)|\[[^\]\n]*\]\([^)\n]*\)|<[^>\s]+>|https?:\/\/[^\s<>)]+/g;

/** A fence's opening or closing line: three or more backticks or tildes. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** A stretch of Markdown: running text, a code span with its content, or anything else that names no file. */
type Piece = { kind: 'text' | 'other'; source: string } | { kind: 'code'; source: string; code: string };

/**
 * True when Markdown holds inline code (backticks or HTML `<code>`), the only text that can become
 * a file's badge. Prose without any does not change when the diff arrives, so it need not wait for it.
 */
export function mayNameFile(markdown: string): boolean {
	return markdown.includes('`') || /<code\b/i.test(markdown);
}

/** True when Markdown holds inline code shaped like a commit's hash, the only text the commits can change. */
export function mayNameCommit(markdown: string): boolean {
	return INLINE_HASH.test(markdown);
}

/**
 * The one changed path that `name` is: the whole path, or its last folders and file name. A bare word is a path only
 * when it is the whole of one, so `main` never becomes `cmd/main`; a name two changed files share is neither.
 */
function changedPath(name: string, paths: readonly string[]): string | null {
	const whole = paths.find((path) => path === name);

	if (whole) return whole;
	if (!/[./]/.test(name)) return null;

	const ending = paths.filter((path) => path.endsWith(`/${name}`));

	return ending.length === 1 ? (ending[0] ?? null) : null;
}

/** The changed file `code` names, with the lines it gave; null when the pull request does not change that file. */
function readFile(code: string, paths: readonly string[]): FileRef | null {
	const match = code.match(LINES);
	const name = (match ? code.slice(0, match.index) : code).replace(/^\.\//, '');
	const path = name ? changedPath(name, paths) : null;

	if (!path) return null;

	const start = match?.[1] ?? match?.[3];
	const end = match?.[2] ?? match?.[4];

	return { path, lines: start ? (end ? `${start}-${end}` : start) : null, line: start ? Number(start) : null };
}

/**
 * What a span of inline code names in a pull request: a file it changes (with or without lines) or one of its
 * commits by hash. Null for everything else, which stays code: a badge is drawn only for what the page can open.
 */
export function readProseRef(code: string, { paths, commits }: ProseSources): ProseRef | null {
	const file = readFile(code, paths);

	if (file) return { kind: 'file', ...file };
	if (!COMMIT_HASH.test(code)) return null;

	const hash = code.toLowerCase();
	const commit = commits.find((candidate) => candidate.sha.startsWith(hash));

	return commit ? { kind: 'commit', commit } : null;
}

/** Markdown split into fenced code, which never names a file here, and the rest, keeping every character. */
function blocks(markdown: string): { fenced: boolean; source: string }[] {
	const found: { fenced: boolean; source: string }[] = [];
	let fence: string | null = null;

	for (const [index, line] of markdown.split('\n').entries()) {
		const source = index === 0 ? line : `\n${line}`;
		const marker = FENCE.exec(line)?.[1] ?? null;
		const fenced = fence !== null || marker !== null;
		const last = found.at(-1);

		if (fence === null && marker) fence = marker;
		else if (
			fence !== null &&
			marker?.startsWith(fence[0]) &&
			marker.length >= fence.length &&
			!line.trim().slice(marker.length).trim()
		) {
			fence = null;
		}

		if (last && last.fenced === fenced) last.source += source;
		else found.push({ fenced, source });
	}

	return found;
}

/** The content of a code span as Markdown renders it: line breaks as spaces, one space trimmed from both ends. */
function spanContent(raw: string): string {
	const flat = raw.replace(/\r?\n/g, ' ');

	return flat.length > 2 && flat.startsWith(' ') && flat.endsWith(' ') && flat.trim() ? flat.slice(1, -1) : flat;
}

/** Markdown as running text, code spans and the rest, in order, so joining the pieces gives the source back. */
function pieces(markdown: string): Piece[] {
	const found: Piece[] = [];

	for (const block of blocks(markdown)) {
		if (block.fenced) {
			found.push({ kind: 'other', source: block.source });
			continue;
		}

		let at = 0;

		for (const match of block.source.matchAll(NOT_TEXT)) {
			if (match.index > at) found.push({ kind: 'text', source: block.source.slice(at, match.index) });

			found.push(
				match[1]
					? { kind: 'code', source: match[0], code: spanContent(match[2] ?? '') }
					: { kind: 'other', source: match[0] }
			);

			at = match.index + match[0].length;
		}

		if (at < block.source.length) found.push({ kind: 'text', source: block.source.slice(at) });
	}

	return found;
}

/**
 * Markdown with every file the pull request changes that its running text names (`window.ts:382`, `src/a/b.ts`)
 * put in a code span, so it draws as that file's chip wherever inline code does. Code, links, web addresses and
 * names that match no changed file, or more than one, are left as written.
 */
export function markFileRefs(markdown: string, paths: readonly string[]): string {
	if (paths.length === 0) return markdown;

	return pieces(markdown)
		.map((piece) =>
			piece.kind === 'text'
				? piece.source.replace(MENTION, (name) => (readFile(name, paths) ? `\`${name}\`` : name))
				: piece.source
		)
		.join('');
}

/** Every changed file the Markdown names, in running text or a code span, once each and in the order it names them. */
export function namedFiles(markdown: string, paths: readonly string[]): FileRef[] {
	const found = new Map<string, FileRef>();

	for (const piece of pieces(markdown)) {
		const names =
			piece.kind === 'code' ? [piece.code] : piece.kind === 'text' ? (piece.source.match(MENTION) ?? []) : [];

		for (const name of names) {
			const file = readFile(name, paths);
			const key = file ? `${file.path}:${file.lines ?? ''}` : '';

			if (file && !found.has(key)) found.set(key, file);
		}
	}

	return [...found.values()];
}
