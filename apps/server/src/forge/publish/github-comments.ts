import { GhError } from '../cli';
import { githubRest, githubToken } from '../github-rest';
import type { PostedComment, PullCommentForge } from './forge';
import { PublishConflictError } from './forge';
import { z } from 'zod';

/** GitHub's limit on a comment body, in characters. */
const GITHUB_LIMIT = 65_536;

/** The maximum pages searched before refusing an incomplete marker lookup. */
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

	const rowsSchema = z.array(
		z.object({ id: z.number(), html_url: z.string(), body: z.string().nullable().optional() })
	);

	async function find(path: string, marker: string): Promise<PostedComment | null> {
		for (let page = 1; page <= MAX_PAGES; page++) {
			const rows = rowsSchema.parse(await githubRest(`${path}?per_page=100&page=${page}`));
			const match = rows.find((row) => row.body?.includes(marker));

			if (match) return posted(match);
			if (rows.length < 100) return null;
		}

		throw new PublishConflictError(
			'The pull request has too many comments to establish whether Recoder already posted. Check its comments before retrying.'
		);
	}

	return {
		limit: GITHUB_LIMIT,
		find: (marker) => find(`${repo}/issues/${prNumber}/comments`, marker),
		findInline: (marker) => find(`${repo}/pulls/${prNumber}/comments`, marker),

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
