import type { QueueSection } from './queue';

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

/** Small counts as words, larger ones as digits. */
function word(n: number): string {
	return WORDS[n] ?? String(n);
}

/**
 * Which repositories' pull request lists did not load: `all` of them, or
 * `some`; null when every list loaded.
 */
export type Unloaded = 'all' | 'some' | null;

/**
 * The queue's serif headline from the section counts: what needs a decision,
 * then what is moving and what is done. With no rows, it says the list is
 * empty only when every repository's pull requests loaded. When some or all
 * did not (`unloaded`), it says so, never that there are none, and the notes
 * under it say which failed and why.
 */
export function queueHeadline(sections: QueueSection[], unloaded: Unloaded = null): { lead: string; rest: string } {
	const count = (id: QueueSection['id']) => sections.find((section) => section.id === id)?.entries.length ?? 0;
	const needs = count('needs-you');
	const reviewing = count('reviewing');
	const ready = count('ready');

	if (sections.length === 0 && unloaded === 'all') return { lead: 'Pull requests didn’t load.', rest: '' };

	if (sections.length === 0 && unloaded === 'some') {
		return { lead: 'Some pull requests didn’t load.', rest: 'Your other repositories have none open.' };
	}

	if (sections.length === 0) {
		return { lead: 'No open pull requests.', rest: 'New ones in your tracked repositories land here.' };
	}

	const lead =
		needs === 0
			? 'Nothing needs you right now.'
			: `${word(needs)} pull request${needs === 1 ? '' : 's'} need${needs === 1 ? 's' : ''} a decision.`;

	const parts = [
		reviewing ? `${reviewing === 1 ? 'one more is' : `${word(reviewing).toLowerCase()} more are`} being reviewed` : '',
		ready ? `${word(ready).toLowerCase()} ${ready === 1 ? 'is' : 'are'} ready to merge` : ''
	].filter(Boolean);

	if (parts.length === 0) return { lead, rest: '' };

	const sentence = parts.join(' and ');

	return { lead, rest: `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.` };
}
