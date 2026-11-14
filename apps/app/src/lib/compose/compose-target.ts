import { parsePullRef } from '../shell/pull-ref';
import { BRIEF_LEAD, readTarget, type TargetContext } from '../pulls/pull-target';
import type { PickTarget } from './types';

/** Why Review mode will not start: no pull request is chosen. */
export const REVIEW_NEEDS_PULL = 'Choose a pull request to review, or switch to Chat.';

/** Why Chat mode will not start: a chat is about a tracked repository, and none is. */
export const CHAT_NEEDS_REPO = 'Track a repository to chat about it.';

/** A pull request reference taken out of the field, and the text that stays in it. */
export type PullTake =
	{ kind: 'taken'; target: PickTarget; text: string } | { kind: 'refused'; reason: string; text: string };

/**
 * Takes the pull request out of the brief. It reads `#158`, `api#158`, a
 * link, or a sentence that links one pull request. A bare number or a branch
 * is left alone: "3 things to check" is a brief, and the picker finds those.
 * A reference is taken when a space follows it, or when `complete` says the
 * whole text arrived at once (a paste, or Enter); otherwise `#2` would be
 * taken while the person is still typing `#214`. A reference that names a
 * pull request that cannot be used (`nosuch#12`) is refused with its reason.
 * Returns null when there is nothing to take.
 */
export function takePull(text: string, context: TargetContext, complete: boolean): PullTake | null {
	const read = readTarget(text, context);
	const reference = read.reference;

	if (!reference || !isExplicit(reference)) return null;

	const start = text.indexOf(reference);
	const end = start + reference.length;

	if (!complete && !/\s/.test(text.charAt(end))) return null;

	const leads = text.slice(0, start).trim() === '';
	const remaining = leads ? text.slice(end).replace(BRIEF_LEAD, '') : withoutRange(text, start, end);

	if (read.target.kind === 'invalid') return { kind: 'refused', reason: read.target.reason, text: remaining };
	if (read.target.kind === 'empty') return null;

	return { kind: 'taken', target: read.target, text: remaining };
}

/** True for a link, `#158` or `api#158`: a reference that cannot be a number in a sentence. */
function isExplicit(reference: string): boolean {
	const ref = parsePullRef(reference);

	return ref !== null && (ref.address !== null || /[#!]/.test(reference));
}

/** The text without `start` to `end`, the words either side of the gap joined by one space. */
function withoutRange(text: string, start: number, end: number): string {
	const before = text.slice(0, start).trimEnd();
	const after = text.slice(end).trimStart();

	return before && after ? `${before} ${after}` : before + after;
}
