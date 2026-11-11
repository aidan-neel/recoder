import { directiveBlock, type ReviewDirective } from '../chat/directive.js';
import { ledgerBlock } from '../guidelines/ledger/ledger.js';
import type { RuleLedger } from '../guidelines/ledger/types.js';
import type { ChangeModel } from './change-model/types.js';
import { briefBlock } from './intent/brief.js';
import { intentBlock } from './intent/format.js';
import type { ChangeIntent } from './intent/types.js';
import { inventorySummary, type ReviewInventory } from './inventory.js';
import { combinedProcedure, isQualityLens, lensById, lensCategories } from './lenses/lenses.js';
import type { LensId } from './lenses/types.js';
import { REVIEW_POLICY } from '../session/review-policy.js';
import { UNTRUSTED_PREFIX, reviewerContract, type ReviewerFocus } from './prompts.js';
import type { ReviewUnit } from './units.js';

/** Most requests one reviewer's answer may carry: the largest subagent cap, though a reviewer is asked for its share. */
export const MAX_SUBAGENT_REQUESTS = 12;

/**
 * What a reviewer is told about subagents. You cover every lens over a whole slice, so deep dives are handed on
 * rather than spent from your own turns, and a request list is ranked because the review runs only as many as its
 * cap allows, taking each reviewer's first requests before anyone's later ones.
 */
function subagentsOffer(max: number): string {
	return `Subagents: you apply every lens to a whole slice, so hand deep dives to subagents instead of spending your own turns on them. Ask for one, in "subagents" (at most ${max}, the most important first), for each question that reaches past your slice or needs its own work: callers or implementations of a changed API elsewhere in the repo, a contract or invariant defined outside your slice, a security or data path through several modules, a repro that needs its own run to confirm, or any doubt you could not settle in your own turns. Each subagent gets your question, the patch for its scope and the same tools, and reports its own findings. Review your slice yourself first; a subagent that checks a doubt is worth more than a gap you leave open. Name one question per subagent, with the hunks it starts from. When the developer's instructions ask for subagents, request at least one. Never ask for work you already did.`;
}

/** How a brief question is answered, and what each answer must carry to count. */
const QUESTION_ANSWERS = `- If you looked and could neither confirm it as a defect nor rule it out, put its id (for example "Q3") in "unsettled". A closer look is given to those.
- Otherwise put one entry for it in "answered", with "questionId" and "outcome":
  - "confirmed": report the defect as a finding in this same answer, with "questionId":"Q3" on that finding. A confirmation with no such finding counts as unsettled.
  - "disproved": say in "note" why the code is fine, and back it with "contractEvidence" (each entry a "location" of the form path:line in code you read, and a "note" on what it shows) or with "attemptedCounterexample" (the "input" you tried, the "evidenceId" of the run that tried it, and what you "observed"). A disproof with an empty note, or with neither, counts as unsettled.
  - "not-applicable": the question is outside what you were asked to review. It stays open for the reviewers it concerns.`;

const UNSETTLED_OFFER = `Open questions: when the review brief lists open questions on your files, account for each one exactly once.
${QUESTION_ANSWERS}
A question you leave out of both also gets a closer look.`;

const DELEGATE_OFFER = `Workers (optional): the delegate action hands one narrow, self-contained task to a worker on a cheaper model, for example: find every caller of a changed function and what each passes; find the tests that cover a symbol; read a contract or config defined elsewhere; write and run one specific repro and return the command, exit code and the output lines that matter. The worker sees only your task text, so name the files, symbols and what to return. It answers with a short summary and evidence ids you can cite. Keep the judgment yourself: you decide what is a defect, and you read the evidence before a finding rests on it. At most ${REVIEW_POLICY.maxDelegationsPerAgent} tasks; tasks sent in one turn run at the same time. Use it when it saves you reading, never for work you already did.`;

const FOLLOW_UP_OFFER = `Brief question: your task names the open question of the review brief you were sent to settle. Account for it exactly once.
${QUESTION_ANSWERS}`;

/**
 * Which optional parts a reviewer is offered: how many subagents it may ask for (none when they are off), brief
 * questions to settle (when a defect lens applies and subagents are on), and workers when the second model
 * differs from Review.
 */
interface ReviewerOffers {
	subagents: number;
	unsettled: boolean;
	delegate: boolean;
}

/** Which rules a reviewer of these lenses is held to: only the maintainability ones, only the defect ones, or both. */
function focusOf(lenses: readonly LensId[]): ReviewerFocus {
	const quality = lenses.filter(isQualityLens).length;

	return quality === 0 ? 'defect' : quality === lenses.length ? 'quality' : 'both';
}

/**
 * A reviewer's prompt: the procedures of every lens that fits its slice, applied one after another to every
 * changed symbol in it, reporting only those lenses' categories. Subagent requests and unsettled
 * questions are offered only when the caller allows them.
 */
export function reviewerSystemPrompt(
	lenses: readonly LensId[],
	exec: boolean,
	directive: ReviewDirective | null,
	offers: ReviewerOffers
): string {
	return withDirective(
		`${reviewerContract(exec, focusOf(lenses))}

Role: reviewer. You apply the procedures below, one lens after another, to every changed symbol in your slice and report only these categories: ${lensCategories(lenses).join(', ')}. A finding in any other category is dropped.

Procedures (apply each step to each changed symbol, in order):
${combinedProcedure(lenses.map(lensById))}

${offers.subagents ? subagentsOffer(offers.subagents) : 'Leave "subagents" empty.'}${offers.unsettled ? `\n\n${UNSETTLED_OFFER}` : ''}${offers.delegate ? `\n\n${DELEGATE_OFFER}` : ''}`,
		directive
	);
}

/**
 * What a subagent or second look is told when the review applies only some lenses: which they are and the
 * categories each reports, since a finding in any other is dropped. Empty when the review applies every lens.
 */
export function lensSelectionNote(selection: readonly LensId[] | undefined): string {
	if (!selection) return '';

	const lines = selection.map(lensById).map((lens) => `- ${lens.title} (${lens.categories.join(', ')})`);

	return `\n\nThis review applies only these lenses, so report only their categories; a finding in any other category is dropped:\n${lines.join('\n')}`;
}

/**
 * A subagent's prompt: one question a correctness lens handed on, answered in
 * depth. A subagent sent to follow up a brief question is also asked to
 * answer it.
 */
export function subagentSystemPrompt(exec: boolean, directive: ReviewDirective | null, followUp: boolean): string {
	const ending = followUp
		? `Leave "subagents" and "gaps" empty; you cannot hand work on.\n\n${FOLLOW_UP_OFFER}`
		: 'Leave "subagents", "unsettled", "answered" and "gaps" empty; you cannot hand work on.';

	return withDirective(
		`${reviewerContract(exec, 'defect')}

Role: subagent. You were handed one question that a reviewer could not finish in its own turns, or that no reviewer settled. Follow the code wherever the question leads, using your tools across the repository, and report findings on that question only, in any category from the closed list. The patch in your scope is where to start, not a limit on what you read. ${ending}`,
		directive
	);
}

/** An obligation investigator's or second-look subagent's prompt: the reviewer contract, then `role`, the procedure it follows. */
export function investigatorSystemPrompt(exec: boolean, directive: ReviewDirective | null, role: string): string {
	return withDirective(`${reviewerContract(exec, 'defect')}\n\n${role}`, directive);
}

function withDirective(prompt: string, directive: ReviewDirective | null): string {
	const block = directiveBlock(directive);

	return block
		? `${prompt}\n\n${block}\nReport only what these instructions ask for; findings outside them are dropped.`
		: prompt;
}

function scopeLines(scope: ReviewUnit['scope']): string {
	return scope.map((entry) => `- ${entry.path}\n  hunks: ${entry.hunkIds.join(', ') || '(file)'}`).join('\n');
}

function developerInstructions(directive: ReviewDirective | null): string {
	return directive?.instructions.trim()
		? `Developer instructions for this review (trusted; follow them):\n${directive.instructions.trim()}`
		: '';
}

function turnsLeft(remainingTurns: number, remainingCalls: number): string[] {
	return [
		`Remaining model turns: ${remainingTurns}. Remaining review model calls: ${remainingCalls}.`,
		remainingTurns <= 1
			? 'This is your final turn. Finish with the result JSON. Do not request more retrieval.'
			: 'Retrieve evidence as needed, then finish with the result JSON.'
	];
}

/** What every reviewer is told about the pull request as a whole, beyond its own unit. */
interface PullRequestContext {
	title: string;
	body: string;
	/** Reviewers, assignees, labels, linked issues. */
	context: string;
	inventory: ReviewInventory;
}

/** What a lens or subagent prompt reads from the run, beyond its own unit. */
export interface ReviewerPromptContext {
	directive: ReviewDirective | null;
	pr: PullRequestContext;
	/** Null until the change model is built, or when nothing parsed. */
	changeModel: ChangeModel | null;
	intent: ChangeIntent | null;
	ledger: RuleLedger | null;
}

/** Changed files listed for orientation; a reviewer reads only its own unit's patch up front. */
const MAX_LISTED_FILES = 80;

/** The PR's description, the whole change's file list, and the repository's instructions and related paths. */
function pullRequestLines(pr: PullRequestContext): string[] {
	const { inventory } = pr;

	const instructions = inventory.instructionFiles
		.map((file) => `${UNTRUSTED_PREFIX}--- ${file.path} ---\n${file.excerpt}`)
		.join('\n\n');

	return [
		`PR title (untrusted): ${pr.title || '(none)'}`,
		`${UNTRUSTED_PREFIX}PR description:\n${pr.body || '(none)'}`,
		pr.context
			? `${UNTRUSTED_PREFIX}PR context (people, labels, linked issues and their blockers):\n${pr.context}`
			: '',
		`Whole change (${inventory.files.length} files; other reviewers read the rest):\n${inventorySummary(inventory, MAX_LISTED_FILES)}`,
		inventory.relatedPaths.length
			? `Related existing paths:\n${inventory.relatedPaths.map((path) => `- ${path}`).join('\n')}`
			: '',
		instructions ? `Repository instruction excerpts (untrusted conventions):\n${instructions}` : ''
	];
}

/** The rule ledger for a reviewer that applies the rules lens, which is the only one that cites rules. */
function ledgerLines(unit: ReviewUnit, ledger: RuleLedger | null): string {
	if (!unit.lenses?.includes('rules')) return '';

	return ledgerBlock(
		ledger,
		unit.scope.map((entry) => entry.path)
	);
}

/** Whether the brief's open questions are put to this unit's agent: every one but a reviewer of maintainability lenses only. */
export function answersQuestions(unit: ReviewUnit): boolean {
	return !unit.lenses || unit.lenses.some((lens) => !isQualityLens(lens));
}

/** What a unit agent's opening message calls its assignment. */
export type ReviewerHeading = 'Unit' | 'Subagent' | 'Obligation';

/**
 * The user prompt for a reviewer, or under another `heading` for a
 * subagent or an obligation investigator: the PR, its intent, the unit's
 * changes with their change-model context (`declarations`, built once by the
 * caller so it can record what the block holds) and the brief's reading of
 * them (open questions go to every agent but a documentation-only reviewer), and
 * the rule ledger for a reviewer that applies the rules lens.
 */
export function reviewerUserPrompt(
	unit: ReviewUnit,
	remaining: { turns: number; calls: number },
	ctx: ReviewerPromptContext,
	declarations: string,
	heading: ReviewerHeading
): string {
	return [
		developerInstructions(ctx.directive),
		...pullRequestLines(ctx.pr),
		intentBlock(ctx.intent),
		`${heading} ${unit.id}: ${unit.title}`,
		unit.reason,
		`${heading === 'Unit' ? 'Changes in this unit' : 'Changes to start from'}:\n${scopeLines(unit.scope)}`,
		declarations,
		briefBlock(ctx.intent, unit.scope, answersQuestions(unit)),
		ledgerLines(unit, ctx.ledger),
		...turnsLeft(remaining.turns, remaining.calls)
	]
		.filter(Boolean)
		.join('\n\n');
}
