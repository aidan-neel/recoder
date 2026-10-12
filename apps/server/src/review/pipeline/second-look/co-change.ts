import { git } from '../../../evidence/git.js';
import { byCodePoint, mapLimit } from '../change-model/repo.js';

/** A file that changed alongside one of a unit's paths in most of the commits that touched it. */
export interface CoChange {
	/** The file the pull request leaves unchanged. */
	file: string;
	/** The unit's path, or the folder of an added file, whose history it shares. */
	with: string;
	/** Commits that changed both. */
	together: number;
	/** Commits read for `with`. */
	of: number;
}

/** One changed file of a unit, as its history is looked up. */
interface CoChangeFile {
	path: string;
	/** The path at the base, for a rename. */
	oldPath?: string;
	added: boolean;
}

/** What the lookup reads: the checkout, the merge base, the unit's files and every path the change touches. */
export interface CoChangeInput {
	checkoutPath: string;
	baseSha: string;
	files: CoChangeFile[];
	changed: ReadonlySet<string>;
	signal: AbortSignal;
}

/** Commits read per path; recent history says more about today's conventions than old history. */
const HISTORY_DEPTH = 40;

/** A commit touching more files than this is a sweep (a rename, a format run) and says nothing about pairs. */
const MAX_COMMIT_FILES = 30;

const MIN_TOGETHER = 3;
const MIN_SHARE = 0.5;
const MAX_HINTS = 5;
const MAX_PATHS = 12;
const PARALLEL = 4;

/** Folders above an added file tried before giving up, for a file added in a new folder. */
const MAX_FOLDER_STEPS = 2;

const RECORD = '\x1e';

/** The commits in `git log --format=%x1e --name-only` output, each as the files it changed. */
function parseLogFiles(stdout: string): string[][] {
	return stdout
		.split(RECORD)
		.map((record) =>
			record
				.split('\n')
				.map((line) => line.trim())
				.filter(Boolean)
		)
		.filter((files) => files.length > 0);
}

/**
 * The files that changed with `anchor` in at least three of the commits read
 * and in at least half of them, sweeping commits left out, never a file in
 * `skip` or the anchor itself. Highest share first.
 */
export function companions(commits: string[][], anchor: string, skip: ReadonlySet<string>): CoChange[] {
	const read = commits.filter((files) => files.length <= MAX_COMMIT_FILES);
	const counts = new Map<string, number>();

	for (const files of read) {
		for (const file of new Set(files)) {
			if (file !== anchor && !skip.has(file)) counts.set(file, (counts.get(file) ?? 0) + 1);
		}
	}

	return [...counts]
		.filter(([, together]) => together >= MIN_TOGETHER && together / read.length >= MIN_SHARE)
		.map(([file, together]) => ({ file, with: anchor, together, of: read.length }))
		.sort(byShare);
}

function byShare(a: CoChange, b: CoChange): number {
	return b.together / b.of - a.together / a.of || b.together - a.together || byCodePoint(a.file, b.file);
}

function folderOf(path: string): string {
	const slash = path.lastIndexOf('/', path.endsWith('/') ? path.length - 2 : path.length);

	return slash < 0 ? '' : path.slice(0, slash + 1);
}

async function commitsTouching(input: CoChangeInput, pathspec: string): Promise<string[][]> {
	const log = await git(
		input.checkoutPath,
		[
			'-c',
			'core.quotePath=false',
			'log',
			`-n${HISTORY_DEPTH}`,
			'--format=%x1e',
			'--name-only',
			'--full-diff',
			'--no-renames',
			input.baseSha,
			'--',
			pathspec
		],
		input.signal
	);

	return log.code === 0 ? parseLogFiles(log.stdout) : [];
}

/**
 * The companions of one changed file: by its own history when it existed at
 * the base, else by the history of the nearest folder above it that has one.
 */
async function fileCompanions(input: CoChangeInput, file: CoChangeFile): Promise<CoChange[]> {
	if (!file.added) {
		const anchor = file.oldPath ?? file.path;

		return companions(await commitsTouching(input, anchor), anchor, input.changed);
	}

	let folder = folderOf(file.path);

	for (let step = 0; folder && step <= MAX_FOLDER_STEPS; step++, folder = folderOf(folder)) {
		const commits = await commitsTouching(input, folder);

		if (commits.length) return companions(commits, folder, input.changed);
	}

	return [];
}

/**
 * Files that usually change together with the unit's files but that the
 * change leaves alone: a registration, export, version or doc a change like
 * this one normally edits too. Read from the base's history, no model calls;
 * a path whose history can't be read adds nothing.
 */
export async function coChanges(input: CoChangeInput): Promise<CoChange[]> {
	const found = await mapLimit(input.files.slice(0, MAX_PATHS), PARALLEL, (file) =>
		fileCompanions(input, file).catch(() => [])
	);

	const best = new Map<string, CoChange>();

	for (const entry of found.flat()) {
		const kept = best.get(entry.file);

		if (!kept || byShare(entry, kept) < 0) best.set(entry.file, entry);
	}

	return [...best.values()].sort(byShare).slice(0, MAX_HINTS);
}
