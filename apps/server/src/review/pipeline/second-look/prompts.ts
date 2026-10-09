import type { ReviewDirective } from '../../chat/directive.js';
import { investigatorSystemPrompt } from '../reviewer-prompts.js';
import type { SecondLookPurpose } from '../units.js';

const NO_HAND_ON = 'Leave "subagents", "unsettled", "answered" and "gaps" empty; you cannot hand work on.';

const ROLES: Record<SecondLookPurpose, string> = {
	residual: `Role: second-look reviewer. The lens reviewers have finished, and your task lists what the review raised. Find the defects they missed in your unit's code. Report each new defect once, in a bug category from the closed list or tests; repo rules, conventions and readability belong to the lenses that cover them. Report nothing that is already on the list, even in other words. ${NO_HAND_ON}`,
	'contract-check': `Role: contract checker. A readability reviewer found a comment, docstring, name or doc that disagrees with the code, and your task quotes it. Decide which side is wrong, as your task says, and report only on that disagreement. ${NO_HAND_ON}`
};

/** The task text of a residual pass, before the list of what the review raised. */
export const RESIDUAL_TASK = `Lens reviewers often raise the same defect several times and stop there, so a second defect in the same function goes unseen. Find defects in this unit that are not on the list below.
- Look hardest at the functions the listed candidates sit in: a function with one defect often has another.
- Try the inputs nobody tried: an empty or whitespace-only value, a duplicate, a different case, a value that is a prefix of another, a value exactly at a limit, a second or concurrent call, a failure part way through, a value the caller mutates afterwards.
- Check what the change must keep in step outside its own lines: types and exports callers import, state saved and restored, values set on every path including early returns and skips.
- You cannot run code here. Report a defect as soon as the code you read shows it; a verifier reproduces every finding you report.`;

/** The task text of a contract check, after the readability report it checks. */
export const CONTRACT_CHECK_TASK = `A comment, docstring, name or doc and the code disagree here. Settle which side is wrong before anything else:
1. Find what the code is meant to do: the pull request description and change intent, the tests, the callers, public docs and types, and the name.
2. If the code breaks what they promise, that is a defect. Report it in correctness, api-contract or intent-mismatch with the input that shows it and what goes wrong, quote the promise in violatedContract, and rate its severity by what goes wrong for a user of the code, not by where it was noticed.
3. If only the text is wrong and it is public documentation or a type that callers read, report the wrong text as api-contract.
4. If only an internal comment is out of date, report nothing: the readability finding already covers it.`;

/** A second-look subagent's system prompt: the read-only reviewer contract, then the role for its purpose. */
export function secondLookSystemPrompt(purpose: SecondLookPurpose, directive: ReviewDirective | null): string {
	return investigatorSystemPrompt(false, directive, ROLES[purpose]);
}
