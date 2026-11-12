import type { Review } from '@recoder/shared';
import { db } from '../../store';
import { detectProvider, parseSlug } from '../providers';
import { tokenEnv } from '../tokens';
import { githubComments } from './github-comments';
import { gitlabComments } from './gitlab-comments';

/** A comment Recoder posted, as the forge names and links it. */
export interface PostedComment {
	id: string;
	url: string;
}

/** A line of the pull request's diff to comment on. `oldLine` and `newLine` are null on the side the line is not on. */
export interface InlineTarget {
	path: string;
	oldPath: string;
	side: 'old' | 'new';
	oldLine: number | null;
	newLine: number | null;
}

/**
 * Writing comments on one pull or merge request. GitHub and GitLab each
 * implement it, so the review lifecycle never branches on the forge.
 */
export interface PullCommentForge {
	/** The longest comment body the forge accepts. */
	limit: number;
	/** Recoder's earliest comment whose body holds `marker`, or null. */
	find(marker: string): Promise<PostedComment | null>;
	/** A new comment; on GitLab a reply in `discussionId` when one is given. */
	create(body: string, discussionId?: string): Promise<PostedComment>;
	edit(id: string, body: string): Promise<PostedComment>;
	/** A comment on one diff line. Throws when the forge refuses the position. */
	createInline(body: string, target: InlineTarget): Promise<PostedComment>;
	editInline(id: string, body: string): Promise<PostedComment>;
}

/** A comment that cannot be written in this state: a local repository, a draft, or a review a newer one replaced. */
export class PublishConflictError extends Error {}

/** The review's pull request on the forge it lives on, with the credentials saved for it. */
export async function reviewForge(review: Review): Promise<{ forge: PullCommentForge; provider: 'github' | 'gitlab' }> {
	const repo = await db.repos.get(review.repoId);

	if (!repo) throw new PublishConflictError('The review’s repository is no longer tracked.');

	const provider = repo.provider ?? detectProvider(repo.url);

	if (provider === 'local')
		throw new PublishConflictError('Local repositories have no pull request to comment on. Use GitHub or GitLab.');

	const slug = parseSlug(repo.url);

	if (provider === 'github') return { provider, forge: githubComments(slug, review.prNumber, review.headSha) };

	return { provider, forge: gitlabComments(slug, review.prNumber, review.prUrl, tokenEnv('gitlab', repo.url)) };
}
