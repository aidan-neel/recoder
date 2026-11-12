import type { PrPerson, PullComment, PullCommit, PullRequest } from '@recoder/shared';
import { isRecoderComment, str } from '../context/sources.js';
import { githubRest } from '../github-rest.js';
import { githubComments } from '../publish/github-comments.js';
import { allPages, chronological, record, splitMessage } from './status.js';

/** The pull request's commits, oldest first, as GitHub lists them. */
export async function githubCommits(slug: string, n: number): Promise<PullCommit[]> {
	const rows = await githubPages(`repos/${slug}/pulls/${n}/commits`);

	return rows.map((row) => {
		const commit = record(row.commit);
		const author = record(commit.author);

		return {
			sha: String(row.sha ?? ''),
			...splitMessage(String(commit.message ?? '')),
			author: githubPerson(row.author, str(author.name)),
			authoredAt: str(author.date) ?? '',
			url: str(row.html_url) ?? null
		};
	});
}

/**
 * Comments on the pull request, submitted review summaries and inline review
 * comments, oldest first. A review that only carries inline comments has no
 * summary of its own, so it is left out; an approval without words stays.
 */
export async function githubConversation(slug: string, n: number): Promise<PullComment[]> {
	const [comments, reviews, inline] = await Promise.all([
		githubPages(`repos/${slug}/issues/${n}/comments`),
		githubPages(`repos/${slug}/pulls/${n}/reviews`),
		githubPages(`repos/${slug}/pulls/${n}/comments`)
	]);

	return chronological([
		...comments.map((row) => githubComment(row, 'comment')),
		...reviews.flatMap(githubReview),
		...inline.map(githubInline)
	]);
}

/** Post a comment on the pull request through the publish helper, then read it back whole. */
export async function githubPostComment(slug: string, pull: PullRequest, body: string): Promise<PullComment> {
	const posted = await githubComments(slug, pull.number, pull.headSha).create(body);

	return githubComment(record(await githubRest(`repos/${slug}/issues/comments/${posted.id}`)), 'comment');
}

/** Every page of a GitHub list endpoint. */
function githubPages(path: string): Promise<Record<string, unknown>[]> {
	return allPages((query) => githubRest(`${path}?${query}`));
}

/** A GitHub user, or the git author's name when the commit is not linked to an account. */
function githubPerson(user: unknown, fallbackName?: string): PrPerson {
	const row = record(user);
	const login = str(row.login);

	if (!login) return { login: fallbackName ?? 'unknown', name: fallbackName ?? null, avatarUrl: null };

	return { login, name: null, avatarUrl: str(row.avatar_url) ?? null };
}

function githubComment(row: Record<string, unknown>, kind: PullComment['kind']): PullComment {
	const author = githubPerson(row.user);
	const body = String(row.body ?? '');

	return {
		id: `${kind}:${String(row.id ?? '')}`,
		kind,
		author,
		body,
		createdAt: str(row.created_at) ?? str(row.submitted_at) ?? '',
		url: str(row.html_url) ?? null,
		byRecoder: isRecoderComment(author.login, body)
	};
}

const REVIEW_VERDICTS: Record<string, PullComment['verdict']> = {
	APPROVED: 'approved',
	CHANGES_REQUESTED: 'changes-requested',
	COMMENTED: 'commented',
	DISMISSED: 'commented'
};

/** A submitted review's summary; a pending review and a wordless comment-only review are left out. */
function githubReview(row: Record<string, unknown>): PullComment[] {
	const verdict = REVIEW_VERDICTS[String(row.state)];
	const body = String(row.body ?? '').trim();

	if (!verdict || (verdict === 'commented' && !body)) return [];

	return [{ ...githubComment(row, 'review'), verdict }];
}

function githubInline(row: Record<string, unknown>): PullComment {
	const line = Number(row.line ?? row.original_line);

	return {
		...githubComment(row, 'inline'),
		path: String(row.path ?? ''),
		...(Number.isInteger(line) && line > 0 ? { line } : {})
	};
}
