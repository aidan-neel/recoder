import type { Mark } from './marks.js';
import { squash } from './syntax.js';
import type { HunkMarks, TriggerHit } from './triggers.js';

/** Operations named in one hit's detail, at most; the rest are counted. */
const MAX_LISTED = 3;

/**
 * One hit per entity a hunk moves (`job.status`, `this.cache`): on the new
 * side when the hunk adds or changes a transition the base did not make, else
 * on the old side when it removed one that appears nowhere in the head file. A
 * transition reformatted or kept as it was sets nothing off.
 */
export function transitionHits(hunk: HunkMarks): TriggerHit[] {
	const head = hunk.head.filter((mark) => mark.kind === 'transition');
	const base = hunk.base.filter((mark) => mark.kind === 'transition');
	const added = head.filter((mark) => !base.some((old) => sameMove(old, mark)));

	const removed = base.filter(
		(old) => !head.some((mark) => sameMove(old, mark)) && !hunk.headText.includes(squash(old.code))
	);

	const keys = [...new Set([...added, ...removed].map((mark) => mark.key))];

	return keys.flatMap((key) => {
		const moved = added.filter((mark) => mark.key === key);
		const dropped = removed.filter((mark) => mark.key === key);

		if (moved.length) return [hitOf(moved, 'new', dropped)];

		return [hitOf(dropped, 'old', [])];
	});
}

function sameMove(a: Mark, b: Mark): boolean {
	return a.key === b.key && a.value === b.value;
}

/** The hit at the first of `marks`, naming what each does, what the hunk removed beside them, and the states the file gives. */
function hitOf(marks: Mark[], side: 'new' | 'old', dropped: Mark[]): TriggerHit {
	const [first] = marks;
	const prefix = side === 'old' ? 'removed: ' : '';

	const parts = [
		`${prefix}${listed(marks)}`,
		dropped.length ? `removed: ${listed(dropped)}` : '',
		marks.find((mark) => mark.note)?.note ?? ''
	];

	return {
		trigger: 'state-transition',
		side,
		line: first.line,
		code: first.code,
		detail: parts.filter(Boolean).join('; ')
	};
}

function listed(marks: Mark[]): string {
	const details = [...new Set(marks.map((mark) => mark.detail))];
	const more = details.length - MAX_LISTED;

	return details.slice(0, MAX_LISTED).join(', ') + (more > 0 ? ` and ${more} more` : '');
}
