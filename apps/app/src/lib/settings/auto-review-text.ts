import { AUTO_REVIEW_INTERVALS, type AutoReviewEvent, type AutoReviewInterval } from '@recoder/shared';

import { plural, span } from '../shell/format';

/** A poll interval as the select shows it; every interval is whole minutes. */
export function intervalLabel(seconds: AutoReviewInterval): string {
	return plural(seconds / 60, 'minute');
}

/** The interval a select's string value names, or null for anything else. */
export function intervalFrom(value: string): AutoReviewInterval | null {
	return AUTO_REVIEW_INTERVALS.find((seconds) => String(seconds) === value) ?? null;
}

/** "Last checked 2 minutes ago · next in 30 seconds", or what stands in for either half. */
export function checkText(lastCheckAt: string | null, nextCheckAt: string | null, now: number): string {
	const last = lastCheckAt ? Date.parse(lastCheckAt) : Number.NaN;
	const next = nextCheckAt ? Date.parse(nextCheckAt) : Number.NaN;

	const since = Number.isNaN(last)
		? 'Not checked yet'
		: now - last < 10_000
			? 'Checked just now'
			: `Last checked ${span(now - last)} ago`;

	if (Number.isNaN(next)) return since;

	return next - now < 5_000 ? `${since} · checking soon` : `${since} · next in ${span(next - now)}`;
}

/** Why the watcher started a review, as words. */
export function reasonText(event: AutoReviewEvent): string {
	if (event.reason === 'mention') return event.by ? `Mentioned by @${event.by.replace(/^@/, '')}` : 'Mentioned';

	return event.reason === 'opened' ? 'Opened' : 'New commits';
}

/** Why a mention handle can't be saved, or null when it can. GitLab and GitHub names use letters, digits, `_`, `-` and `.`. */
export function handleError(text: string): string | null {
	const handle = text.trim();

	if (!handle || handle === '@') return 'Enter a handle, like @recoder.';
	if (/\s/.test(handle)) return 'A handle has no spaces.';
	if (!handle.startsWith('@')) return 'Start the handle with @.';
	if (!/^@[\w.-]+$/.test(handle)) return 'Use letters, digits, _, - and . only.';

	return null;
}
