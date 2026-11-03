'use client';

import { Button, Tooltip } from '@recoder/ui';
import { MessageSquareShare, TriangleAlert } from 'lucide-react';

import { canComment, commentReview } from '@/lib/review/pull-comment';
import { useReview } from '@/lib/review/review-store';
import { useAction } from '@/lib/shell/use-action';

/** An icon link to a comment Recoder posted on the pull request. */
export function CommentLink({ url, label }: { url: string; label: string }) {
	return (
		<Tooltip content={label} side="bottom">
			<Button variant="ghost" size="icon" asChild>
				<a href={url} target="_blank" rel="noreferrer" aria-label={label}>
					<MessageSquareShare />
				</a>
			</Button>
		</Tooltip>
	);
}

/** What the comment button's tooltip says: the last failure's reason, else what pressing it does. */
function hint(posted: boolean, error: string | undefined): string {
	if (error) return `Couldn’t comment: ${error}`;

	return posted
		? 'Edit Recoder’s comment on the pull request to match this review'
		: 'Post the summary and findings as one comment on the pull request';
}

/**
 * Comment on the pull request from the review header, then link to the
 * comment. Quiet, since Hand off and the verdict hold the louder buttons; a
 * failed last write shows a warning glyph and its reason in the tooltip.
 */
export function PullCommentAction() {
	const show = useReview(canComment);
	const comment = useReview((state) => state.review?.pullComment);
	const action = useAction({ showSuccess: true });

	if (!show) return null;

	const url = comment?.url;
	const error = comment?.state === 'failed' ? comment.error : undefined;

	return (
		<>
			<Tooltip content={hint(!!url, error)} side="bottom">
				<Button variant="ghost" status={action.status} onClick={() => action.run(commentReview)}>
					{error ? <TriangleAlert className="text-danger" aria-label="Last comment failed" /> : null}
					{url ? 'Update PR comment' : 'Comment on PR'}
				</Button>
			</Tooltip>
			{url ? <CommentLink url={url} label="Open the PR comment" /> : null}
		</>
	);
}
