import { GhError } from '../cli';
import {
	CHECK_NAME,
	rejectedPosition,
	type PostedComment,
	type PullCommentForge,
	type PullReviewForge,
	type ReviewDraft
} from './forge';
import { diffNotesByMarker, type GitlabMergeRequest } from './gitlab-comments';

/** GitLab refuses to set a commit status to the state it already has; that answer means the status is set. */
const SAME_STATUS = /Cannot transition status/i;

/**
 * A finished review on a merge request. GitLab has no single review call, so
 * each finding becomes a diff discussion (skipping ones an earlier attempt
 * already posted, found by marker), and the summary note goes last, listing
 * the findings GitLab would not anchor.
 */
export function gitlabReviews(mergeRequest: GitlabMergeRequest, comments: PullCommentForge): PullReviewForge {
	const { path: mr, linked, write } = mergeRequest;

	async function inlineByMarker(markers: readonly string[]): Promise<Map<string, PostedComment>> {
		const notes = diffNotesByMarker(await mergeRequest.discussions(), markers);
		const posted = new Map<string, PostedComment>();

		for (const [marker, note] of notes) posted.set(marker, await linked(note));

		return posted;
	}

	/** The draft on its line; null when GitLab refuses the position, so the summary lists it instead. */
	async function postDraft(draft: ReviewDraft): Promise<ReviewDraft | null> {
		try {
			await mergeRequest.createDiffDiscussion(draft.body, draft.target);

			return null;
		} catch (error) {
			if (rejectedPosition(error)) return draft;
			throw error;
		}
	}

	return {
		inlineByMarker,

		findReview: (marker) => comments.find(marker),

		async submitReview(drafts, body) {
			const already = await inlineByMarker(drafts.map((draft) => draft.marker));
			const refused: ReviewDraft[] = [];

			for (const draft of drafts.filter((item) => !already.has(item.marker))) {
				const left = await postDraft(draft);

				if (left) refused.push(left);
			}

			return comments.create(body(refused));
		},

		async resolveThread(commentId) {
			const discussion = (await mergeRequest.discussions()).find((item) =>
				item.notes.some((note) => String(note.id) === commentId)
			);

			if (!discussion || discussion.notes[0]?.resolved) return false;

			await write('PUT', `${mr}/discussions/${encodeURIComponent(discussion.id)}`, { resolved: true });

			return true;
		},

		async setStatus(status) {
			try {
				await write('POST', `${mergeRequest.project}/statuses/${encodeURIComponent(status.sha)}`, {
					state: status.state === 'success' ? 'success' : 'failed',
					name: CHECK_NAME,
					description: status.description,
					...(status.url ? { target_url: status.url } : {})
				});
			} catch (error) {
				if (error instanceof GhError && SAME_STATUS.test(error.message)) return;
				throw error;
			}
		}
	};
}
