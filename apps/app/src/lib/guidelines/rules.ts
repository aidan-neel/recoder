import type { GlobalGuidelines } from '@recoder/shared';

/** The global row's line when the owner never saved global guidelines, so the built-in ones apply. */
const NOT_SET = 'Not set. Reviewers follow Recoder’s defaults.';

/** The global row's line when the owner saved an empty file on purpose. */
const CLEARED = 'Cleared. Reviews use no global rules.';

/** A line that holds no rule: blank, a heading, a bare bullet from the template, or "None.". */
function isRule(line: string): boolean {
	const trimmed = line.trim();
	const text = trimmed.replace(/^[-*]\s*/, '');

	return Boolean(text) && !trimmed.startsWith('#') && text !== 'None.';
}

/** The first rule of a guidelines text, without its bullet, for a one-line preview. Null when it has none. */
export function firstRule(content: string | null | undefined): string | null {
	const line = (content ?? '').split('\n').find(isRule);

	return line ? line.trim().replace(/^[-*]\s+/, '') : null;
}

/** What the global row says about the global layer. */
export function globalSummary(global: GlobalGuidelines): string {
	if (global.updatedAt === null) return NOT_SET;

	return firstRule(global.content) ?? CLEARED;
}

/**
 * The text an editor opens with: the file as it stands, or the starter
 * sections when it is empty. The starter's bare bullets get their space, so
 * the first rule typed into one reads as a list item.
 */
export function seedText(content: string | null | undefined, template: string): string {
	return content?.trim() ? content : template.replace(/^([-*])$/gm, '$1 ');
}

/** The text as saved: the starter's empty bullets lose the space `seedText` gave them, so no line ends in a space. */
export function trimEmptyBullets(text: string): string {
	return text.replace(/^([-*])[ \t]+$/gm, '$1');
}

/** Where the caret starts in an opened editor: in the first empty bullet when the text holds no rule yet, else at the end. */
export function caretAt(text: string): number {
	const bullet = firstRule(text) === null ? /^[-*] ?$/m.exec(text) : null;

	return bullet ? bullet.index + bullet[0].length : text.length;
}

/** An opening code fence the model may wrap the whole draft in: three backticks and an optional `markdown`/`md`. */
const OPENING_FENCE = /^\s*```(?:markdown|md)?[ \t]*\n/i;

/**
 * The part of a draft still streaming that belongs in the editor. The model
 * sometimes wraps the document in a Markdown fence, which the server strips
 * from the finished text; this hides the same fence while tokens arrive, so
 * the editor never shows backticks that vanish when the draft lands.
 */
export function streamingDraft(raw: string): string {
	const start = raw.trimStart();

	if (start.startsWith('`') && !start.includes('\n')) return '';
	if (!OPENING_FENCE.test(raw)) return raw;

	return raw.replace(OPENING_FENCE, '').replace(/\n`{1,3}\s*$/, '');
}
