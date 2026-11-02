import { GhError } from '../cli';
import { githubRest, githubToken } from '../github-rest';
import type { PostedComment, PullCommentForge } from './forge';

/** GitHub's limit on a comment body, in characters. */
const GITHUB_LIMIT = 65_536;

/** Pages of issue comments searched for Recoder's marker; a pull request with more than 1,000 comments gets a new one. */
const MAX_PAGES = 10;

interface GithubComment {
	id?: unknown;
	body?: unknown;
	html_url?: unknown;
}

function posted(value: unknown): PostedComment {
	const comment = value as GithubComment | null;

	if (typeof comment?.id !== 'number' || typeof comment.html_url !== 'string')
		throw new GhError('unknown', 'GitHub answered without the comment it posted.');

	return { id: String(comment.id), url: comment.html_url };
}

/** Writes need a token; say so before GitHub answers with a bare 404 for a private repository. */
function requireToken(): void {
	if (!githubToken())
		throw new GhError('auth', 'Add a GitHub API token with pull request write access in Settings → Connections.');
}

/**
 * Pull request comments through the REST API: the summary is an issue
 * comment, a finding a review comment on the head commit's diff.
 */
export function githubComments(slug: string, prNumber: number, headSha: string): PullCommentForge {
	const repo = `repos/${slug}`;

	return {
		limit: GITHUB_LIMIT,

		async find(marker) {
			for (let page = 1; page <= MAX_PAGES; page++) {
				const rows = (await githubRest(
					`${repo}/issues/${prNumber}/comments?per_page=100&page=${page}`
				)) as GithubComment[];

				const match = rows.find((row) => typeof row.body === 'string' && row.body.includes(marker));

				if (match) return posted(match);
				if (rows.length < 100) break;
			}

			return null;
		},

		async create(body) {
			requireToken();

			return posted(await githubRest(`${repo}/issues/${prNumber}/comments`, { method: 'POST', body: { body } }));
		},

		async edit(id, body) {
			requireToken();

			return posted(await githubRest(`${repo}/issues/comments/${id}`, { method: 'PATCH', body: { body } }));
		},

		async createInline(body, target) {
			requireToken();

			const line = target.side === 'old' ? target.oldLine : target.newLine;

			return posted(
				await githubRest(`${repo}/pulls/${prNumber}/comments`, {
					method: 'POST',
					body: {
						body,
						commit_id: headSha,
						path: target.path,
						line,
						side: target.side === 'old' ? 'LEFT' : 'RIGHT'
					}
				})
			);
		},

		async editInline(id, body) {
			requireToken();

			return posted(await githubRest(`${repo}/pulls/comments/${id}`, { method: 'PATCH', body: { body } }));
		}
	};
}
