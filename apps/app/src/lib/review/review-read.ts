import type { FileDiff, PrCheck, PullRequest, Review } from '@recoder/shared';

import { ApiError, failureKind, failureText, type FailureKind } from '../api/http';
import { reviewsApi } from '../api/reviews';
import { forgeLabel } from '../connections/forges';
import { knownRepoName, repoNames } from './repo-names';
import { cachedReview, rememberReview } from './review-cache';
import { grammarsWhenIdle } from './review-grammars';

/** Why a read failed: the sentence to show, and its kind, which picks the way out. */
export interface ReadFailure {
	text: string;
	kind: FailureKind;
}

/** A read's answer: the value, or why it failed. */
export interface Read<T> {
	value: T;
	error: ReadFailure | null;
}

/** The diff's answer. */
interface DiffRead extends Read<FileDiff[]> {
	/** True when the server has no diff yet (a 404), which is an empty diff, not a failure. */
	missing: boolean;
}

/** A review and its diff, as one read hands them to the page. */
export interface ReviewRead {
	review: Review;
	diff: DiffRead;
	/** The repository's name, when the page already knows it; else null, and the page fills it in once the list answers. */
	repoName: string | null;
	/** The pull request the read's first caller had (the queue's row), so the header paints whole; else null. */
	pull: PullRequest | null;
}

/**
 * A failed read in plain words: why, when the failure says more than that the
 * read failed, else empty. An answer the page could not read (not JSON, or
 * not the shape asked for) is the server's fault, like an error it sent, so
 * Try again is the way out.
 */
export function readFailure(error: unknown): ReadFailure {
	return { text: failureText(error, ''), kind: error instanceof SyntaxError ? 'server' : failureKind(error) };
}

/** The error for an answer that parsed but is not what was asked for; it reads like one that did not parse. */
function wrongShape(what: string): SyntaxError {
	return new SyntaxError(`The server’s answer is not ${what}.`);
}

/**
 * A JSON answer's fields, to check before the page trusts it. Reading a field
 * of `null` or a number this way gives `undefined`, as a missing field does,
 * so a check of a field's type rules those answers out too.
 */
type Fields = Partial<Record<string, unknown>> | null;

/**
 * The server's answer for review `id`, checked for the fields the page reads
 * before it can show anything; throws a `SyntaxError` for any other answer
 * (`null`, a list, another review), as for one that is not JSON.
 */
function checkedReview(value: unknown, id: string): Review {
	const fields = value as Fields;

	const ok =
		fields?.id === id &&
		typeof fields.repoId === 'string' &&
		typeof fields.prNumber === 'number' &&
		typeof fields.headSha === 'string' &&
		typeof fields.status === 'string' &&
		Array.isArray(fields.findings);

	if (!ok) throw wrongShape('a review');

	return value as Review;
}

/** Reads review `id` on its own, checked as {@link checkedReview} checks it. */
export async function fetchReview(id: string): Promise<Review> {
	return checkedReview(await reviewsApi.review(id), id);
}

/** The CI checks on the review's pull request, checked to be a list. */
export async function fetchChecks(id: string): Promise<PrCheck[]> {
	const answer: unknown = await reviewsApi.checks(id);
	const checks = (answer as Fields)?.checks;

	if (!Array.isArray(checks)) throw wrongShape('a list of checks');

	return checks as PrCheck[];
}

/** The review a forge read belongs to, as far as a rejected token's sentence needs it. */
type ForgeReview = Pick<Review, 'repoId' | 'source'> | null;

/**
 * A rejected token in one sentence: the forge, and the repository when the
 * page knows its name (`repoName`, the one it shows, else the list of names).
 */
function rejectedToken(review: ForgeReview, repoName: string | null): string {
	const source = review?.source;
	const forge = source === 'github' || source === 'gitlab' ? forgeLabel(source) : 'The forge';
	const repo = repoName ?? (review ? knownRepoName(review.repoId) : null);

	return repo ? `${forge} rejected the token for ${repo}.` : `${forge} rejected the token.`;
}

/**
 * A failed forge read (the pull request, its CI checks). A rejected token is
 * said with its forge and repository, never in the forge CLI's own words; the
 * store words it again from what it holds as it lands ({@link namedFailure}).
 */
export function forgeFailure(error: unknown, review: ForgeReview): ReadFailure {
	const failure = readFailure(error);

	return failure.kind === 'auth' ? { kind: 'auth', text: rejectedToken(review, null) } : failure;
}

/**
 * A forge read's failure with a rejected token's sentence naming the forge
 * and repository the page knows now; the same object when nothing changed,
 * and any other failure as it is. The store calls it on every write that
 * brings a failure, the review or the repository's name, so the sentence
 * never depends on which of them answered first.
 */
export function namedFailure(
	failure: ReadFailure | null,
	review: ForgeReview,
	repoName: string | null
): ReadFailure | null {
	if (failure?.kind !== 'auth') return failure;

	const text = rejectedToken(review, repoName);

	return text === failure.text ? failure : { kind: 'auth', text };
}

/** The diff. "No diff yet" (a 404) is an empty diff, not a failure; any other failure says why. */
export async function readDiff(id: string): Promise<DiffRead> {
	try {
		const files: unknown = await reviewsApi.files(id);

		if (!Array.isArray(files)) throw wrongShape('a diff');

		return { value: files as FileDiff[], error: null, missing: false };
	} catch (error) {
		if (error instanceof ApiError && error.status === 404) return { value: [], error: null, missing: true };

		return { value: [], error: readFailure(error), missing: false };
	}
}

/** The pull request by number, open or not. A review with no forge behind it (`stub`) has none to read. */
export async function readPull(review: Pick<Review, 'repoId' | 'prNumber' | 'source'>): Promise<Read<PullRequest | null>> {
	if (review.source === 'stub') return { value: null, error: null };

	try {
		return { value: (await reviewsApi.pull(review.repoId, review.prNumber)) ?? null, error: null };
	} catch (error) {
		return { value: null, error: forgeFailure(error, review) };
	}
}

/**
 * Keeps a complete read in memory, so the page paints from it at once, with
 * its diff's grammars loaded once the page is idle, so the code it opens at
 * paints colored; true when the page has a copy to paint from. A review the
 * page already kept is left alone, and a diff that failed or that the server
 * has not made yet is not kept, so the page loads the review itself and asks
 * for the diff again.
 */
function keep({ review, diff, repoName, pull }: ReviewRead): boolean {
	if (diff.error || diff.missing) return false;

	if (!cachedReview(review.id)) {
		rememberReview({ review, files: diff.value, pull, repoName, checks: null, progress: null }, 'never');
		grammarsWhenIdle(diff.value);
	}

	return true;
}

/**
 * Parses the review's brief while the page is idle, from the moment the
 * review is in, while its diff may still be on its way, so the overview's
 * first render finds the brief parsed. The parser's module is asked for as
 * the read starts, so it is usually there by then, and only then, so a page
 * that only reads reviews ahead (the queue) never loads it up front.
 */
async function prepareBrief(review: Promise<Review>): Promise<void> {
	const parser = import('./prepare-brief').catch(() => null);
	const { summary } = await review;
	const loaded = summary ? await parser : null;

	if (summary && loaded) loaded.prepareMarkdown(summary);
}

/**
 * A read the page has no copy of stays joinable this long after it answers
 * (a running review has no diff yet), so the page a navigation opens takes
 * its answer instead of asking again.
 */
const SETTLED_MS = 3000;

/** Reads of a review and its diff in flight, or answered moments ago and not kept, by review id. */
const flights = new Map<string, Promise<ReviewRead>>();

/**
 * Reads a review with its diff, joining a read of the same review in flight
 * or just answered, so a read ahead, a navigation that waits for the review
 * and the page's own load ask the server once. The repository's name never
 * holds it up: the list of names is asked for beside it, and the answer
 * carries the name when the page knows it by then; the page fills it in
 * later otherwise. The answer carries `pull` (the queue's copy, when the
 * first caller has one), and a complete answer is kept in memory with it.
 * The review's brief is parsed once the page is idle ({@link prepareBrief}).
 * Rejects when the review cannot be read: a failed request, or a
 * `SyntaxError` for an answer the page cannot read. A failed read is dropped
 * at once, so the next caller asks again.
 */
export function readReview(id: string, pull: PullRequest | null = null): Promise<ReviewRead> {
	const pending = flights.get(id);

	if (pending) return pending;

	void repoNames().catch(() => null);

	const reading = fetchReview(id);

	prepareBrief(reading).catch(() => undefined);

	const flight = Promise.all([reading, readDiff(id)]).then(([review, diff]) => ({
		review,
		diff,
		repoName: knownRepoName(review.repoId),
		pull
	}));

	const forget = () => {
		if (flights.get(id) === flight) flights.delete(id);
	};

	flights.set(id, flight);
	flight.then((read) => (keep(read) ? forget() : setTimeout(forget, SETTLED_MS)), forget);

	return flight;
}
