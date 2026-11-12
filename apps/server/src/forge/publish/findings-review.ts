import type { AutoReviewSettings, Finding, ResolvedFinding, Review, ReviewFindingComment } from '@recoder/shared';
import type { PublicationSession } from '../../storage/postgres-publication';
import { db, reviewDiffs } from '../../store';
import { readAutoReviewSettings } from '../watch/settings';
import { PublishConflictError, reviewForge, type PostedComment, type PullReviewForge, type ReviewDraft } from './forge';
import { otherPullReviews, saveFindingsReview } from './record';
import { findingMarker, renderFindingComment, shortSha } from './render';
import { findingsReviewMarker, renderFindingsReview } from './review-body';
import { checkStatus } from './review-check';
import { planFindingsReview, reportableFindings, type InlinePlan, type ReviewPlan } from './review-plan';
import { missingComment, publicationLock, publicationOperation, rejectedCreate } from './shared-publication';
import { suggestionBlock } from './suggestion';

/**
 * A finished review's verified findings on its pull request: one forge review
 * with a summary and inline comments, threads of fixed findings resolved, and
 * a commit status from the severity threshold. Only comments and statuses are
 * written; Recoder never pushes to the pull request's branch.
 */

/** The review's forge, settings and what is already on the pull request, gathered before anything is posted. */
interface Submission {
	review: Review;
	reviews: PullReviewForge;
	provider: 'github' | 'gitlab';
	limit: number;
	settings: AutoReviewSettings;
	plan: ReviewPlan;
	resolved: readonly ResolvedFinding[];
	/** Comments already on the pull request, by finding marker. */
	posted: ReadonlyMap<string, ReviewFindingComment>;
}

/**
 * Submit the review's findings now and answer the review with what was
 * posted. A review whose findings already went up answers as it is, so a
 * repeated delivery posts nothing twice. Throws the forge's error after
 * saving it, or a conflict for a review that has not finished.
 */
export async function publishFindingsReview(reviewId: string): Promise<Review> {
	return publicationOperation(async () => {
		const { key } = await reviewForge(await finishedReview(reviewId));

		return publicationLock(key, (session) => submitLocked(reviewId, session));
	});
}

/** The pipeline's run ended: an automatic review that posts its results submits its findings. Failures are saved on the review. */
export async function submitFindingsAfterRun(reviewId: string): Promise<void> {
	try {
		const review = await db.reviews.get(reviewId);

		if (!review?.trigger || !review.pullComment || review.status !== 'passed') return;
		await publishFindingsReview(reviewId);
	} catch (error) {
		console.warn(`[findings-review] ${reviewId}: ${failureText(error)}`);
	}
}

function failureText(error: unknown): string {
	return error instanceof Error ? error.message : 'Could not submit the findings review.';
}

async function finishedReview(reviewId: string): Promise<Review> {
	const review = await db.reviews.get(reviewId);

	if (!review) throw new Error('review not found');
	if (review.status !== 'passed') throw new PublishConflictError('Only a finished review can post its findings.');
	if (!shortSha(review.headSha)) throw new PublishConflictError('The review has no head commit to comment on.');

	return review;
}

async function submitLocked(reviewId: string, session?: PublicationSession): Promise<Review> {
	const review = await finishedReview(reviewId);

	if (review.findingsReview?.state === 'posted') return review;

	try {
		return await submit(await prepare(review), session);
	} catch (error) {
		await saveFindingsReview(reviewId, { state: 'failed', error: failureText(error) }, {});
		throw error;
	}
}

async function prepare(review: Review): Promise<Submission> {
	const { forge, reviews, provider } = await reviewForge(review);
	const settings = readAutoReviewSettings();
	const resolved = review.resolved ?? [];
	const sources = [...(await earlierReviews(review)), review];
	const markers = [...review.findings, ...resolved.map((item) => item.finding)].map(findingMarker);
	const posted = knownComments(sources, await reviews.inlineByMarker(markers));

	const plan = planFindingsReview({
		findings: review.findings,
		pullDiff: await reviewDiffs.get(review.id),
		settings,
		posted,
		reportedBefore: sources.some((source) => source.findingsReview?.state === 'posted')
	});

	return { review, reviews, provider, limit: forge.limit, settings, plan, resolved, posted };
}

/** Post the summary and comments (when there is anything new), resolve fixed threads, set the check, and save. */
async function submit(submission: Submission, session?: PublicationSession): Promise<Review> {
	const { review, reviews, settings, plan, resolved } = submission;
	const hasNews = plan.inline.length > 0 || plan.listed.length > 0 || resolved.length > 0;
	const summary = hasNews ? await submitOnce(submission, session) : null;
	const comments = { ...plan.carried, ...(await inlineRecords(reviews, plan.inline)) };

	await resolveFixed(submission);

	const url = summary?.url ?? review.pullComment?.url ?? review.prUrl;

	const status = checkStatus(reportableFindings(review.findings, settings.ignoredPaths), settings.checkThreshold, {
		sha: review.headSha,
		url
	});

	if (status) await reviews.setStatus(status);

	const saved = await saveFindingsReview(
		review.id,
		{ state: 'posted', ...(summary ?? {}), error: undefined },
		comments
	);

	return saved ?? review;
}

/** Other reviews of the same pull request created before this one. */
async function earlierReviews(review: Review): Promise<Review[]> {
	return (await otherPullReviews(review)).filter((other) => other.createdAt <= review.createdAt);
}

/** Comments that already show a finding, by its marker: recorded on a review of the pull request, or found on the forge. */
function knownComments(
	sources: readonly Review[],
	onForge: ReadonlyMap<string, PostedComment>
): Map<string, ReviewFindingComment> {
	const known = new Map<string, ReviewFindingComment>();

	for (const source of sources) {
		for (const finding of source.findings) {
			const comment = source.findingComments?.[finding.id];

			if (comment) known.set(findingMarker(finding), comment);
		}
	}

	for (const [marker, comment] of onForge) known.set(marker, { ...comment, inline: true });

	return known;
}

/** The summary and inline comments, submitted once: a summary already on the pull request is kept as it is. */
async function submitOnce(submission: Submission, session?: PublicationSession): Promise<PostedComment> {
	const { review, reviews } = submission;
	const marker = findingsReviewMarker(review.prNumber, review.headSha);
	const drafts = submission.plan.inline.map((item) => draftOf(submission, item));
	const body = (refused: readonly ReviewDraft[]) => summaryBody(submission, refused);

	if (!session) return (await reviews.findReview(marker)) ?? reviews.submitReview(drafts, body);

	const published = await session.publish({
		marker,
		find: async () => {
			const found = await reviews.findReview(marker);

			return found ? { ...found, inline: false } : null;
		},
		edit: async (comment) => comment,
		create: async () => ({ ...(await reviews.submitReview(drafts, body)), inline: false }),
		isMissing: missingComment,
		isRejected: rejectedCreate
	});

	return { id: published.id, url: published.url };
}

function draftOf(submission: Submission, item: InlinePlan): ReviewDraft {
	const { review, provider } = submission;

	const body = renderFindingComment({
		provider,
		prUrl: review.prUrl,
		finding: item.finding,
		headSha: review.headSha,
		inline: true,
		limit: submission.limit,
		...(item.suggestion ? { suggestion: suggestionBlock(provider, item.suggestion) } : {})
	});

	return { marker: item.marker, body, target: item.target, span: item.span };
}

/** The summary, listing the findings the forge would not anchor ahead of the ones that had no line. */
function summaryBody(submission: Submission, refused: readonly ReviewDraft[]): string {
	const { review, plan } = submission;
	const refusedMarkers = new Set(refused.map((draft) => draft.marker));
	const isRefused = (item: InlinePlan) => refusedMarkers.has(item.marker);
	const findings = (items: InlinePlan[]): Finding[] => items.map((item) => item.finding);

	return renderFindingsReview({
		provider: submission.provider,
		prUrl: review.prUrl,
		prNumber: review.prNumber,
		headSha: review.headSha,
		inline: findings(plan.inline.filter((item) => !isRefused(item))),
		listed: [...findings(plan.inline.filter(isRefused)), ...plan.listed],
		resolved: submission.resolved,
		limit: submission.limit
	});
}

/** The inline comments the forge holds for the planned findings, by finding id. */
async function inlineRecords(
	reviews: PullReviewForge,
	inline: readonly InlinePlan[]
): Promise<Record<string, ReviewFindingComment>> {
	if (!inline.length) return {};

	const found = await reviews.inlineByMarker(inline.map((item) => item.marker));
	const records: Record<string, ReviewFindingComment> = {};

	for (const item of inline) {
		const comment = found.get(item.marker);

		if (comment) records[item.finding.id] = { ...comment, inline: true };
	}

	return records;
}

/** Resolve the thread of each finding this review shows fixed, when its comment sits on a line. */
async function resolveFixed(submission: Submission): Promise<void> {
	for (const item of submission.resolved) {
		const comment = submission.posted.get(findingMarker(item.finding));

		if (comment?.inline) await submission.reviews.resolveThread(comment.id);
	}
}
