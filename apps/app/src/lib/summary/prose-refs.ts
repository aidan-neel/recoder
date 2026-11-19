import type { PullCommit } from '@recoder/shared';

/** What the pull request holds that its prose may name: the paths it changes and its commits. */
export interface ProseSources {
	paths: readonly string[];
	commits: readonly PullCommit[];
}

/** What a span of inline code in the Summary's prose names. */
export type ProseRef =
	| {
			kind: 'file';
			/** The changed file's whole path. */
			path: string;
			/** The file's name with the lines the prose gave: `lease.ts:20-30`. */
			label: string;
	  }
	| { kind: 'commit'; commit: PullCommit };

/** The lines after a path, as prose writes them: `:20`, `:20-30`, `:20:4`, `#L20` or `#L20-L30`. */
const LINES = /(?::(\d+)(?:-(\d+)|:\d+)?|#L(\d+)(?:-L?(\d+))?)$/;

/** A commit's hash, whole or cut to seven characters or more. */
const HASH = '[0-9a-f]{7,40}';

const COMMIT_HASH = new RegExp(`^${HASH}$`, 'i');

const INLINE_HASH = new RegExp(`\`${HASH}\``, 'i');

/**
 * True when Markdown holds inline code, the only text that can become a file's badge. Prose without any does not
 * change when the diff arrives, so it need not wait for it.
 */
export function mayNameFile(markdown: string): boolean {
	return markdown.includes('`');
}

/** True when Markdown holds inline code shaped like a commit's hash, the only text the commits can change. */
export function mayNameCommit(markdown: string): boolean {
	return INLINE_HASH.test(markdown);
}

/** `:20` or `:20-30` for the lines a path ends with; empty when it names none. */
function linesLabel(match: RegExpMatchArray | null): string {
	const start = match?.[1] ?? match?.[3];
	const end = match?.[2] ?? match?.[4];

	if (!start) return '';

	return end ? `:${start}-${end}` : `:${start}`;
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

/** The file `code` names, with the lines it gave, when the pull request changes that file. */
function readFile(code: string, paths: readonly string[]): ProseRef | null {
	const lines = code.match(LINES);
	const name = (lines ? code.slice(0, lines.index) : code).replace(/^\.\//, '');
	const path = name ? changedPath(name, paths) : null;

	if (!path) return null;

	return { kind: 'file', path, label: `${path.slice(path.lastIndexOf('/') + 1)}${linesLabel(lines)}` };
}

/**
 * What a span of inline code names in a pull request: a file it changes (with or without lines) or one of its
 * commits by hash. Null for everything else, which stays code: a badge is drawn only for what the page can open.
 */
export function readProseRef(code: string, { paths, commits }: ProseSources): ProseRef | null {
	const file = readFile(code, paths);

	if (file) return file;
	if (!COMMIT_HASH.test(code)) return null;

	const hash = code.toLowerCase();
	const commit = commits.find((candidate) => candidate.sha.startsWith(hash));

	return commit ? { kind: 'commit', commit } : null;
}
