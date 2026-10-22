import { REVIEW_CANCELLED, type PullRequest, type Review } from '@recoder/shared';
import type { GlyphKind, PillTone } from '@recoder/ui';

import { isOutdated } from '../review/lifecycle';
import type { DecisionRecord } from '../review/saved-decisions';
import { decisionStates } from '../review/saved-decisions';
import { buildSurface, type Tone } from '../review/surface';
import { SAMPLE_REVIEW } from '../sample/sample-review';
import { plural } from '../shell/format';

/**
 * Where a pull request stands for the person reviewing it.
 * `needs-you`: decisions are open. `with-agent`: every decision is made and
 * some were sent back to the author. `ready`: every decision made, none sent
 * back. `outdated`: commits landed after the review.
 */
type QueueState = 'needs-you' | 'reviewing' | 'unreviewed' | 'outdated' | 'failed' | 'with-agent' | 'ready';

export interface QueueEntry {
	key: string;
	repoId: string;
	repo: string;
	pull: PullRequest;
	review: Review | null;
	state: QueueState;
	/** Decisions still open, and the strongest tone among them. */
	open: number;
	tone: Tone | null;
	sent: number;
	receipts: number;
}

export interface QueueSection {
	id: 'needs-you' | 'reviewing' | 'not-reviewed' | 'with-agent' | 'ready';
	title: string;
	entries: QueueEntry[];
}

/** What a row's button does: start a review, or open the one it has. */
export interface EntryAction {
	label: 'Review' | 'Review again' | 'Continue' | 'Open';
	starts: boolean;
}

const TONE_RANK: Record<Tone, number> = { high: 0, medium: 1, question: 2, low: 3 };

/** True for a failed review that the person stopped, which reads as cancelled rather than broken. */
function isCancelled(entry: QueueEntry): boolean {
	return entry.state === 'failed' && entry.review?.summary === REVIEW_CANCELLED;
}

/**
 * The entry for one open pull request and its latest review. Outdated is
 * checked before failed, so a failed review of an old commit offers a fresh
 * review of the new head instead of resuming the stale one.
 */
export function queueEntry(
	repo: { id: string; name: string },
	pull: PullRequest,
	review: Review | null,
	records: Record<string, DecisionRecord>
): QueueEntry {
	const entry = {
		key: `${repo.id}#${pull.number}`,
		repoId: repo.id,
		repo: repo.name,
		pull,
		review,
		open: 0,
		tone: null,
		sent: 0,
		receipts: 0
	};

	if (!review || review.status === 'draft') return { ...entry, state: 'unreviewed' };
	if (review.status === 'queued' || review.status === 'running') return { ...entry, state: 'reviewing' };
	if (isOutdated(review, pull)) return { ...entry, state: 'outdated' };
	if (review.status === 'failed') return { ...entry, state: 'failed' };

	const tally = decisionTally(review, records);
	const state = tally.open > 0 ? 'needs-you' : tally.sent > 0 ? 'with-agent' : 'ready';

	return { ...entry, ...tally, state };
}

/** What a finished review leaves to decide, given the saved decisions: the open count and strongest tone, what was sent back, and the receipts. */
export function decisionTally(
	review: Review,
	records: Record<string, DecisionRecord>
): Pick<QueueEntry, 'open' | 'tone' | 'sent' | 'receipts'> {
	const states = decisionStates(records);
	const surface = buildSurface(review, [], states);
	const open = surface.decisions.filter((decision) => !states[decision.id]);
	const sent = surface.decisions.filter((decision) => states[decision.id] === 'sent').length;
	const tone = open.map((decision) => decision.tone).sort((a, b) => TONE_RANK[a] - TONE_RANK[b])[0] ?? null;

	return { open: open.length, tone, sent, receipts: surface.receipts.length };
}

/** True when a review answer says nothing new about the one the row already holds. */
function sameReview(a: Review | null, b: Review | null): boolean {
	if (!a || !b) return a === b;

	return a.id === b.id && a.status === b.status && a.updatedAt === b.updatedAt && a.headSha === b.headSha;
}

/**
 * True when a fresh entry shows exactly what the old one does, so a refresh
 * can keep the old object and its row skips a render.
 */
export function sameEntry(a: QueueEntry, b: QueueEntry): boolean {
	return (
		a.key === b.key &&
		a.state === b.state &&
		a.open === b.open &&
		a.tone === b.tone &&
		a.sent === b.sent &&
		a.receipts === b.receipts &&
		a.repo === b.repo &&
		sameReview(a.review, b.review) &&
		JSON.stringify(a.pull) === JSON.stringify(b.pull)
	);
}

/** Newest first; a pull request without a date sorts last. */
function age(entry: QueueEntry): number {
	return Date.parse(entry.pull.createdAt) || 0;
}

/** Strongest open tone first, then more open decisions, then the newer pull request, then a stable tie-break. */
function byUrgency(a: QueueEntry, b: QueueEntry): number {
	const rank = (entry: QueueEntry) => (entry.tone ? TONE_RANK[entry.tone] : 9);

	return rank(a) - rank(b) || b.open - a.open || age(b) - age(a) || a.key.localeCompare(b.key);
}

/** Entries grouped the way a person works them: what needs them first, what is done last. */
export function queueSections(entries: QueueEntry[]): QueueSection[] {
	const pick = (...states: QueueState[]) => entries.filter((entry) => states.includes(entry.state)).sort(byUrgency);

	const sections: QueueSection[] = [
		{ id: 'needs-you', title: 'Needs you', entries: pick('needs-you') },
		{ id: 'reviewing', title: 'Reviewing', entries: pick('reviewing') },
		{ id: 'not-reviewed', title: 'Not reviewed', entries: pick('failed', 'outdated', 'unreviewed') },
		{ id: 'with-agent', title: 'With the agent', entries: pick('with-agent') },
		{ id: 'ready', title: 'Ready to merge', entries: pick('ready') }
	];

	return sections.filter((section) => section.entries.length > 0);
}

/** The row's status pill: what is left to decide, or where the pull request stands. Running rows show progress instead. */
export function entryStatus(entry: QueueEntry): { tone: PillTone; label: string } | null {
	switch (entry.state) {
		case 'needs-you':
			return {
				tone: entry.tone === 'high' || entry.tone === 'medium' ? entry.tone : 'neutral',
				label: plural(entry.open, 'decision')
			};
		case 'with-agent':
			return { tone: 'sent', label: `${entry.sent} sent back` };
		case 'ready':
			return { tone: 'ok', label: 'Ready to merge' };
		case 'outdated':
			return { tone: 'neutral', label: 'New commits' };
		case 'failed':
			return isCancelled(entry) ? { tone: 'neutral', label: 'Cancelled' } : { tone: 'danger', label: 'Failed' };
		case 'unreviewed':
			return { tone: 'neutral', label: 'Not reviewed' };
		default:
			return null;
	}
}

/** The row's 16px glyph: the strongest open tone, or the state the pull request is in. */
export function entryGlyph(entry: QueueEntry): GlyphKind {
	switch (entry.state) {
		case 'needs-you':
			return entry.tone ?? 'idle';
		case 'reviewing':
			return 'spinner';
		case 'with-agent':
			return 'sent';
		case 'ready':
			return 'ok';
		case 'outdated':
			return 'outdated';
		case 'failed':
			return isCancelled(entry) ? 'idle' : 'failed';
		default:
			return 'idle';
	}
}

/**
 * The row's button. Only a pull request without a current review starts one
 * from the row (or `r`); a reviewed one opens, so a stray key never queues a
 * second review of the same commit.
 */
export function entryAction(entry: QueueEntry): EntryAction {
	switch (entry.state) {
		case 'unreviewed':
			return { label: 'Review', starts: true };
		case 'outdated':
			return { label: 'Review again', starts: true };
		case 'failed':
			return { label: 'Continue', starts: true };
		default:
			return { label: 'Open', starts: false };
	}
}

/** Where the row leads. Only the sample review opens in the sample; a pull request with no review has nothing to open. */
export function entryHref(entry: QueueEntry, sample: boolean): string | null {
	if (sample) return entry.review?.id === SAMPLE_REVIEW.id ? '/review/sample' : null;

	return entry.review ? `/review/${encodeURIComponent(entry.review.id)}` : null;
}

/** The running row's note: queued, planning while the task count is unknown, then steps done. */
export function runningLabel(
	entry: QueueEntry,
	progress: { tasksDone: number; tasksTotal: number } | undefined
): string {
	if (entry.review?.status === 'queued') return 'Queued';
	if (!progress?.tasksTotal) return 'Planning';

	return `${Math.min(progress.tasksDone, progress.tasksTotal)} of ${progress.tasksTotal} steps`;
}
