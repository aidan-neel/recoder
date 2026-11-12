import { parseUnifiedDiff, type Finding, type Review, type ReviewFindingComment } from '@recoder/shared';
import { db, reviewDiffs } from '../../store';
import { GhError } from '../cli';
import { reviewForge, type InlineTarget, type PullCommentForge } from './forge';
import { saveFindingComment } from './record';
import { findingMarker, renderFindingComment } from './render';
import type { PublicationSession, PublishedComment } from '../../storage/postgres-publication';
import {
	missingComment,
	publicationLock,
	publicationOperation,
	rejectedCreate,
	rejectedPosition
} from './shared-publication';

/** A finding the review no longer holds. */
export class FindingNotFoundError extends Error {}

/**
 * The diff line a finding sits on, or null when the pull request's diff
 * doesn't show that line (forges only take inline comments on shown lines).
 */
export function inlineTarget(finding: Finding, diff: string | undefined): InlineTarget | null {
	if (!finding.line || !diff) return null;

	const side = finding.side ?? 'new';
	const file = parseUnifiedDiff(diff).find((entry) => entry.path === finding.file);

	for (const hunk of file?.hunks ?? []) {
		const line = hunk.lines.find((row) =>
			side === 'old'
				? row.type !== 'add' && row.oldNo === finding.line
				: row.type !== 'del' && row.newNo === finding.line
		);

		if (line) return { path: finding.file, oldPath: finding.file, side, oldLine: line.oldNo, newLine: line.newNo };
	}

	return null;
}

/** Edit the finding's earlier comment; null when someone deleted it. */
async function editKnown(
	forge: PullCommentForge,
	known: ReviewFindingComment,
	body: string
): Promise<ReviewFindingComment | null> {
	try {
		const posted = known.inline ? await forge.editInline(known.id, body) : await forge.edit(known.id, body);

		return { ...posted, inline: known.inline };
	} catch (err) {
		if (err instanceof GhError && err.kind === 'not-found') return null;
		throw err;
	}
}

/** On its line when the forge takes it there; a refused position is not an error, only a reason to post it plainly. */
async function postInline(
	forge: PullCommentForge,
	target: InlineTarget,
	body: string
): Promise<ReviewFindingComment | null> {
	try {
		return { ...(await forge.createInline(body, target)), inline: true };
	} catch (err) {
		if (err instanceof GhError && err.kind === 'unknown') return null;
		throw err;
	}
}

/** Edit the finding's earlier comment, else put it on its line, else post it plainly (editing a plain one found by marker). */
async function post(review: Review, finding: Finding, session?: PublicationSession): Promise<ReviewFindingComment> {
	const { forge, provider } = await reviewForge(review);
	const view = { provider, prUrl: review.prUrl, finding, headSha: review.headSha, limit: forge.limit };
	const known = review.findingComments?.[finding.id];

	if (session) {
		const target = inlineTarget(finding, await reviewDiffs.get(review.id));
		const marker = findingMarker(finding);

		const publish = (inline: boolean) =>
			session.publish({
				marker,
				...(known ? { known } : {}),
				find: async (): Promise<PublishedComment | null> => {
					const located = await forge.findInline(marker);

					if (located) return { ...located, inline: true };

					const plain = await forge.find(marker);

					return plain ? { ...plain, inline: false } : null;
				},
				edit: async (comment) => ({
					...(comment.inline
						? await forge.editInline(comment.id, renderFindingComment({ ...view, inline: true }))
						: await forge.edit(comment.id, renderFindingComment({ ...view, inline: false }))),
					inline: comment.inline
				}),
				create: async () => ({
					...(inline && target
						? await forge.createInline(renderFindingComment({ ...view, inline: true }), target)
						: await forge.create(renderFindingComment({ ...view, inline: false }))),
					inline
				}),
				isMissing: missingComment,
				isRejected: rejectedCreate
			});

		try {
			return await publish(target !== null);
		} catch (error) {
			if (target && rejectedPosition(error)) return publish(false);
			throw error;
		}
	}

	const edited = known && (await editKnown(forge, known, renderFindingComment({ ...view, inline: known.inline })));

	if (edited) return edited;

	const target = inlineTarget(finding, await reviewDiffs.get(review.id));
	const inline = target && (await postInline(forge, target, renderFindingComment({ ...view, inline: true })));

	if (inline) return inline;

	const body = renderFindingComment({ ...view, inline: false });
	const found = await forge.find(findingMarker(finding));

	return { ...(found ? await forge.edit(found.id, body) : await forge.create(body)), inline: false };
}

/**
 * Post one finding to the pull request, on its diff line when the diff shows
 * it, else as a comment that links the line. Posting it again edits the
 * comment instead of adding one. Answers the review with the comment saved.
 */
export async function publishFindingComment(reviewId: string, findingId: string): Promise<Review> {
	return publicationOperation(async () => {
		const initial = await db.reviews.get(reviewId);

		if (!initial?.findings.some((finding) => finding.id === findingId))
			throw new FindingNotFoundError('finding not found');

		const { key } = await reviewForge(initial);

		return publicationLock(key, async (session) => {
			const review = await db.reviews.get(reviewId);
			const finding = review?.findings.find((item) => item.id === findingId);

			if (!review || !finding) throw new FindingNotFoundError('finding not found');

			const comment = await post(review, finding, session);

			return (await saveFindingComment(reviewId, findingId, comment)) ?? review;
		});
	});
}
