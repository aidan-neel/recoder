const LEAD = String.raw`(?:(?:ok|okay|yes|yeah|yep|sure|please|pls|plz|now|go ahead(?: and)?|just|also|then|alright|great|cool|and|hey|hi)[,!.\s]+)*`;
const POLITE = String.raw`(?:(?:can|could|would|will|may) you (?:please )?|please |i(?:'d| would) like you to |i want you to |i need you to |let'?s )?`;
const START_VERB = String.raw`(?:start|run|begin|kick off|launch|do|perform|execute|conduct|carry out|trigger|initiate)`;
const REVIEW_NOUN = String.raw`(?:the |a |an |this |my |that |your |full |complete |thorough |proper |deep |quick |real |actual |whole |entire )*(?:review|analysis|audit|pass)\b`;
const REVIEW_VERB = String.raw`(?:review|audit|inspect|examine|look over|go over|look through|go through|scrutini[sz]e)\b`;
const FILEISH = String.raw`(?:files?|code|changes?|diff|pr|pull request|commits?|module|package|\S+\.\w{1,8}|python|typescript|javascript|rust|go|java|ruby|svelte|tests?)\b`;

const REQUEST_PATTERNS = [
	new RegExp(String.raw`^${LEAD}${POLITE}${START_VERB}(?:\s+\S+){0,3}?\s+${REVIEW_NOUN}`, 'i'),
	new RegExp(String.raw`^${LEAD}${POLITE}(?:only |just |now |also )?${REVIEW_VERB}`, 'i'),
	new RegExp(
		String.raw`^${LEAD}${POLITE}(?:only |just )?(?:check|analy[sz]e|vet)\s+(?:the |this |these |all |every |only |my |our |any )?(?:\S+\s+){0,3}?${FILEISH}`,
		'i'
	),
	new RegExp(
		String.raw`^${LEAD}(?:full review|run it|start it|start|go|proceed|run|begin|do it|let'?s go|yes|yep|yeah|ok|okay|sure|go ahead)[.!\s]*$`,
		'i'
	),
	new RegExp(String.raw`^${LEAD}(?:i'?m |we'?re )?ready(?: for the review| to start)?[.!\s]*$`, 'i')
];

/** A bare go-ahead ("ok", "run it"): nothing in it is a brief for the review. */
export const BARE_CONFIRMATION = new RegExp(
	String.raw`^${LEAD}(?:full review|run it|start it|start|go|proceed|run|begin|do it|let'?s go|yes|yep|yeah|ok|okay|sure|go ahead|ready)[.!\s]*$`,
	'i'
);

/**
 * "Review only the Python files", "run the review", "go ahead": the developer
 * is asking for the review, so it starts without a model deciding that. Small
 * models asked to decide tend to answer with a made-up review instead.
 */
export function looksLikeReviewRequest(text: string): boolean {
	const head = text.trim().replace(/\s+/g, ' ').slice(0, 300);

	if (!head) return false;

	return REQUEST_PATTERNS.some((pattern) => pattern.test(head));
}
