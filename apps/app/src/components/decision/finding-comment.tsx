'use client';

import { Button, Tooltip } from '@recoder/ui';

import { CommentLink } from '@/components/review/pull-comment-action';
import { canComment, commentFinding } from '@/lib/review/pull-comment';
import { useReview } from '@/lib/review/review-store';
import type { Decision } from '@/lib/review/surface';
import { useAction } from '@/lib/shell/use-action';

/**
 * Post the finding on its line of the pull request's diff, or update the
 * comment it already has, then link to it. Questions have no line to post on.
 * Keyed by the decision, so a pending post never shows on the next one.
 */
export function FindingComment({ decision }: { decision: Decision }) {
	const show = useReview(canComment);
	const comment = useReview((state) => state.review?.findingComments?.[decision.id]);
	const action = useAction({ showSuccess: true });

	if (!show || decision.kind !== 'finding') return null;

	const hint = comment
		? 'Edit the comment this finding has on the pull request'
		: 'Comment this finding on its line of the pull request';

	return (
		<span className="flex items-center gap-0.5">
			<Tooltip content={hint}>
				<Button variant="ghost" status={action.status} onClick={() => action.run(() => commentFinding(decision.id))}>
					{comment ? 'Update on PR' : 'Post to PR'}
				</Button>
			</Tooltip>
			{comment ? <CommentLink url={comment.url} label="Open the comment" /> : null}
		</span>
	);
}
