/** A finding's explanation as its card reads it: the paragraph that says what is wrong, then everything after it. */
export interface FindingBody {
	lead: string;
	/** Empty when the explanation is one paragraph, or does not open with a plain one. */
	rest: string;
}

/** A first block that is not a plain paragraph: a list, a heading, a quote, a table, a fence or an indented block. */
const NOT_A_PARAGRAPH = /^(?: {0,3}(?:[-*+]\s|\d+[.)]\s|#|>|\||```|~~~)| {4}|\t)/;

/** A fence opening inside the paragraph, whose code could hold the blank line the split would cut at. */
const FENCE_INSIDE = /^ {0,3}(?:```|~~~)/m;

/**
 * Splits a finding's explanation after its first paragraph, which is the one line of what is wrong a person reads at
 * a glance; the rest (the steps, the consequence) can wait under a disclosure. An explanation that does not open with
 * a plain paragraph stays whole, since cutting a list or a code block would change what it says.
 */
export function splitLead(explanation: string): FindingBody {
	const text = explanation.trim();
	const end = text.search(/\n[ \t]*\n/);
	const lead = end === -1 ? text : text.slice(0, end);

	if (end === -1 || NOT_A_PARAGRAPH.test(text) || FENCE_INSIDE.test(lead)) return { lead: text, rest: '' };

	return { lead, rest: text.slice(end).trim() };
}
