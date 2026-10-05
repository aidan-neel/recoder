import type { PrRef } from '../../review/pipeline/intent/types.js';
import type { CommentRow, ForgeAdapter, PullRows, StackRow } from '../context/gather.js';
import { toPrRef, type IssueKey } from '../context/sources.js';
import { localGit, localGitOutput, localGitSucceeds } from './git.js';
import { localHeadSha, localPullUrl } from './pulls.js';
import {
	findLocalPull,
	localRepoPath,
	readLocalForge,
	type LocalComment,
	type LocalForge,
	type LocalPull
} from './schema.js';

/** A local issue's address, shaped like the pull URL. */
function localIssueUrl(repoUrl: string, n: number): string {
	return `${repoUrl}#issues/${n}`;
}

/** Comments in file order; the position breaks ties between comments stamped with the same time. */
function commentRows(comments: LocalComment[] | undefined): CommentRow[] {
	return (comments ?? []).map((comment, index) => ({
		id: String(index),
		author: comment.author,
		at: comment.createdAt,
		body: comment.body
	}));
}

function prRef(repoUrl: string, pull: LocalPull): PrRef | null {
	return toPrRef({
		number: pull.number,
		title: pull.title,
		url: localPullUrl(repoUrl, pull.number),
		state: pull.state,
		headRef: pull.headRef,
		baseRef: pull.baseRef
	});
}

/** One `git log` record: sha, author, date and message split by unit separators. */
const COMMIT_FORMAT = '--format=%H%x1f%an%x1f%aI%x1f%B%x1e';

/** Reads a local pull request and what surrounds it from the repo's metadata file and its git history. */
export function localAdapter(repoUrl: string, slug: string, prNumber: number, signal: AbortSignal): ForgeAdapter {
	const repoPath = localRepoPath(repoUrl);
	let loaded: Promise<LocalForge> | undefined;
	const forge = () => (loaded ??= readLocalForge(repoUrl));
	const self = async () => findLocalPull(await forge(), prNumber);

	const issueOf = async (key: IssueKey) =>
		key.repo === null ? ((await forge()).issues.find((issue) => issue.number === key.number) ?? null) : null;

	return {
		slug,

		async pull(): Promise<PullRows> {
			const pull = await self();

			return {
				number: pull.number,
				title: pull.title,
				body: pull.body,
				url: localPullUrl(repoUrl, pull.number),
				author: pull.author,
				at: pull.createdAt,
				headRef: pull.headRef,
				baseRef: pull.baseRef,
				headSha: await localHeadSha(repoPath, pull.number, signal),
				people: {
					author: pull.author,
					reviewers: pull.reviewers ?? [],
					assignees: pull.assignees ?? [],
					labels: pull.labels ?? [],
					milestone: null,
					draft: pull.draft === true
				}
			};
		},

		async closingIssues(): Promise<IssueKey[]> {
			return ((await self()).closes ?? []).map((number) => ({ repo: null, number }));
		},

		async issue(key) {
			const issue = await issueOf(key);

			if (!issue) return null;

			return {
				title: issue.title,
				body: issue.body,
				url: localIssueUrl(repoUrl, issue.number),
				author: issue.author,
				at: issue.createdAt
			};
		},

		async issueComments(key) {
			return commentRows((await issueOf(key))?.comments);
		},

		async conversation() {
			const pull = await self();

			return {
				comments: commentRows(pull.comments),
				threads: (pull.threads ?? []).map((thread) => ({
					path: thread.path,
					line: thread.line,
					comments: commentRows(thread.comments)
				}))
			};
		},

		async commits(pull) {
			const { baseSha } = await self();

			const log = await localGitOutput(
				repoPath,
				['log', '--reverse', COMMIT_FORMAT, `${baseSha}..${pull.headSha}`],
				signal
			);

			return log.split('\x1e').flatMap((record) => {
				const [sha, author, at, message] = record.replace(/^\n/, '').split('\x1f');

				return sha && message !== undefined ? [{ sha, author, at, message: message.trim() }] : [];
			});
		},

		async openPulls(filter) {
			return (await forge()).pulls
				.filter(
					(pull) =>
						pull.state === 'open' && ('head' in filter ? pull.headRef === filter.head : pull.baseRef === filter.base)
				)
				.flatMap((pull): StackRow[] => {
					const ref = prRef(repoUrl, pull);

					return ref ? [{ ref, body: pull.body, author: pull.author, at: pull.createdAt }] : [];
				});
		}
	};
}

/** Pull numbers whose head ref contains `sha`, in one pass over the refs. */
async function pullsContaining(repoPath: string, sha: string, signal: AbortSignal): Promise<number[]> {
	const refs = await localGit(
		repoPath,
		['for-each-ref', '--contains', sha, '--format=%(refname)', 'refs/pull'],
		signal
	);

	return refs.split('\n').flatMap((ref) => {
		const match = /^refs\/pull\/(\d+)\/head$/.exec(ref);

		return match ? [Number(match[1])] : [];
	});
}

/** Whether `ancestor` is reachable from `commit` (or is it). */
function isAncestor(repoPath: string, ancestor: string, commit: string, signal: AbortSignal): Promise<boolean> {
	return localGitSucceeds(repoPath, ['merge-base', '--is-ancestor', ancestor, commit], signal);
}

/**
 * The pull request a squash-merged commit on the default branch names in its
 * subject, `Fix the parser (#123)`, as GitHub writes them; history imported from
 * GitHub lands this way.
 */
async function pullFromSubject(
	repoPath: string,
	forge: LocalForge,
	sha: string,
	signal: AbortSignal
): Promise<LocalPull | null> {
	const subject = await localGit(repoPath, ['log', '-1', '--format=%s', sha], signal);
	const number = Number(/\(#(\d+)\)\s*$/.exec(subject)?.[1]);
	const pull = forge.pulls.find((row) => row.number === number);

	if (!pull) return null;

	return (await isAncestor(repoPath, sha, `refs/heads/${forge.defaultBranch}`, signal)) ? pull : null;
}

/**
 * The pull requests a commit landed in: an open or merged pull whose commits
 * (`baseSha..head`) include it, one whose `mergeSha` is it, or the pull a
 * default-branch commit names in its subject.
 */
export async function localPrsForCommit(repoUrl: string, sha: string, signal: AbortSignal): Promise<PrRef[]> {
	const repoPath = localRepoPath(repoUrl);
	const forge = await readLocalForge(repoUrl);
	const commit = await localGit(repoPath, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`], signal);
	const containing = new Set(await pullsContaining(repoPath, commit, signal));

	const inRange = await Promise.all(
		forge.pulls.map(async (pull) => {
			if (pull.mergeSha === commit) return pull;
			if (pull.state === 'closed' || !containing.has(pull.number)) return null;

			return (await isAncestor(repoPath, commit, pull.baseSha, signal)) ? null : pull;
		})
	);

	const named = await pullFromSubject(repoPath, forge, commit, signal);
	const found = new Map<number, LocalPull>();

	for (const pull of [...inRange, named]) if (pull) found.set(pull.number, pull);

	return [...found.values()]
		.sort((a, b) => a.number - b.number)
		.flatMap((pull) => {
			const ref = prRef(repoUrl, pull);

			return ref ? [ref] : [];
		});
}
