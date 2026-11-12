import { GhError } from '../cli';
import { githubRest } from '../github-rest';
import { CHECK_NAME, rejectedPosition, type PostedComment, type PullReviewForge, type ReviewDraft } from './forge';
import { listRows, posted, requireToken } from './github-comments';
import { z } from 'zod';

/** Review threads read per GraphQL page, and the most pages read when looking for one. */
const THREAD_PAGE = 100;

const MAX_THREAD_PAGES = 10;

const THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
	repository(owner: $owner, name: $name) {
		pullRequest(number: $number) {
			reviewThreads(first: ${THREAD_PAGE}, after: $after) {
				pageInfo { hasNextPage endCursor }
				nodes { id isResolved comments(first: 1) { nodes { databaseId } } }
			}
		}
	}
}`;

const RESOLVE_MUTATION = `mutation($threadId: ID!) {
	resolveReviewThread(input: { threadId: $threadId }) { thread { isResolved } }
}`;

const threadsSchema = z.object({
	repository: z.object({
		pullRequest: z.object({
			reviewThreads: z.object({
				pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
				nodes: z.array(
					z.object({
						id: z.string(),
						isResolved: z.boolean(),
						comments: z.object({ nodes: z.array(z.object({ databaseId: z.number().nullable() })) })
					})
				)
			})
		})
	})
});

type ReviewThreads = z.infer<typeof threadsSchema>['repository']['pullRequest']['reviewThreads'];

type ReviewThread = ReviewThreads['nodes'][number];

const graphqlReplySchema = z.object({
	data: z.unknown().optional(),
	errors: z.array(z.object({ message: z.string() })).optional()
});

/**
 * A finished review on a pull request through the REST API: the summary and
 * every inline comment go up in one "create review" request, so the pull
 * request gets one notification and never half a review. Threads resolve
 * through GraphQL, which is the only API that can.
 */
export function githubReviews(slug: string, prNumber: number, headSha: string): PullReviewForge {
	const repo = `repos/${slug}`;
	const [owner, name] = slug.split('/');

	function createReview(drafts: readonly ReviewDraft[], body: string): Promise<unknown> {
		return githubRest(`${repo}/pulls/${prNumber}/reviews`, {
			method: 'POST',
			body: { commit_id: headSha, event: 'COMMENT', body, comments: drafts.map(reviewComment) }
		});
	}

	async function graphql(query: string, variables: Record<string, unknown>): Promise<unknown> {
		const reply = graphqlReplySchema.parse(await githubRest('graphql', { method: 'POST', body: { query, variables } }));
		const failure = reply.errors?.[0]?.message;

		if (failure) throw new GhError('unknown', `GitHub GraphQL: ${failure.slice(0, 300)}`);

		return reply.data;
	}

	/** The review thread the comment opened, searched page by page; null when GitHub no longer has it. */
	async function threadOf(commentId: number): Promise<ReviewThread | null> {
		let after: string | null = null;

		for (let page = 0; page < MAX_THREAD_PAGES; page++) {
			const reply = await graphql(THREADS_QUERY, { owner, name, number: prNumber, after });
			const threads: ReviewThreads = threadsSchema.parse(reply).repository.pullRequest.reviewThreads;

			const match = threads.nodes.find((thread) => thread.comments.nodes[0]?.databaseId === commentId);

			if (match) return match;
			if (!threads.pageInfo.hasNextPage) return null;
			after = threads.pageInfo.endCursor;
		}

		return null;
	}

	return {
		async inlineByMarker(markers) {
			const rows = await listRows(`${repo}/pulls/${prNumber}/comments`);
			const found = new Map<string, PostedComment>();

			for (const marker of markers) {
				const row = rows.find((candidate) => candidate.body?.includes(marker));

				if (row) found.set(marker, posted(row));
			}

			return found;
		},

		async findReview(marker) {
			const row = (await listRows(`${repo}/pulls/${prNumber}/reviews`)).find((item) => item.body?.includes(marker));

			return row ? posted(row) : null;
		},

		async submitReview(drafts, body) {
			requireToken();

			try {
				return posted(await createReview(drafts, body([])));
			} catch (error) {
				if (!drafts.length || !rejectedPosition(error)) throw error;

				return posted(await createReview([], body(drafts)));
			}
		},

		async resolveThread(commentId) {
			requireToken();

			const thread = await threadOf(Number(commentId));

			if (!thread || thread.isResolved) return false;

			await graphql(RESOLVE_MUTATION, { threadId: thread.id });

			return true;
		},

		async setStatus(status) {
			requireToken();

			await githubRest(`${repo}/statuses/${encodeURIComponent(status.sha)}`, {
				method: 'POST',
				body: {
					state: status.state,
					context: CHECK_NAME,
					description: status.description,
					...(status.url ? { target_url: status.url } : {})
				}
			});
		}
	};
}

/** One inline comment of the review: a line, or a range ending at the line when the draft spans lines. */
function reviewComment(draft: ReviewDraft): Record<string, unknown> {
	const side = draft.target.side === 'old' ? 'LEFT' : 'RIGHT';
	const line = draft.target.side === 'old' ? draft.target.oldLine : draft.target.newLine;
	const range = draft.span > 0 && line !== null ? { start_line: line - draft.span, start_side: side } : {};

	return { path: draft.target.path, body: draft.body, line, side, ...range };
}
