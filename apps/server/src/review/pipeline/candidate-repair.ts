import { FINDING_CATEGORIES, type DropStage, type FindingCategory, type FindingSeverity } from '@recoder/shared';
import { matchesGlob } from '../chat/directive.js';
import type { RuleLedger } from '../guidelines/ledger/types.js';
import { candidateProse, changedLines, chooseAnchor } from './candidate-repair-anchor.js';
import {
	categoryIssue,
	validateCandidate,
	type CandidateContext,
	type CandidateFinding,
	type CategoryIssue
} from './consolidate.js';
import type { ReviewerFinding } from './finding-schema.js';
import type { IntentClaim } from './intent/types.js';
import type { ReviewInventory } from './inventory.js';
import { lensById } from './lenses/lenses.js';
import type { LensId } from './lenses/types.js';

/** One correction a repair makes, with the evidence that supports it. */
export type RepairChange =
	| { kind: 'anchor'; file: string; line: number; basis: string }
	| { kind: 'category'; category: FindingCategory; basis: string }
	| { kind: 'citation'; claimId: string; basis: string }
	| { kind: 'rule'; ruleId: string; basis: string };

/**
 * The one repair attempt a candidate gets after it fails location or category
 * validation. The original location, category and stop are kept so an eval
 * can see what the repair changed and why the candidate went on or stayed rejected.
 */
export interface CandidateRepair {
	original: {
		file: string;
		line?: number;
		endLine?: number;
		side?: 'old' | 'new';
		category?: string;
		ruleId?: string;
		violatedContract?: string;
		stage: DropStage;
		reason: string;
	};
	/** `deterministic` when the diff alone settled it, `model` when one model call chose among offered options; null when nothing was chosen. */
	method: 'deterministic' | 'model' | null;
	changes: RepairChange[];
	/**
	 * `revalidated`: valid again and sent to verification. `rejected`: the
	 * repaired candidate failed validation again, so the original is kept with
	 * its original stop. `unsupported`: the evidence supports no repair.
	 * `not-run`: the review's repair cap, budget or clock stopped it.
	 */
	result: 'revalidated' | 'rejected' | 'unsupported' | 'not-run';
	reason: string;
}

/** What the diff alone could not settle, for one model call to choose from offered options. */
type OpenChoice = { need: 'line'; reason: string } | { need: 'category'; issue: CategoryIssue; reason: string };

/** The corrections the evidence supports, what is left open, or why nothing is supported. */
export interface RepairPlan {
	changes: RepairChange[];
	open: OpenChoice[];
	/** Set when no supported repair exists; the candidate then stays rejected. */
	unsupported?: string;
}

/** What planning a repair reads: the change, and the ledger and intent a citation must come from. */
export interface RepairScope {
	inventory: ReviewInventory;
	ledger: RuleLedger | null;
	/** Null when the review distilled none, or a replay has none; a held claim id can then not be cited. */
	intent?: CandidateContext['intent'];
}

const TO_REVIEWER_SEVERITY: Record<FindingSeverity, ReviewerFinding['severity']> = {
	error: 'high',
	warning: 'medium',
	info: 'low'
};

/** The location reasons a repair can address; a path outside the change is never moved. */
const LINE_REASONS = new Set([
	'new-side line is not associated with this change',
	'file-level finding on a non-deleted file needs a line'
]);

/**
 * Whether a candidate qualifies for its one repair: a reviewer's candidate
 * stopped at location or category validation that has not had one, with
 * evidence a repair can rest on (cited evidence ids, an execution path, or a patch).
 */
export function isRepairable(candidate: CandidateFinding): boolean {
	const stopped = candidate.dropStage === 'location' || candidate.dropStage === 'category';
	const claim = candidate.claim;

	const usable =
		(candidate.evidenceIds?.length ?? 0) > 0 ||
		(claim?.executionPath.length ?? 0) > 0 ||
		(candidate.fix?.length ?? 0) > 0;

	return !candidate.valid && stopped && candidate.repair === undefined && claim !== undefined && usable;
}

/** The candidate as its reviewer reported it, so a repaired copy goes through the same validation. */
function toReviewerFinding(candidate: CandidateFinding): ReviewerFinding {
	const prefix = `[${candidate.category}] `;

	return {
		title: candidate.title,
		file: candidate.file,
		line: candidate.line ?? null,
		endLine: candidate.endLine ?? null,
		severity: TO_REVIEWER_SEVERITY[candidate.severity],
		category: candidate.category as FindingCategory,
		body: candidate.message.startsWith(prefix) ? candidate.message.slice(prefix.length) : candidate.message,
		side: candidate.side,
		symbol: candidate.symbol ?? null,
		ruleId: candidate.ruleId ?? null,
		smell: candidate.smell ?? null,
		claim: { ...candidate.claim!, executionPath: [...candidate.claim!.executionPath] },
		examples: candidate.examples ?? [],
		fix: candidate.fix ?? [],
		evidenceIds: candidate.evidenceIds ?? [],
		relatedLocations: candidate.relatedLocations
	};
}

/** The reported finding with the repair's corrections applied; an anchor change keeps the old place as a related location. */
function withChanges(raw: ReviewerFinding, changes: RepairChange[]): ReviewerFinding {
	let next: ReviewerFinding = { ...raw, claim: { ...raw.claim } };

	for (const change of changes) {
		if (change.kind === 'anchor') {
			const original = {
				file: raw.file,
				line: raw.line ?? undefined,
				endLine: raw.endLine ?? undefined,
				side: raw.side
			};

			next = {
				...next,
				file: change.file,
				line: change.line,
				endLine: change.line,
				side: 'new',
				symbol: null,
				relatedLocations: [...(raw.relatedLocations ?? []), original]
			};
		} else if (change.kind === 'category') next.category = change.category;
		else if (change.kind === 'citation')
			next.claim.violatedContract = `${change.claimId}: ${raw.claim.violatedContract}`;
		else next.ruleId = change.ruleId;
	}

	return next;
}

/** The lens a reviewer's candidate was held to; null for a subagent's. */
function lensOf(candidate: CandidateFinding): LensId | null {
	return (candidate.lens as LensId | undefined) ?? null;
}

/** The claims an intent-mismatch finding may rest on. */
export function citableClaims(intent: RepairScope['intent']): IntentClaim[] {
	return intent ? [intent.goals, intent.acceptanceCriteria, intent.statedConstraints, intent.nonGoals].flat() : [];
}

/** The ledger rules that apply to the file. */
export function rulesFor(ledger: RuleLedger | null, file: string) {
	return (ledger?.rules ?? []).filter((rule) => !rule.appliesTo || matchesGlob(file, rule.appliesTo));
}

/** The categories a corrected finding may take: its lens's, or any bug category for a subagent, never the one that failed. */
export function categoryOptions(candidate: CandidateFinding): FindingCategory[] {
	const lens = lensOf(candidate);
	const allowed = lens ? lensById(lens).categories : FINDING_CATEGORIES;

	return allowed.filter((category) => category !== candidate.category && category !== 'intent-mismatch');
}

/** Whether a step of the claim, or its anchor, is a line the change added: the claim then stands on the change itself. */
function pathThroughChange(raw: ReviewerFinding, inventory: ReviewInventory): boolean {
	const steps = [...raw.claim.executionPath, ...(raw.line ? [{ file: raw.file, line: raw.line }] : [])];

	return steps.some((step) => changedLines(inventory, step.file).some((line) => line.line === step.line));
}

/** Ids from `ids` that the candidate's prose names. */
function namedIn(candidate: CandidateFinding, ids: string[]): string[] {
	const prose = candidateProse(candidate).join('\n');

	return ids.filter((id) => new RegExp(`\\b${id}\\b`).test(prose));
}

/** The correction for an intent-mismatch that cites no claim the intent holds. */
function intentRepair(candidate: CandidateFinding, raw: ReviewerFinding, scope: RepairScope): RepairPlan {
	const named = namedIn(
		candidate,
		citableClaims(scope.intent).map((claim) => claim.id)
	);

	if (named.length === 1) {
		return {
			changes: [
				{ kind: 'citation', claimId: named[0], basis: `the finding names ${named[0]} outside violatedContract` }
			],
			open: []
		};
	}

	if (!pathThroughChange(raw, scope.inventory)) {
		return { changes: [], open: [], unsupported: 'no step of its execution path is a line the change added' };
	}

	const options = categoryOptions(candidate);
	const reason = 'intent-mismatch finding cites no intent claim id';

	if (candidate.lens && options.length === 1) {
		const basis = `its execution path runs through the change, and ${options[0]} is the ${candidate.lens} lens's one other category`;

		return { changes: [{ kind: 'category', category: options[0], basis }], open: [] };
	}

	return { changes: [], open: [{ need: 'category', issue: 'intent', reason }] };
}

/** The correction for a category or lens requirement the (possibly re-anchored) finding breaks. */
function categoryRepair(candidate: CandidateFinding, raw: ReviewerFinding, scope: RepairScope): RepairPlan {
	const found = categoryIssue(raw, lensOf(candidate), { ledger: scope.ledger, intent: scope.intent });

	if (!found) return { changes: [], open: [] };
	if (found.issue === 'intent') return intentRepair(candidate, raw, scope);
	if (found.issue === 'lens') return { changes: [], open: [{ need: 'category', issue: 'lens', reason: found.reason }] };

	if (found.issue === 'rule') {
		const rules = rulesFor(scope.ledger, raw.file).map((rule) => rule.id);
		const named = namedIn(candidate, rules);

		if (named.length === 1) {
			return {
				changes: [
					{ kind: 'rule', ruleId: named[0], basis: `the finding names ${named[0]}, a ledger rule for this file` }
				],
				open: []
			};
		}

		return rules.length
			? { changes: [], open: [{ need: 'category', issue: 'rule', reason: found.reason }] }
			: { changes: [], open: [], unsupported: 'no ledger rule applies to the file' };
	}

	return { changes: [], open: [], unsupported: `${found.reason}; a repair never invents one` };
}

/** The anchor correction for a candidate stopped at location validation. */
function anchorRepair(candidate: CandidateFinding, inventory: ReviewInventory): RepairPlan {
	if (!LINE_REASONS.has(candidate.dropReason ?? '')) {
		return {
			changes: [],
			open: [],
			unsupported: `${candidate.dropReason}; a repair never moves a finding to another path`
		};
	}

	const choice = chooseAnchor(candidate, inventory);

	if ('miss' in choice) return { changes: [], open: [{ need: 'line', reason: choice.reason }] };

	const terms = choice.terms.length ? ` holding ${choice.terms.join(', ')}` : '';

	return {
		changes: [
			{ kind: 'anchor', file: candidate.file, line: choice.line, basis: `${choice.tier}${terms}: ${choice.text}` }
		],
		open: []
	};
}

/**
 * Plans the repair from the diff and the candidate's own evidence: the
 * changed line its evidence ties to the claim, and a category or citation the
 * evidence supports. What the diff can't settle is left open; a path, rule,
 * requirement or line the evidence doesn't name is never made up.
 */
export function planRepair(candidate: CandidateFinding, scope: RepairScope): RepairPlan {
	const anchor =
		candidate.dropStage === 'location' ? anchorRepair(candidate, scope.inventory) : { changes: [], open: [] };

	if (anchor.unsupported) return anchor;

	const category = categoryRepair(candidate, withChanges(toReviewerFinding(candidate), anchor.changes), scope);

	if (category.unsupported) return category;

	return { changes: [...anchor.changes, ...category.changes], open: [...anchor.open, ...category.open] };
}

/** The candidate as it stood before the repair, and where it stopped. */
export function originalOf(candidate: CandidateFinding): CandidateRepair['original'] {
	return {
		file: candidate.file,
		line: candidate.line,
		endLine: candidate.endLine,
		side: candidate.side,
		category: candidate.category,
		ruleId: candidate.ruleId,
		violatedContract: candidate.claim?.violatedContract,
		stage: candidate.dropStage!,
		reason: candidate.dropReason ?? ''
	};
}

/**
 * Validates the repaired candidate again. When it passes, the candidate takes
 * its place (same ids) and goes on to verification; when it fails, the original
 * stays as it was, with its original stop. The caller stores the returned record.
 */
export function applyRepair(
	candidate: CandidateFinding,
	changes: RepairChange[],
	method: 'deterministic' | 'model',
	ctx: CandidateContext
): CandidateRepair {
	const original = originalOf(candidate);
	const raw = withChanges(toReviewerFinding(candidate), changes);

	const meta = {
		candidateId: candidate.candidateId,
		assignmentId: candidate.assignmentId ?? '',
		role: candidate.agent ?? 'reviewer',
		model: candidate.model ?? '',
		lens: lensOf(candidate)
	};

	const repaired = validateCandidate(raw, meta, ctx);

	if (!repaired.valid) {
		return { original, method, changes, result: 'rejected', reason: repaired.dropReason ?? 'failed validation again' };
	}

	const { id } = candidate;
	const repair: CandidateRepair = { original, method, changes, result: 'revalidated', reason: 'passed validation' };

	for (const key of Object.keys(candidate)) delete candidate[key as keyof CandidateFinding];

	Object.assign(candidate, repaired, { id });

	return repair;
}
