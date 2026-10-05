import type { PullFile, PullRequest } from '@recoder/shared';
import { GhError } from '../cli.js';
import type { FetchedPull } from '../gh.js';
import { localGit, localGitOutput } from './git.js';
import { findLocalPull, localRepoPath, readLocalForge, type LocalPull } from './schema.js';

/** Where a local pull request's head lives, as on GitHub, so the GitHub fetch refspec works against it. */
function pullHeadRef(n: number): string {
	return `refs/pull/${n}/head`;
}

/**
 * A local pull request's address: the repo URL with the pull in the fragment,
 * so `pull/N` reads like a GitHub pull URL. Browsers won't open `file:` links
 * from the app, so this identifies the PR rather than linking to a page.
 */
export function localPullUrl(repoUrl: string, n: number): string {
	return `${repoUrl}#pull/${n}`;
}

/**
 * The head commit, always from `refs/pull/N/head` and never the metadata file,
 * so it matches what the sandbox fetches. A missing ref reads as a missing PR.
 */
export async function localHeadSha(repoPath: string, n: number, signal?: AbortSignal): Promise<string> {
	return localGit(repoPath, ['rev-parse', '--verify', '--quiet', `${pullHeadRef(n)}^{commit}`], signal).catch(() => {
		throw new GhError('not-found', `Pull request #${n} has no ${pullHeadRef(n)} in the repository`);
	});
}

/** A numstat count; binary files print `-`. */
function lineCount(text: string): number {
	return text === '-' ? 0 : Number(text);
}

/**
 * Per-file line counts from `git diff --numstat -z`. A rename leaves the path
 * field empty and prints the old and new paths as the next two fields.
 */
function parseNumstat(output: string): PullFile[] {
	const fields = output.split('\0');
	const files: PullFile[] = [];

	for (let i = 0; i < fields.length; i++) {
		const match = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(fields[i]);

		if (!match) continue;

		let path = match[3];

		if (!path) {
			path = fields[i + 2] ?? '';
			i += 2;
		}

		files.push({ path, additions: lineCount(match[1]), deletions: lineCount(match[2]) });
	}

	return files;
}

/** The pull request as the app shows it, with per-file counts from `baseSha` to the head ref. */
async function describePull(repoUrl: string, pull: LocalPull): Promise<{ pr: PullRequest; files: PullFile[] }> {
	const repoPath = localRepoPath(repoUrl);
	const headSha = await localHeadSha(repoPath, pull.number);

	const files = parseNumstat(
		await localGitOutput(repoPath, ['diff', '--numstat', '-z', '--find-renames', pull.baseSha, headSha, '--'])
	);

	return {
		pr: {
			number: pull.number,
			title: pull.title,
			url: localPullUrl(repoUrl, pull.number),
			author: pull.author,
			base: pull.baseRef,
			headRef: pull.headRef,
			headSha,
			additions: files.reduce((sum, file) => sum + file.additions, 0),
			deletions: files.reduce((sum, file) => sum + file.deletions, 0),
			changedFiles: files.length,
			createdAt: pull.createdAt,
			body: pull.body,
			assignees: (pull.assignees ?? []).map((login) => ({ login, name: null, avatarUrl: null }))
		},
		files
	};
}

/** Open pull requests, newest first, like `gh pr list`. */
export async function listLocalPulls(repoUrl: string): Promise<PullRequest[]> {
	const forge = await readLocalForge(repoUrl);

	const open = forge.pulls
		.filter((pull) => pull.state === 'open')
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.number - a.number);

	return Promise.all(open.map(async (pull) => (await describePull(repoUrl, pull)).pr));
}

/** One pull request with its per-file counts, in any state. Throws a not-found GhError for an unknown number. */
export async function localPullPreview(repoUrl: string, n: number): Promise<{ pr: PullRequest; files: PullFile[] }> {
	return describePull(repoUrl, findLocalPull(await readLocalForge(repoUrl), n));
}

/** PR metadata plus the unified diff from `baseSha` to the head ref, unless `metadataOnly`. */
export async function fetchLocalPull(
	repoUrl: string,
	n: number,
	opts?: { metadataOnly?: boolean }
): Promise<FetchedPull> {
	const pull = findLocalPull(await readLocalForge(repoUrl), n);
	const { pr } = await describePull(repoUrl, pull);

	if (opts?.metadataOnly) return { pr, diff: '' };

	const diff = await localGitOutput(localRepoPath(repoUrl), [
		'diff',
		'--no-ext-diff',
		'--no-textconv',
		'--no-color',
		'--src-prefix=a/',
		'--dst-prefix=b/',
		pull.baseSha,
		pr.headSha,
		'--'
	]);

	return { pr, diff };
}
