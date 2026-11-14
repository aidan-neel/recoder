import { GUIDELINES_PATHS, type Repo, type Review } from '@recoder/shared';
import { git, readBlob } from '../evidence/git';
import { repoFileHost } from '../forge/repo-files';
import { repoGitCopy } from '../repo-files/git-copy';
import { MAX_FILE_BYTES } from '../review/pipeline/change-model/repo';
import { loadRepoInventory, type RepoInventory } from '../review/pipeline/repo-inventory/repo-inventory';
import { repoMap } from '../review/pipeline/repo-inventory/repo-map';
import { db } from '../store';
import { TtlCache } from '../util/ttl-cache';

/** A git copy of the repository on this server, listed at its default branch. */
interface RepoTree {
	root: string;
	sha: string;
	inventory: RepoInventory;
}

/** The longest any one file's text runs in the prompt. */
const FILE_CHARS = 12_000;

/** At most this many files the conversation names are read in full. */
const MAX_NAMED_FILES = 3;

const README = /^readme(\.(md|markdown|rst|txt))?$/i;

/** A path or file name with an extension, as people write them in a message. */
const PATH_TOKEN = /[\w@.-]+(?:\/[\w@.-]+)*\.[A-Za-z0-9]{1,10}\b/g;

/** Bounds a listing or read that runs once for every caller sharing the cache. */
const TREE_TIMEOUT_MS = 20_000;

const trees = new TtlCache<RepoTree | null>(60_000, 20);
const forgeFiles = new TtlCache<string | null>(5 * 60_000, 100);

/** What a chat knows about its repository: the prompt text, and the paths of the files it read to write it. */
export interface RepoContext {
	text: string;
	files: string[];
}

/**
 * What a chat knows about its repository, as prompt text: where it is, a map
 * of its packages, its README and Recoder guidelines, the files the person
 * names in `questions` (newest first), and its recent reviews. The map and
 * named files need a git copy on this server: the repository itself when it
 * is local, else the shared copy reviews borrow from (`repoGitCopy`).
 */
export async function repoContext(repo: Repo, questions: string[], signal: AbortSignal): Promise<RepoContext> {
	const tree = await repoTree(repo);

	const readFile = (path: string) => readRepoFile(repo, tree, path, signal);

	const readmePath = tree?.inventory.files.find((file) => README.test(file.path))?.path ?? 'README.md';
	const guidelinesPath = tree ? GUIDELINES_PATHS.find((path) => tree.inventory.byPath.has(path)) : GUIDELINES_PATHS[0];
	const named = tree ? namedFiles(questions, tree.inventory) : [];

	const [readme, guidelines, ...files] = await Promise.all([
		readFile(readmePath),
		guidelinesPath ? readFile(guidelinesPath) : null,
		...named.map(readFile)
	]);

	const text = [
		`Repository: ${repo.name} (${repo.url}), default branch ${repo.defaultBranch}.`,
		tree ? `Map at ${tree.sha.slice(0, 12)}:\n${repoMap(tree.inventory, [])}` : 'No file listing on this server yet.',
		section(readmePath, readme),
		guidelinesPath ? section(`${guidelinesPath} (the repository's review guidelines)`, guidelines) : '',
		...named.map((path, index) => section(path, files[index])),
		await recentReviews(repo.id)
	]
		.filter(Boolean)
		.join('\n\n');

	const read = [
		{ path: readmePath, text: readme },
		...(guidelinesPath ? [{ path: guidelinesPath, text: guidelines }] : []),
		...named.map((path, index) => ({ path, text: files[index] }))
	];

	return { text, files: read.filter((file) => file.text !== null).map((file) => file.path) };
}

/** The text of a file at the repository's default branch, or null when the repository has no such readable file. */
export async function readRepoText(repo: Repo, path: string, signal: AbortSignal): Promise<string | null> {
	return readRepoFile(repo, await repoTree(repo), path, signal);
}

async function repoTree(repo: Repo): Promise<RepoTree | null> {
	return trees
		.get(repo.id, () => findTree(repo))
		.catch((error: unknown) => {
			console.warn('[chat] could not list the repository; answering without its map', repo.id, error);

			return null;
		});
}

/**
 * The paths in the repository that the messages name, newest message first:
 * an exact path, or a file name or partial path only one file ends with.
 */
export function namedFiles(messages: string[], inventory: RepoInventory): string[] {
	const found: string[] = [];

	for (const message of messages) {
		for (const token of message.match(PATH_TOKEN) ?? []) {
			const path = matchPath(token.replace(/^\.\//, ''), inventory);

			if (path && !found.includes(path)) found.push(path);
			if (found.length === MAX_NAMED_FILES) return found;
		}
	}

	return found;
}

function matchPath(token: string, inventory: RepoInventory): string | null {
	if (inventory.byPath.has(token)) return token;

	const matches = inventory.files.filter((file) => file.path.endsWith(`/${token}`));

	return matches.length === 1 ? matches[0].path : null;
}

/**
 * The repository's git copy on this server at its default branch, cloned now
 * when there is none; null when it can't be made or read within the budget.
 */
async function findTree(repo: Repo): Promise<RepoTree | null> {
	const copy = await repoGitCopy(repo, TREE_TIMEOUT_MS);

	if (copy.state !== 'ready') return null;

	const root = copy.path;
	const signal = AbortSignal.timeout(TREE_TIMEOUT_MS);

	const sha =
		(await commitOf(root, `refs/heads/${repo.defaultBranch}`, signal)) ?? (await commitOf(root, 'HEAD', signal));

	if (!sha) return null;

	return { root, sha, inventory: await loadRepoInventory(root, sha, signal) };
}

async function commitOf(root: string, revision: string, signal: AbortSignal): Promise<string | null> {
	const parsed = await git(root, ['rev-parse', '--verify', '--quiet', `${revision}^{commit}`], signal);

	return parsed.code === 0 ? parsed.stdout.trim() : null;
}

/**
 * A file's text from the git copy, else from the forge; null when neither has
 * it. A file in the git copy larger than `MAX_FILE_BYTES` is not read at all,
 * since the prompt keeps only its first `FILE_CHARS` characters.
 */
async function readRepoFile(
	repo: Repo,
	tree: RepoTree | null,
	path: string,
	signal: AbortSignal
): Promise<string | null> {
	if (tree) {
		const size = tree.inventory.byPath.get(path)?.size;

		if (size === undefined || size > MAX_FILE_BYTES) return null;

		const blob = await readBlob(tree.root, tree.sha, path, signal);

		return blob.ok ? blob.text : null;
	}

	return forgeFiles.get(`${repo.id}:${path}`, async () => {
		try {
			return (await repoFileHost(repo).readFile(path, repo.defaultBranch))?.content ?? null;
		} catch {
			return null;
		}
	});
}

function section(title: string, text: string | null): string {
	if (text === null) return '';

	const cut = text.length > FILE_CHARS ? `${text.slice(0, FILE_CHARS)}\n…[truncated]` : text;

	return `--- ${title} ---\n${cut}`;
}

/** The repository's latest reviews: each pull request, how it went and what it found. */
async function recentReviews(repoId: string): Promise<string> {
	const reviews = (await db.reviews.list())
		.filter((review) => review.repoId === repoId)
		.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
		.slice(0, 8);

	if (reviews.length === 0) return 'No reviews of this repository yet.';

	return `Recent reviews:\n${reviews.map(describeReview).join('\n')}`;
}

function describeReview(review: Review): string {
	const findings = review.findings
		.slice(0, 5)
		.map(
			(finding) =>
				`  - ${finding.severity} ${finding.file}${finding.line ? `:${finding.line}` : ''}: ${finding.title ?? finding.message.slice(0, 160)}`
		);

	return [
		`- #${review.prNumber} ${review.prTitle ?? ''} (${review.status}, ${review.findings.length} findings)${review.summary ? `: ${review.summary.slice(0, 300)}` : ''}`,
		...findings
	].join('\n');
}
