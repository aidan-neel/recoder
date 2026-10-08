import { directiveBlock, type ReviewDirective } from '../chat/directive.js';
import { ledgerBlock } from '../guidelines/ledger/ledger.js';
import type { RuleLedger } from '../guidelines/ledger/types.js';
import type { ChangeModel } from './change-model/types.js';
import { briefBlock } from './intent/brief.js';
import { intentBlock } from './intent/format.js';
import type { ChangeIntent } from './intent/types.js';
import { inventorySummary, type ReviewInventory } from './inventory.js';
import { isQualityLens } from './lenses/lenses.js';
import type { Lens } from './lenses/types.js';
import { REVIEW_POLICY } from '../session/review-policy.js';
import { UNTRUSTED_PREFIX, reviewerContract } from './prompts.js';
import type { ReviewUnit } from './units.js';

/** Most units need no subagent; a correctness lens may ask for this many at most. */
export const MAX_SUBAGENT_REQUESTS = 2;

const SUBAGENTS_OFFER = `Subagents: ask for one, in "subagents" (at most ${MAX_SUBAGENT_REQUESTS}), whenever a question reaches past this unit's patch and context and you could not settle it in your own turns: callers or implementations of a changed API elsewhere in the repo, a contract or invariant defined outside your scope, a security or data path through several modules, or behavior that needs its own run to confirm. Each subagent gets your question, the patch for its scope and the same tools, and reports its own findings. A subagent that checks a doubt is worth more than a gap you leave open. When the developer's instructions ask for subagents, request at least one for this unit's most important open question. Never ask for work you already did.`;

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
 * Which optional parts a lens reviewer is offered: subagent requests (the
 * correctness lens) and brief questions to settle (the defect lenses), when
 * subagents are on, and workers when the second model differs from Review.
 */
interface ReviewerOffers {
	subagents: boolean;
	unsettled: boolean;
	delegate: boolean;
}

/**
 * A lens reviewer's prompt: one fixed procedure over every changed symbol in
 * its unit, reporting only the lens's categories. Subagent requests and
 * unsettled questions are offered only when the caller allows them.
 */
export function reviewerSystemPrompt(
	lens: Lens,
	exec: boolean,
	directive: ReviewDirective | null,
	offers: ReviewerOffers
): string {
	return withDirective(
		`${reviewerContract(exec, isQualityLens(lens.id))}

Role: ${lens.title} lens reviewer. You apply one fixed procedure to every changed symbol in your unit and report only these categories: ${lens.categories.join(', ')}. A finding in any other category is dropped; other lenses cover it.

Procedure (apply each step to each changed symbol, in order):
${lens.procedure}

${offers.subagents ? SUBAGENTS_OFFER : 'Leave "subagents" empty.'}${offers.unsettled ? `\n\n${UNSETTLED_OFFER}` : ''}${offers.delegate ? `\n\n${DELEGATE_OFFER}` : ''}`,
		directive
	);
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
		`${reviewerContract(exec, false)}

Role: subagent. You were handed one question that a reviewer could not finish in its own turns, or that no reviewer settled. Follow the code wherever the question leads, using your tools across the repository, and report findings on that question only, in any category from the closed list. The patch in your scope is where to start, not a limit on what you read. ${ending}`,
		directive
	);
}

/** An obligation investigator's prompt: the reviewer contract, then `role`, the procedure it follows. */
export function investigatorSystemPrompt(exec: boolean, directive: ReviewDirective | null, role: string): string {
	return withDirective(`${reviewerContract(exec, false)}\n\n${role}`, directive);
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
		`Whole change (${inventory.files.length} files; other units review the rest):\n${inventorySummary(inventory, MAX_LISTED_FILES)}`,
		inventory.relatedPaths.length
			? `Related existing paths:\n${inventory.relatedPaths.map((path) => `- ${path}`).join('\n')}`
			: '',
		instructions ? `Repository instruction excerpts (untrusted conventions):\n${instructions}` : ''
	];
}

/** The rule ledger for the quality lenses, which are the only ones that cite rules. */
function ledgerLines(unit: ReviewUnit, ledger: RuleLedger | null): string {
	if (!unit.lens || !isQualityLens(unit.lens)) return '';

	return ledgerBlock(
		ledger,
		unit.scope.map((entry) => entry.path)
	);
}

/** What a unit agent's opening message calls its assignment. */
export type ReviewerHeading = 'Unit' | 'Subagent' | 'Obligation';

/**
 * The user prompt for a lens assignment, or under another `heading` for a
 * subagent or an obligation investigator: the PR, its intent, the unit's
 * changes with their change-model context (`declarations`, built once by the
 * caller so it can record what the block holds) and the brief's reading of
 * them (open questions go to the defect lenses), and the rule ledger for the
 * quality lenses.
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
		briefBlock(ctx.intent, unit.scope, !unit.lens || !isQualityLens(unit.lens)),
		ledgerLines(unit, ctx.ledger),
		...turnsLeft(remaining.turns, remaining.calls)
	]
		.filter(Boolean)
		.join('\n\n');
}
