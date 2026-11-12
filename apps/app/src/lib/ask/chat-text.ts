import { normalizeModelMarkdown } from '@recoder/shared';

/**
 * Fenced ```recoder-note, ```recoder-fix and ```recoder-review blocks: JSON
 * the orchestrator writes for the app, not for a person. A block still
 * streaming has no closing fence yet, so it runs to the end of the text.
 */
const APP_BLOCK = /\n*```recoder-[\w-]*[^\n]*(?:\n[\s\S]*?(?:```|$)|$)/g;

/** A reply as a person reads it: the app's blocks left out and the model's Markdown repaired. */
export function chatText(text: string, complete: boolean): string {
	return normalizeModelMarkdown(text.replace(APP_BLOCK, ''), { complete });
}
