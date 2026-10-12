import type { ObligationTrigger } from '@recoder/shared';
import type { Mark } from './marks.js';
import { squash } from './syntax.js';

/** The question each trigger obliges an investigation to answer (issue #66). */
export const QUESTIONS: Record<ObligationTrigger, string> = {
	'truthy-default': 'Can zero, false, or an empty string be valid?',
	boundary: 'What happens below, at, and above the boundary?',
	'removed-guard': 'Can a newly accepted input reach this path?',
	normalization: 'Do equivalent inputs still have equivalent behavior?',
	'resource-release': 'Does each exit path release the resource?',
	'count-validation': 'Are fractions and negative values permitted?',
	'error-contract': 'Which documented or tested contract applies?',
	'weaker-assertion': 'Which required behavior could now pass incorrectly?'
};

/** Trigger order for sorting and for taking one of each kind under the cap. */
export const TRIGGERS = Object.keys(QUESTIONS) as ObligationTrigger[];

/** One hunk's marks on both sides, with each whole file for telling moved code from removed code. */
export interface HunkMarks {
	/** Marks on the hunk's deleted lines, read at the merge base. */
	base: Mark[];
	/** Marks on the hunk's added lines, at the head. */
	head: Mark[];
	/** The whole head file without whitespace; empty for a deleted file. */
	headText: string;
	/** The whole merge-base file without whitespace; empty for an added file. */
	baseText: string;
	/** The hunk deletes or replaces lines, rather than only adding them. */
	deletes: boolean;
	/**
	 * The hunk only adds lines and brand-new code may oblige: its truthiness
	 * tests, bounds and normalizers fire with nothing on the base side to compare.
	 */
	newCode: boolean;
}

/** A trigger set off at one line; `side: 'old'` for code the hunk removed. */
export interface TriggerHit {
	trigger: ObligationTrigger;
	side: 'new' | 'old';
	line: number;
	code: string;
	detail: string;
}

/** Every trigger one hunk sets off, in mark order. */
export function triggerHits(hunk: HunkMarks): TriggerHit[] {
	return [
		...truthyHits(hunk),
		...boundaryHits(hunk),
		...headHits(hunk, 'count', 'count-validation'),
		...removedGuards(hunk),
		...normalizationHits(hunk),
		...headHits(hunk, 'acquire', 'resource-release'),
		...errorHits(hunk),
		...assertionHits(hunk)
	];
}

function hit(trigger: ObligationTrigger, mark: Mark, side: 'new' | 'old', detail = mark.detail): TriggerHit {
	return { trigger, side, line: mark.line, code: mark.code, detail };
}

function headHits(hunk: HunkMarks, kind: Mark['kind'], trigger: ObligationTrigger): TriggerHit[] {
	return hunk.head.filter((mark) => mark.kind === kind).map((mark) => hit(trigger, mark, 'new'));
}

/** The same operation on the base side of the hunk with a different value: a default or an operator that changed. */
function changedFrom(hunk: HunkMarks, mark: Mark): Mark | undefined {
	return hunk.base.find((old) => old.kind === mark.kind && old.key === mark.key && old.value !== mark.value);
}

/** Whether the code the hunk replaced uses `name`, outside comments and strings. */
function used(hunk: HunkMarks, name: string): boolean {
	return hunk.base.some((old) => old.kind === 'name' && old.key === name);
}

/**
 * A truthiness test on a value the replaced lines handled some other way: not
 * one in brand-new code, and not one the base already made.
 */
function replacedTruthy(hunk: HunkMarks, mark: Mark): boolean {
	/** The value tested: `status` in `this.status`, `items` in `items[0]`. */
	const value = mark.key.match(/[A-Za-z_$][\w$]*(?=[^A-Za-z_$]*$)/)?.[0] ?? mark.key;

	return used(hunk, value) && !hunk.base.some((old) => old.kind === 'truthy' && old.key === mark.key);
}

/**
 * Rounding, division or a bound in place of code that bounded or compared
 * something, or that used a value it now bounds; not the same expression the
 * base already had.
 */
function replacedBoundary(hunk: HunkMarks, mark: Mark): boolean {
	/** The values it bounds: `total` and `size` in `Math.ceil(total / size)`, not `Math`, `ceil` or an object. */
	const operands = mark.key.match(/[A-Za-z_$][\w$]*(?![\w$]*[.(])/g) ?? [];

	return (
		(hunk.base.some((old) => old.kind === 'boundary' || old.kind === 'compare') ||
			operands.some((name) => used(hunk, name))) &&
		!hunk.base.some((old) => old.kind === 'boundary' && old.key === mark.key)
	);
}

/**
 * A truthiness test that replaced other handling of its value or sits in
 * brand-new code that may oblige, or a default whose value changed.
 */
function truthyHits(hunk: HunkMarks): TriggerHit[] {
	const changed = hunk.head.flatMap((mark) => {
		const old = mark.kind === 'default' ? changedFrom(hunk, mark) : undefined;

		return old
			? [
					hit(
						'truthy-default',
						mark,
						'new',
						`default for \`${mark.key}\` changed from \`${old.value}\` to \`${mark.value}\``
					)
				]
			: [];
	});

	const replaced = hunk.head.filter((mark) => mark.kind === 'truthy' && (hunk.newCode || replacedTruthy(hunk, mark)));

	return [...replaced.map((mark) => hit('truthy-default', mark, 'new')), ...changed];
}

/**
 * Rounding, division and comparisons with a number or limit that replaced a
 * bound or sit in brand-new code that may oblige, and any comparison whose
 * operator changed.
 */
function boundaryHits(hunk: HunkMarks): TriggerHit[] {
	const changed = hunk.head.flatMap((mark) => {
		const old = mark.kind === 'compare' ? changedFrom(hunk, mark) : undefined;

		return old ? [hit('boundary', mark, 'new', `comparison changed from \`${old.value}\` to \`${mark.value}\``)] : [];
	});

	const replaced = hunk.head.filter(
		(mark) => mark.kind === 'boundary' && (hunk.newCode || replacedBoundary(hunk, mark))
	);

	return [...replaced.map((mark) => hit('boundary', mark, 'new')), ...changed];
}

/** A deleted early exit or assertion call whose condition no longer appears anywhere in the head file. */
function removedGuards(hunk: HunkMarks): TriggerHit[] {
	return hunk.base
		.filter((mark) => mark.kind === 'guard' && !hunk.headText.includes(mark.key))
		.map((mark) => hit('removed-guard', mark, 'old', `removed: ${mark.detail}`));
}

/**
 * The hunk replaces code, or adds brand-new code that may oblige, and the
 * normalizers applied differ between the two sides.
 */
function normalizationHits(hunk: HunkMarks): TriggerHit[] {
	if (!hunk.deletes && !hunk.newCode) return [];

	const before = hunk.base.filter((mark) => mark.kind === 'normalize');
	const after = hunk.head.filter((mark) => mark.kind === 'normalize');
	const count = (marks: Mark[], key: string) => marks.filter((mark) => mark.key === key).length;
	const added = after.find((mark) => count(after, mark.key) > count(before, mark.key));

	if (added) return [hit('normalization', added, 'new', `added: ${added.detail}`)];

	const dropped = before.find((mark) => count(before, mark.key) > count(after, mark.key));

	return dropped && hunk.headText ? [hit('normalization', dropped, 'old', `removed: ${dropped.detail}`)] : [];
}

/**
 * Error text that is new to an existing file, an error message the change
 * removed, and an exit status that changed.
 */
function errorHits(hunk: HunkMarks): TriggerHit[] {
	if (!hunk.baseText) return [];

	const added = hunk.head
		.filter((mark) => mark.kind === 'error' && !hunk.baseText.includes(mark.key))
		.map((mark) => hit('error-contract', mark, 'new'));

	const removed = added.length
		? []
		: hunk.base
				.filter((mark) => mark.kind === 'error' && hunk.headText && !hunk.headText.includes(mark.key))
				.map((mark) => hit('error-contract', mark, 'old', `removed: ${mark.detail}`));

	const exits = hunk.head
		.filter(
			(mark) =>
				mark.kind === 'exit' &&
				!hunk.base.some((old) => old.kind === 'exit' && old.key === mark.key && old.value === mark.value)
		)
		.map((mark) => hit('error-contract', mark, 'new'));

	return [...added, ...removed, ...exits];
}

/**
 * A deleted assertion that didn't move and wasn't replaced by one as strict
 * on the same subject, and any test the change turned off.
 */
function assertionHits(hunk: HunkMarks): TriggerHit[] {
	const weakened = hunk.base.flatMap((old) => {
		if (old.kind !== 'assert' || hunk.headText.includes(squash(old.code))) return [];

		const same = hunk.head.filter((mark) => mark.kind === 'assert' && mark.key === old.key);

		if (same.some((mark) => mark.rank >= old.rank)) return [];

		const weaker = same[0];

		return weaker
			? [
					hit(
						'weaker-assertion',
						weaker,
						'new',
						`\`${old.value}\` became the weaker \`${weaker.value}\` on \`${old.key}\``
					)
				]
			: [hit('weaker-assertion', old, 'old', `removed: ${old.detail}`)];
	});

	return [...weakened, ...headHits(hunk, 'skip', 'weaker-assertion')];
}
