/**
 * Hidden marker on every comment Recoder posts. The watcher skips marked
 * comments, so its own replies never summon it, even when it posts with the
 * same account as the person who mentioned it.
 */
export const RECODER_MARKER = '<!-- recoder:auto-review -->';

/** The longest instruction a mention passes to the review. */
const MAX_INSTRUCTIONS = 2000;

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Fenced code blocks, inline code and quoted lines: a mention there is someone quoting it, not asking. */
function withoutQuotedText(body: string): string {
	return body
		.replace(/```[\s\S]*?(```|$)/g, ' ')
		.replace(/`[^`\n]*`/g, ' ')
		.split('\n')
		.filter((line) => !line.trimStart().startsWith('>'))
		.join('\n');
}

/**
 * The instructions in a comment that mentions `handle`, or null when it
 * doesn't. "@recoder focus on the auth changes" gives "focus on the auth
 * changes"; a bare "@recoder" gives "". The handle matches as a whole word in
 * any case, so `@recoder-bot`, `x@recoder.dev` and a quoted mention don't count.
 */
export function findMention(body: string, handle: string): string | null {
	const name = handle.trim();

	if (!name || body.includes(RECODER_MARKER)) return null;

	const pattern = new RegExp(`(^|[^\\w@./-])${escapeRegExp(name)}(?![\\w-])`, 'gi');
	const text = withoutQuotedText(body);

	if (!pattern.test(text)) return null;

	return text
		.replace(pattern, '$1')
		.replace(/^[\s,:;.!-]+/, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, MAX_INSTRUCTIONS);
}
