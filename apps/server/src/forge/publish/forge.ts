import type { Review } from '@recoder/shared';
import { db } from '../../store';
import { detectProvider, parseSlug } from '../providers';
import { tokenEnv } from '../tokens';
import { githubComments } from './github-comments';
import { gitlabComments, gitlabMergeRequest } from './gitlab-comments';
import { githubReviews } from './github-review';
import { gitlabReviews } from './gitlab-review';
import { hostOfRepoUrl } from '../gitlab-host';
import { GhError } from '../cli';

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
	findInline(marker: string): Promise<PostedComment | null>;
	/** A new comment; on GitLab a reply in `discussionId` when one is given. */
	create(body: string, discussionId?: string): Promise<PostedComment>;
	edit(id: string, body: string): Promise<PostedComment>;
	/** A comment on one diff line. Throws when the forge refuses the position. */
	createInline(body: string, target: InlineTarget): Promise<PostedComment>;
	editInline(id: string, body: string): Promise<PostedComment>;
}

/** One inline comment of a batched review, found again later by the finding's `marker` in its body. */
export interface ReviewDraft {
	marker: string;
	body: string;
	target: InlineTarget;
	/** Lines above `target` the comment also covers (a suggestion's range); 0 for one line. */
	span: number;
}

/** The name Recoder's commit status carries: GitHub's status context, GitLab's status name. */
export const CHECK_NAME = 'recoder';

/** The commit status Recoder sets on the review's head commit. */
export interface CommitStatus {
	sha: string;
	state: 'success' | 'failure';
	description: string;
	/** Where the status links: the posted review, else the pull request. */
	url: string | null;
}

/**
 * Submitting a finished review's verified findings on one pull or merge
 * request: a summary with inline comments, thread resolution and a commit
 * status. GitHub and GitLab each implement it.
 */
export interface PullReviewForge {
	/** Recoder's inline comments on the pull request whose body holds one of `markers`, by marker. */
	inlineByMarker(markers: readonly string[]): Promise<Map<string, PostedComment>>;
	/** The submitted review (GitHub) or summary note (GitLab) whose body holds `marker`, or null. */
	findReview(marker: string): Promise<PostedComment | null>;
	/**
	 * Submit the summary and the inline comments. A draft whose position the
	 * forge refuses is left out and handed to `body`, which renders the summary
	 * so the finding is listed there instead.
	 */
	submitReview(
		drafts: readonly ReviewDraft[],
		body: (refused: readonly ReviewDraft[]) => string
	): Promise<PostedComment>;
	/** Resolve the thread an inline comment started; false when it was already resolved or is gone. */
	resolveThread(commentId: string): Promise<boolean>;
	setStatus(status: CommitStatus): Promise<void>;
}

/** A comment that cannot be written in this state: a local repository, a draft, or a review a newer one replaced. */
export class PublishConflictError extends Error {}

export class InlinePreparationError extends GhError {
	constructor(error: unknown) {
		super(
			error instanceof GhError ? error.kind : 'unknown',
			error instanceof Error ? error.message : 'Could not prepare an inline comment.'
		);

		this.name = 'InlinePreparationError';
		this.cause = error;
	}
}

/** The forge refused a comment's position (or could not place it yet), so the comment belongs off the diff. */
export function rejectedPosition(error: unknown): boolean {
	return (
		error instanceof GhError &&
		error.kind === 'unknown' &&
		(/^GitHub API (400|422):/.test(error.message) ||
			/^[^\n]+ returned (400|422):/.test(error.message) ||
			/^GitLab has not computed this merge request/.test(error.message))
	);
}

/** The review's pull request on the forge it lives on, with the credentials saved for it. */
export async function reviewForge(
	review: Review
): Promise<{ forge: PullCommentForge; reviews: PullReviewForge; provider: 'github' | 'gitlab'; key: string }> {
	const repo = await db.repos.get(review.repoId);

	if (!repo) throw new PublishConflictError('The review’s repository is no longer tracked.');

	const provider = repo.provider ?? detectProvider(repo.url);

	if (provider === 'local')
		throw new PublishConflictError('Local repositories have no pull request to comment on. Use GitHub or GitLab.');

	const slug = parseSlug(repo.url);
	const key = JSON.stringify([provider, hostOfRepoUrl(repo.url), slug.toLowerCase(), review.prNumber]);

	if (provider === 'github') {
		return {
			provider,
			key,
			forge: githubComments(slug, review.prNumber, review.headSha),
			reviews: githubReviews(slug, review.prNumber, review.headSha)
		};
	}

	const mergeRequest = gitlabMergeRequest(slug, review.prNumber, review.prUrl, tokenEnv('gitlab', repo.url));

	const forge = gitlabComments(mergeRequest);

	return { provider, key, forge, reviews: gitlabReviews(mergeRequest, forge) };
}
