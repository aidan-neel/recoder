import {
	findingKind,
	type ClaimStep,
	type DropStage,
	type FixEdit,
	type Finding,
	type FindingSeverity
} from '@recoder/shared';
import type { EvidenceStore } from '../../evidence/evidence.js';
import { ruleAppliesTo } from '../guidelines/ledger/glob.js';
import type { RuleLedger } from '../guidelines/ledger/types.js';
import { symbolAt } from './change-model/change-model.js';
import type { ChangeModel } from './change-model/types.js';
import type { CandidateRepair } from './candidate-repair.js';
import type { DetectorResult } from './detectors/types.js';
import type { ReviewerFinding } from './finding-schema.js';
import { dismissalFingerprint, fingerprintFinding, hunkAt, lineAnchor, snapToQuote } from './harness/findings.js';
import type { ReviewInventory } from './inventory.js';
import type { ChangeIntent, IntentClaim } from './intent/types.js';
import { lensById } from './lenses/lenses.js';
import type { LensId } from './lenses/types.js';
import type { PublishedBy } from './published-by.js';

const toBackendSeverity: Record<string, FindingSeverity> = {
	high: 'error',
	medium: 'warning',
	low: 'info'
};

/** An intent claim id a finding can cite: a goal, acceptance criterion, stated constraint or non-goal the code breaks. */
const INTENT_CLAIM_ID = /\b[ACGN]\d+\b/g;

export interface CandidateFinding extends Finding {
	candidateId: string;
	valid: boolean;
	dropReason?: string;
	/** The stage that dropped it, set with `dropReason`. */
	dropStage?: DropStage;
	/**
	 * Low severity while Settings keeps reviews to medium and above. It is
	 * verified like any other candidate, then held back from the findings
	 * unless `publishedBy` says why it is published anyway.
	 */
	belowBar?: true;
	/** Set once a verified candidate qualifies for the exception that publishes it despite `belowBar`. */
	publishedBy?: PublishedBy;
	/** A verifier disproved it, so a replay that verifies again can restore it. */
	refuted?: boolean;
	/** The reviewer's suggested edits; a verified quality finding's patch is built and checked from them. */
	fix?: FixEdit[];
	/** Comparable existing code a convention finding rests on; the verifier checks each is on disk. */
	examples?: ClaimStep[];
	/** The one repair attempt made after it failed location or category validation; absent when none was made. */
	repair?: CandidateRepair;
}

/** What validation and fingerprinting read from the run. */
export interface CandidateContext {
	inventory: ReviewInventory;
	evidence: EvidenceStore;
	changeModel: ChangeModel | null;
	ledger: RuleLedger | null;
	/** Whether a low-severity report is kept; without it the bar is medium. */
	reportLowSeverity?: boolean;
	/** The change intent, so a cited claim id is checked against the claims it holds. Absent when none was distilled. */
	intent?: ChangeIntent | null;
	/** Dismissal fingerprints of this repository; a candidate matching one is dropped. Absent when the review has no repository. */
	dismissed?: ReadonlySet<string>;
}

/**
 * The enclosing symbol, from the change model when it has one at this line.
 * The model's own `symbol` is shown only when the change model has none, and
 * never feeds the fingerprint.
 */
function resolveSymbol(
	ctx: CandidateContext,
	file: string,
	line: number | undefined,
	side: 'old' | 'new'
): string | undefined {
	if (!ctx.changeModel || !line) return undefined;

	return symbolAt(ctx.changeModel, file, line, side)?.qualifiedName;
}

/** The first validation check that found a problem, as the candidate's drop fields; empty when every check passed. */
function firstDrop(
	checks: Array<[DropStage, string | false | undefined]>
): Pick<CandidateFinding, 'dropReason' | 'dropStage'> {
	for (const [dropStage, dropReason] of checks) {
		if (dropReason) return { dropReason, dropStage };
	}

	return {};
}

/** Why the location can't hold a finding, or undefined when it can. */
function locationProblem(
	inventory: ReviewInventory,
	path: string,
	line: number | undefined,
	side: 'old' | 'new',
	link?: RepairLink
): string | undefined {
	const file = inventory.files.find((entry) => entry.path === path);

	if (!file) return 'path is not in the change inventory';
	if (file.excludeReason) return `path is excluded (${file.excludeReason})`;

	const linked = file.status !== 'added' && link?.file === path && addedLine(inventory, path, link.line);

	if (side === 'new' && line && !linked && !newSideAnchored(inventory, file.path, line)) {
		return 'new-side line is not associated with this change';
	}

	if (side === 'new' && !line && file.status !== 'deleted') {
		return 'file-level finding on a non-deleted file needs a line';
	}

	return undefined;
}

/** The claims an intent-mismatch finding may cite: goals, acceptance criteria, stated constraints and non-goals. */
export function citableClaims(intent: ChangeIntent | null | undefined): IntentClaim[] {
	return intent ? [intent.goals, intent.acceptanceCriteria, intent.statedConstraints, intent.nonGoals].flat() : [];
}

/**
 * Whether the text cites a claim an intent-mismatch can rest on. With the
 * intent at hand the id must be one it holds, so a made-up one counts for
 * nothing; without it any well-formed id passes.
 */
function citesIntentClaim(text: string, intent: ChangeIntent | null | undefined): boolean {
	const cited = text.match(INTENT_CLAIM_ID) ?? [];

	if (!intent) return cited.length > 0;

	const held = new Set(citableClaims(intent).map((claim) => claim.id));

	return cited.some((id) => held.has(id));
}

/**
 * A repair's supported link from a finding on an unchanged line to the line
 * the change added, in the same file, that introduces the defect. It comes
 * from the finding's own cited line or quoted symbol, never from its fix. An
 * added file's diff is the whole file, so a line outside it does not exist and
 * a link never lets it pass.
 */
export interface RepairLink {
	file: string;
	line: number;
}

/** Which of its category's or lens's requirements a finding breaks, so a repair knows what it may correct. */
export type CategoryIssue = 'lens' | 'rule' | 'smell' | 'examples' | 'intent';

/** The category or lens requirement the finding breaks and why, or undefined when it breaks none. */
export function categoryIssue(
	raw: ReviewerFinding,
	lens: LensId | null,
	ctx: Pick<CandidateContext, 'ledger' | 'intent'>
): { issue: CategoryIssue; reason: string } | undefined {
	const { ledger } = ctx;

	if (lens && !lensById(lens).categories.includes(raw.category)) {
		return { issue: 'lens', reason: `category ${raw.category} is outside the ${lens} lens` };
	}

	if (raw.category === 'repo-rule' && !(raw.ruleId && ledger?.rules.some((rule) => rule.id === raw.ruleId))) {
		return { issue: 'rule', reason: 'repo-rule finding cites no rule from the ledger' };
	}

	if (raw.category === 'readability' && !raw.smell) {
		return { issue: 'smell', reason: 'readability finding names no smell' };
	}

	if (raw.category === 'convention' && raw.examples.length < 2) {
		return { issue: 'examples', reason: 'convention finding needs two examples' };
	}

	if (raw.category === 'intent-mismatch' && !citesIntentClaim(raw.claim.violatedContract, ctx.intent)) {
		return { issue: 'intent', reason: 'intent-mismatch finding cites no intent claim id' };
	}

	return undefined;
}

/** A candidate's fingerprint, from its place in the change and the text of its first line. */
function identity(
	ctx: CandidateContext,
	parts: { file: string; category: string; ruleId?: string; smell?: string; symbol?: string },
	line: number | undefined,
	side: 'old' | 'new'
): { fingerprint: string } {
	const base = { ...parts, hunkId: hunkAt(ctx.inventory, parts.file, line, side) };
	const anchor = lineAnchor(ctx.inventory, parts.file, line, side);

	return { fingerprint: fingerprintFinding({ ...base, anchor }) };
}

/** The prose a finding's quoted code can sit in. */
function claimTexts(raw: ReviewerFinding): string[] {
	return [
		raw.title ?? '',
		raw.body,
		raw.claim.trigger,
		raw.claim.consequence,
		...raw.claim.executionPath.filter((step) => step.file === raw.file).map((step) => step.note ?? '')
	];
}

/**
 * Turns one reported finding into a candidate. It is invalid (and never
 * verified or shown) when its place isn't part of the change, its evidence
 * wasn't provided, it breaks its category's requirements, or a person already
 * dismissed the same finding in this repository. A low-severity one that
 * Settings keeps out of the review stays valid and is marked `belowBar`.
 * Only a repair passes `link`, which lets a finding on an unchanged line pass.
 */
export function validateCandidate(
	raw: ReviewerFinding,
	meta: { candidateId: string; assignmentId: string; role: string; model: string; lens: LensId | null },
	ctx: CandidateContext,
	link?: RepairLink
): CandidateFinding {
	const side: 'old' | 'new' = raw.side === 'old' ? 'old' : 'new';
	const reported = raw.line ?? undefined;
	const line = snapToQuote(ctx.inventory, raw.file, reported, side, claimTexts(raw));
	const span = raw.endLine && reported && raw.endLine >= reported ? raw.endLine - reported : 0;
	const endLine = line === undefined ? undefined : line + span;
	const provided = ctx.evidence.providedIds();
	const evidenceIds = raw.evidenceIds.filter((id) => provided.has(id));
	const symbol = resolveSymbol(ctx, raw.file, line, side);
	const ruleId = raw.ruleId ?? undefined;
	const smell = raw.smell ?? undefined;
	const shownSymbol = symbol ?? raw.symbol ?? undefined;

	const dismissal = dismissalFingerprint({
		file: raw.file,
		category: raw.category,
		ruleId,
		smell,
		symbol: shownSymbol,
		anchor: lineAnchor(ctx.inventory, raw.file, line, side)
	});

	const drop = firstDrop([
		['location', locationProblem(ctx.inventory, raw.file, line, side, link)],
		['evidence', raw.evidenceIds.length > 0 && evidenceIds.length === 0 && 'cited evidence was not provided'],
		['category', categoryIssue(raw, meta.lens, ctx)?.reason],
		['dismissed', ctx.dismissed?.has(dismissal) && 'a person dismissed this finding in an earlier review']
	]);

	const belowBar = !drop.dropReason && raw.severity === 'low' && !ctx.reportLowSeverity;

	return {
		id: crypto.randomUUID(),
		title: raw.title,
		candidateId: meta.candidateId,
		file: raw.file,
		line,
		endLine,
		severity: toBackendSeverity[raw.severity],
		message: `[${raw.category}] ${raw.body}`,
		agent: meta.role,
		model: meta.model,
		assignmentId: meta.assignmentId,
		category: raw.category,
		kind: findingKind(raw.category),
		ruleId,
		smell,
		symbol: shownSymbol,
		claim: { ...raw.claim, existingGuard: raw.claim.existingGuard ?? undefined },
		lens: meta.lens ?? undefined,
		evidenceIds,
		relatedLocations: raw.relatedLocations,
		side,
		...identity(ctx, { file: raw.file, category: raw.category, ruleId, smell, symbol }, line, side),
		...(raw.fix.length ? { fix: raw.fix } : {}),
		...(raw.examples.length ? { examples: raw.examples } : {}),
		...(belowBar ? { belowBar } : {}),
		valid: !drop.dropReason,
		...drop
	};
}

/**
 * A detector result as a candidate. It needs no verifier: the check that
 * found it is the proof (method `rule` for a mechanical repo rule, `detector`
 * otherwise). A suspected result is the exception and is left unverified for
 * one. Its place must still be part of the change.
 */
export function candidateFromDetector(
	result: DetectorResult,
	meta: { candidateId: string },
	ctx: CandidateContext
): CandidateFinding {
	const endLine = result.endLine && result.endLine >= result.line ? result.endLine : result.line;
	const symbol = resolveSymbol(ctx, result.file, result.line, 'new');
	const lens = `detector:${result.detector}`;
	const drop = firstDrop([['location', locationProblem(ctx.inventory, result.file, result.line, 'new')]]);

	return {
		id: crypto.randomUUID(),
		title: result.title,
		candidateId: meta.candidateId,
		file: result.file,
		line: result.line,
		endLine,
		severity: result.category === 'correctness' ? 'error' : 'warning',
		message: `[${result.category}] ${result.body}`,
		agent: lens,
		category: result.category,
		kind: findingKind(result.category),
		ruleId: result.ruleId,
		symbol: symbol ?? result.symbol,
		lens,
		evidenceIds: [],
		relatedLocations: result.relatedLocations,
		side: 'new',
		...identity(
			ctx,
			{ file: result.file, category: result.category, ruleId: result.ruleId, symbol },
			result.line,
			'new'
		),
		...(result.suspected
			? {}
			: {
					verification: {
						status: 'verified' as const,
						method: result.detector === 'rule-check' ? ('rule' as const) : ('detector' as const),
						reason: result.evidence.slice(0, 600)
					}
				}),
		valid: !drop.dropReason,
		...drop
	};
}

/** Whether the change added the new-side line. */
function addedLine(inventory: ReviewInventory, path: string, line: number): boolean {
	const file = inventory.diffs.find((entry) => entry.path === path);

	return (file?.hunks ?? []).some((hunk) => hunk.lines.some((entry) => entry.type === 'add' && entry.newNo === line));
}

function newSideAnchored(inventory: ReviewInventory, path: string, line: number): boolean {
	const file = inventory.diffs.find((entry) => entry.path === path);

	if (!file) return false;

	for (const hunk of file.hunks) {
		for (const entry of hunk.lines) {
			if (entry.newNo === line) return true;
		}

		if (line >= hunk.newStart && line < hunk.newStart + Math.max(hunk.newCount, 1)) return true;
	}

	return false;
}

/** Whether the candidate is verified like the rest but held back from the findings for being below the reporting bar. */
export function isHeldBack(candidate: CandidateFinding): boolean {
	return candidate.valid && candidate.belowBar === true && candidate.publishedBy === undefined;
}

/**
 * Whether a verifier ran code that shows the problem and the same run did not
 * end the same way before the change. One read from the code does not count.
 */
function isReproduced(candidate: CandidateFinding): boolean {
	const { verification } = candidate;
	const baseline = verification?.evidence?.baseline;
	const sameOnBase = baseline !== undefined && 'differs' in baseline && !baseline.differs;

	return verification?.status === 'verified' && verification.method === 'run' && !sameOnBase;
}

/**
 * Whether the candidate is a violation of a rule in the ledger that applies to
 * its file, checked by the quality verifier against the rule and the flagged
 * lines. A rule id alone, or a detector's result, does not count.
 */
function isRuleViolation(candidate: CandidateFinding, ledger: RuleLedger | null): boolean {
	const rule = ledger?.rules.find((entry) => entry.id === candidate.ruleId);
	const { verification } = candidate;

	return (
		candidate.category === 'repo-rule' &&
		rule !== undefined &&
		ruleAppliesTo(rule, candidate.file) &&
		verification?.status === 'verified' &&
		verification.method === 'rule'
	);
}

/**
 * Settles whether a held-back candidate is published anyway, once its verdict
 * is recorded, and records why. Reproduction and a verified rule violation
 * establish that the finding is real, not how much it matters, so it keeps the
 * severity the reviewer gave it.
 */
export function publishHeldBack(candidate: CandidateFinding, ledger: RuleLedger | null): void {
	delete candidate.publishedBy;

	if (!candidate.belowBar) return;

	if (isReproduced(candidate)) candidate.publishedBy = 'reproduced';
	else if (isRuleViolation(candidate, ledger)) candidate.publishedBy = 'rule';
}

/** A candidate the review can report: valid, and not held back for being below the reporting bar. */
export function isReportable(candidate: CandidateFinding): boolean {
	return candidate.valid && !isHeldBack(candidate);
}

/** A candidate as the developer sees it, without the fields only the pipeline reads. */
export function toFinding(candidate: CandidateFinding): Finding {
	const {
		candidateId: _id,
		valid: _valid,
		dropReason: _reason,
		dropStage: _stage,
		belowBar: _belowBar,
		publishedBy: _publishedBy,
		refuted: _refuted,
		fix: _fix,
		examples: _examples,
		repair: _repair,
		...finding
	} = candidate;

	return finding;
}
