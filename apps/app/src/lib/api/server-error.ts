/** Server messages that read as code, said the way the app speaks. */
const KNOWN: Record<string, string> = {
	'review is not running': 'The review isn’t running.',
	'review not found': 'This review no longer exists.',
	'repo not found': 'Its repository is no longer tracked.'
};

/** Server messages known by how they begin, whatever detail follows. */
const KNOWN_STARTS: [start: string, plain: string][] = [
	['reviewer not configured', 'Add a reviewer model in Settings before starting a review.']
];

/**
 * A server error as plain copy for a toast or notice: known messages are
 * reworded, the rest start with a capital and end with a period.
 */
export function plainError(message: string): string {
	const text = message.trim();
	const known = KNOWN[text.toLowerCase()];

	if (known) return known;
	if (!text) return '';

	const start = KNOWN_STARTS.find(([prefix]) => text.toLowerCase().startsWith(prefix));

	if (start) return start[1];

	const sentence = text[0].toUpperCase() + text.slice(1);

	return /[.!?…]$/.test(sentence) ? sentence : `${sentence}.`;
}
