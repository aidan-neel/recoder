import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AutoReviewEvent, AutoReviewReason, AutoReviewSettings } from '@recoder/shared';
import { serverDataDir } from '../../util/data-dir.js';
import { findMention } from './mention.js';

/** An open pull request as the watcher sees it. */
export interface WatchedPull {
	number: number;
	headSha: string;
	draft: boolean;
	createdAt: string;
	updatedAt: string;
}

/**
 * Where a comment lives. GitHub numbers conversation comments and inline
 * review comments separately, so each keeps its own cursor; GitLab has one.
 */
export type NoteStream = 'comment' | 'review';

/** A comment on a pull request. Ids only grow within a stream, so a cursor can be the last id seen. */
export interface WatchedNote {
	id: number;
	stream: NoteStream;
	author: string;
	body: string;
	createdAt: string;
	/** GitLab's thread id, so a reply lands in the same thread. */
	discussionId?: string;
}

/** What the watcher last saw on one pull request. */
export interface PullCursor {
	/**
	 * Comments from before this count as history. Guards a cursor that doesn't
	 * know every id yet (a webhook created it), so old comments never fire.
	 */
	notesAfter: string;
	noteIds: Partial<Record<NoteStream, number>>;
	/** Empty when nobody has told the watcher the head yet. */
	headSha: string;
	seenAt: string;
}

/** What the watcher last saw on one repository. */
interface RepoCursor {
	checkedAt: string;
	pulls: Record<string, PullCursor>;
}

/** Everything the watcher keeps across restarts, so a mention never starts two reviews. */
export interface WatchState {
	repos: Record<string, RepoCursor>;
	recent: AutoReviewEvent[];
}

/** A review the watcher should start. */
export interface Trigger {
	reason: AutoReviewReason;
	by?: string;
	noteId?: string;
	noteStream?: NoteStream;
	discussionId?: string;
	/** What the mention asked for, as the review's instructions. */
	instructions?: string;
}

/**
 * Comments and pull requests a little older than the last check still count
 * when the watcher has no cursor for them, since the forge's clock and ours
 * can disagree. The per-pull cursor stops them counting twice.
 */
export const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** A pull request not seen for this long is forgotten. */
const FORGET_AFTER_MS = 60 * 24 * 60 * 60 * 1000;

/** How many started reviews the state remembers for Settings. */
const RECENT_LIMIT = 20;

function stateFile(): string {
	return join(serverDataDir(), 'auto-review-state.json');
}

export function readWatchState(): WatchState {
	try {
		const parsed = JSON.parse(readFileSync(stateFile(), 'utf8')) as Partial<WatchState>;

		return { repos: parsed.repos ?? {}, recent: Array.isArray(parsed.recent) ? parsed.recent : [] };
	} catch {
		return { repos: {}, recent: [] };
	}
}

/** Drop pull requests nobody has touched in two months and keep the recent list short, then write atomically. */
export function writeWatchState(state: WatchState, now = Date.now()): void {
	for (const cursor of Object.values(state.repos)) {
		for (const [number, pull] of Object.entries(cursor.pulls)) {
			if (now - Date.parse(pull.seenAt) > FORGET_AFTER_MS) delete cursor.pulls[number];
		}
	}

	state.recent = state.recent.slice(0, RECENT_LIMIT);

	const file = stateFile();
	const temporary = `${file}.${process.pid}.tmp`;

	writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
	renameSync(temporary, file);
}

export interface PullDecisionInput {
	settings: AutoReviewSettings;
	/** Last check of this repository; null the first time, when everything already there is history. */
	checkedAt: string | null;
	cursor: PullCursor | undefined;
	pull: WatchedPull;
	notes: WatchedNote[];
	/** Recoder reviewed this pull request automatically before (at any commit). */
	reviewedBefore: boolean;
	/** A review of this exact head commit exists or is running. */
	reviewedHead: boolean;
	now: string;
}

/** The mention in the newest comment that has one. */
function latestMention(notes: WatchedNote[], handle: string): Trigger | null {
	for (const note of [...notes].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id)) {
		const instructions = findMention(note.body, handle);

		if (instructions !== null) {
			return {
				reason: 'mention',
				by: note.author,
				noteId: String(note.id),
				noteStream: note.stream,
				...(note.discussionId ? { discussionId: note.discussionId } : {}),
				...(instructions ? { instructions } : {})
			};
		}
	}

	return null;
}

/** The cursor after seeing `notes` at `headSha`; a new cursor starts counting comments at `notesAfter`. */
function advance(
	cursor: PullCursor | undefined,
	notes: WatchedNote[],
	headSha: string,
	notesAfter: string,
	now: string
): PullCursor {
	const noteIds = { ...cursor?.noteIds };

	for (const note of notes) noteIds[note.stream] = Math.max(noteIds[note.stream] ?? 0, note.id);

	return {
		notesAfter: cursor?.notesAfter ?? notesAfter,
		noteIds,
		headSha: headSha || cursor?.headSha || '',
		seenAt: now
	};
}

/** Drafts wait when the settings say so, and a reviewed head never needs another review. */
function staysQuiet(input: { settings: AutoReviewSettings; pull: WatchedPull; reviewedHead: boolean }): boolean {
	return (input.pull.draft && input.settings.skipDrafts) || input.reviewedHead;
}

/** New commits on a pull request Recoder reviewed automatically. An unknown earlier head is no evidence of a push. */
function pushedSince(input: Pick<PullDecisionInput, 'settings' | 'cursor' | 'pull' | 'reviewedBefore'>): boolean {
	const before = input.cursor?.headSha;

	return input.settings.onPushed && input.reviewedBefore && !!before && before !== input.pull.headSha;
}

/**
 * Whether one pull request needs a review now, and the cursor to keep. A
 * mention wins over everything, drafts included. Otherwise a pull request
 * opened since the last check, or new commits on one Recoder reviewed,
 * start a review unless that commit is already reviewed. The first check of a
 * repository only records what is there.
 */
export function decidePull(input: PullDecisionInput): { trigger: Trigger | null; cursor: PullCursor } {
	const { settings, cursor, pull, notes } = input;
	const after = cursor?.notesAfter ?? input.checkedAt;
	const windowStart = after ? Date.parse(after) - CLOCK_SKEW_MS : Number.POSITIVE_INFINITY;

	const fresh = notes.filter(
		(note) => Date.parse(note.createdAt) > windowStart && note.id > (cursor?.noteIds[note.stream] ?? 0)
	);

	const next = advance(cursor, notes, pull.headSha, input.checkedAt ?? input.now, input.now);
	const mention = settings.onMention ? latestMention(fresh, settings.mentionHandle) : null;

	if (mention) return { trigger: mention, cursor: next };
	if (staysQuiet(input)) return { trigger: null, cursor: next };

	const openedAfter = input.checkedAt ? Date.parse(input.checkedAt) - CLOCK_SKEW_MS : Number.POSITIVE_INFINITY;

	if (!cursor && settings.onOpened && Date.parse(pull.createdAt) > openedAfter) {
		return { trigger: { reason: 'opened' }, cursor: next };
	}

	if (pushedSince(input)) return { trigger: { reason: 'pushed' }, cursor: next };

	return { trigger: null, cursor: next };
}

/** What a webhook says happened on a pull request. */
export type PullEvent = { kind: 'mention'; note: WatchedNote } | { kind: 'opened' } | { kind: 'pushed' };

/**
 * The same rules as `decidePull` for one event a webhook delivered. The
 * cursor it returns makes the poller skip that comment or commit later, and a
 * comment the poller already handled is skipped here.
 */
export function decideEvent(input: Omit<PullDecisionInput, 'checkedAt' | 'notes'> & { event: PullEvent }): {
	trigger: Trigger | null;
	cursor: PullCursor;
} {
	const { settings, cursor, event } = input;

	if (event.kind === 'mention') {
		const seen = event.note.id <= (cursor?.noteIds[event.note.stream] ?? 0);
		const next = advance(cursor, [event.note], input.pull.headSha, input.now, input.now);
		const trigger = settings.onMention && !seen ? latestMention([event.note], settings.mentionHandle) : null;

		return { trigger, cursor: next };
	}

	const next = advance(cursor, [], input.pull.headSha, input.now, input.now);

	if (staysQuiet(input)) return { trigger: null, cursor: next };
	if (event.kind === 'opened' && settings.onOpened) return { trigger: { reason: 'opened' }, cursor: next };
	if (event.kind === 'pushed' && pushedSince(input)) return { trigger: { reason: 'pushed' }, cursor: next };

	return { trigger: null, cursor: next };
}
