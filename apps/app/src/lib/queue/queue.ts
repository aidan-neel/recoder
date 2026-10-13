import type { PullRequest, Review } from '@recoder/shared';
import type { DecisionRecord } from '../review/saved-decisions';
import { decisionStates } from '../review/saved-decisions';
import { buildSurface, type Tone } from '../review/surface';

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

const TONE_RANK: Record<Tone, number> = { high: 0, medium: 1, question: 2, low: 3 };

/** The entry for one open pull request and its latest review. */
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
	if (review.status === 'failed') return { ...entry, state: 'failed' };
	if (review.headSha && pull.headSha && review.headSha !== pull.headSha) return { ...entry, state: 'outdated' };

	const states = decisionStates(records);
	const surface = buildSurface(review, [], states);
	const open = surface.decisions.filter((decision) => !states[decision.id]);
	const sent = surface.decisions.filter((decision) => states[decision.id] === 'sent').length;
	const tone = open.map((decision) => decision.tone).sort((a, b) => TONE_RANK[a] - TONE_RANK[b])[0] ?? null;
	const state = open.length > 0 ? 'needs-you' : sent > 0 ? 'with-agent' : 'ready';

	return { ...entry, state, open: open.length, tone, sent, receipts: surface.receipts.length };
}

function byUrgency(a: QueueEntry, b: QueueEntry): number {
	const rank = (entry: QueueEntry) => (entry.tone ? TONE_RANK[entry.tone] : 9);

	return rank(a) - rank(b) || b.open - a.open || Date.parse(b.pull.createdAt) - Date.parse(a.pull.createdAt);
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
