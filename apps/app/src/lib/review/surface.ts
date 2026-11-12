import {
	findingKind,
	findingTone,
	splitCategoryTag,
	type BriefQuestionReport,
	type DecisionTone,
	type FileDiff,
	type Finding,
	type FindingClaim,
	type ObligationReport,
	type Review,
	type VerificationBaseline
} from '@recoder/shared';
import { changedLines, readingLines, pathClass, type FileClass } from './files';

/** What a person decided about one item; `open` until they act. */
export type DecisionState = 'open' | 'accepted' | 'sent' | 'dismissed';

/** How a decision ends: accepted, sent back to the agent, or not an issue. */
export type Outcome = Exclude<DecisionState, 'open'>;

/** A command the reviewer ran and what it printed. */
export interface Evidence {
	command: string | null;
	exitCode: number | null;
	observed: string | null;
	expected: string | null;
	/** The same command on the base branch, when it was run there. */
	baseExitCode: number | null;
	/** `regression`: base passes, head fails. Absent when the base was not run. */
	baseResult: string | null;
	input: string | null;
}

/** How a finding was proven, in a person's words. */
export type Proof = 'reproduced' | 'traced' | 'checked' | 'unproven';

/** Something only a person can settle: a finding, or a question no reviewer could answer. */
export interface Decision {
	id: string;
	kind: 'finding' | 'question';
	tone: DecisionTone;
	title: string;
	body: string;
	category: string | null;
	quality: boolean;
	file: string;
	line: number | null;
	endLine: number | null;
	side: 'old' | 'new';
	symbol: string | null;
	proof: Proof;
	proofNote: string | null;
	claim: FindingClaim | null;
	evidence: Evidence | null;
	/** A checked unified diff, or prose when the reviewer only described the fix. */
	patch: string | null;
	suggestion: string | null;
	finding: Finding | null;
}

/** Something a reviewer checked and found sound, with how it knows. */
export interface Receipt {
	id: string;
	question: string;
	verdict: 'holds' | 'not-applicable';
	reason: string;
	file: string;
	line: number | null;
	symbol: string | null;
	evidence: Evidence | null;
	contract: { kind: string; location: string; note: string }[];
	partitions: { label: string; input: string; expected: string }[];
}

interface SurfaceFile {
	path: string;
	additions: number;
	deletions: number;
	cls: FileClass;
	/** Changed lines a person still has to read here. */
	readLines: number;
	decisionIds: string[];
	examined: boolean;
}

/** Changed lines by class; `read` shrinks as decisions are made. */
export interface Attention {
	read: number;
	checked: number;
	tests: number;
	skim: number;
	total: number;
}

/**
 * Findings of one topic that people in the repository keep marking not an
 * issue. They are listed apart, closed by default, and count toward nothing
 * until someone turns the topic back on.
 */
export interface QuietedTopic {
	id: string;
	label: string;
	/** Riskiest first. */
	decisions: Decision[];
}

export interface Surface {
	intent: string | null;
	/** What a person decides, riskiest first; quieted findings are left out. */
	decisions: Decision[];
	receipts: Receipt[];
	/** Quieted findings by topic, the topic with the riskiest finding first. */
	quieted: QuietedTopic[];
	files: SurfaceFile[];
	attention: Attention;
	/** Estimated minutes of human reading left. */
	minutes: number;
}

const TONE_RANK: Record<DecisionTone, number> = { high: 0, medium: 1, question: 2, low: 3 };

/** Lines a reviewer reads in a minute, for the time estimate. */
const LINES_PER_MINUTE = 40;

function baseline(base: VerificationBaseline | undefined): Pick<Evidence, 'baseExitCode' | 'baseResult'> {
	if (!base || 'unavailable' in base) return { baseExitCode: null, baseResult: null };

	return { baseExitCode: base.exitCode, baseResult: base.result ?? null };
}

function proofOf(finding: Finding): { proof: Proof; note: string | null } {
	const verification = finding.verification;

	if (!verification || verification.status !== 'verified')
		return { proof: 'unproven', note: verification?.reason ?? null };
	if (verification.method === 'run') return { proof: 'reproduced', note: verification.reason };
	if (verification.method === 'trace') return { proof: 'traced', note: verification.reason };

	return { proof: 'checked', note: verification.reason };
}

function findingEvidence(finding: Finding): Evidence | null {
	const run = finding.verification?.evidence;
	const command = run?.command ?? finding.verification?.command ?? null;

	if (!command) return null;

	return {
		command,
		exitCode: run?.exitCode ?? finding.verification?.exitCode ?? null,
		observed: run?.observed ?? null,
		expected: run?.expected ?? null,
		...baseline(run?.baseline),
		input: null
	};
}

function firstSentence(text: string): string {
	const match = /^(.{12,140}?[.!?])(\s|$)/.exec(text);

	return match ? match[1] : text.slice(0, 120);
}

/** A finding as a decision: title, body without its `[category]` tag, proof and fix. */
function findingDecision(finding: Finding): Decision {
	const { body } = splitCategoryTag(finding.message);
	const { proof, note } = proofOf(finding);

	return {
		id: finding.id,
		kind: 'finding',
		tone: findingTone(finding.severity),
		title: finding.title ?? firstSentence(body),
		body,
		category: finding.category ?? null,
		quality: (finding.kind ?? findingKind(finding.category)) === 'quality',
		file: finding.file,
		line: finding.line ?? null,
		endLine: finding.endLine ?? finding.line ?? null,
		side: finding.side ?? 'new',
		symbol: finding.symbol ?? null,
		proof,
		proofNote: note,
		claim: finding.claim ?? null,
		evidence: findingEvidence(finding),
		patch: finding.patch?.diff ?? null,
		suggestion: finding.suggestion ?? null,
		finding
	};
}

function questionDecisions(report: BriefQuestionReport | undefined): Decision[] {
	return (report?.questions ?? [])
		.filter((question) => question.result === 'unresolved')
		.map((question) => ({
			id: `question:${question.id}`,
			kind: 'question',
			tone: 'question',
			title: question.question,
			body: question.reason,
			category: null,
			quality: false,
			file: question.source.file,
			line: question.source.line,
			endLine: question.source.range?.end ?? question.source.line,
			side: 'new',
			symbol: question.source.symbol ?? null,
			proof: 'unproven',
			proofNote: null,
			claim: null,
			evidence: null,
			patch: null,
			suggestion: null,
			finding: null
		}));
}

/** Receipts from brief questions a reviewer disproved: "does X break?" "No, because…". */
function questionReceipts(report: BriefQuestionReport | undefined): Receipt[] {
	return (report?.questions ?? [])
		.filter((question) => question.result === 'disproved')
		.map((question) => {
			const answer = question.answers.find((candidate) => candidate.result === 'disproved') ?? question.answers[0];
			const attempt = answer?.attemptedCounterexample ?? null;

			return {
				id: `question:${question.id}`,
				question: question.question,
				verdict: 'holds',
				reason: answer?.reason ?? question.reason,
				file: question.source.file,
				line: question.source.line,
				symbol: question.source.symbol ?? null,
				evidence: attempt && {
					command: attempt.command,
					exitCode: null,
					observed: attempt.observed,
					expected: null,
					...baseline(attempt.base),
					input: attempt.input
				},
				contract: answer?.contractEvidence ?? [],
				partitions: []
			};
		});
}

/** Receipts from risky-change investigations that came back clean. */
function obligationReceipts(report: ObligationReport | undefined): Receipt[] {
	if (!report) return [];

	const byId = new Map(report.obligations.map((obligation) => [obligation.id, obligation]));

	return report.answers.flatMap((answer): Receipt[] => {
		const obligation = byId.get(answer.obligationId);

		if (!obligation || answer.result !== 'disproved') return [];

		const attempt = answer.attemptedCounterexample;

		return [
			{
				id: `obligation:${obligation.id}`,
				question: obligation.question,
				verdict: 'holds',
				reason: answer.reason,
				file: obligation.location.file,
				line: obligation.location.line,
				symbol: obligation.symbol,
				evidence: attempt && {
					command: attempt.command,
					exitCode: null,
					observed: attempt.observed,
					expected: answer.expectedBehavior,
					...baseline(attempt.base),
					input: attempt.input
				},
				contract: answer.contractEvidence,
				partitions: answer.inputPartition
			}
		];
	});
}

let pathCollator: Intl.Collator | null = null;

/**
 * The collator decisions of the same weight are ordered by path with, which
 * orders them as `localeCompare` does. Made once, on first use: the page's
 * first collator loads the locale's data, about 12 ms at a quarter of the
 * CPU's speed.
 */
function collator(): Intl.Collator {
	pathCollator ??= new Intl.Collator();

	return pathCollator;
}

/**
 * In the browser, makes the collator the first time the page is idle, so a
 * review opened after another page has settled sorts without waiting on it.
 * A review loaded cold sorts before the page is ever idle and makes it then.
 */
function warmCollator(): void {
	if (typeof requestIdleCallback === 'function') requestIdleCallback(collator);
}

warmCollator();

function byAttention(a: Decision, b: Decision): number {
	return (
		TONE_RANK[a.tone] - TONE_RANK[b.tone] ||
		Number(a.quality) - Number(b.quality) ||
		Number(a.proof === 'unproven') - Number(b.proof === 'unproven') ||
		collator().compare(a.file, b.file) ||
		(a.line ?? 0) - (b.line ?? 0)
	);
}

/**
 * Paths any reviewer was given or read. A finished review that kept no context
 * record returns null (every file counts as examined); an unfinished one has
 * examined nothing yet, so its files are not shown as checked.
 */
function examinedPaths(review: Review): Set<string> | null {
	const context = review.context;

	if (!context) return review.status === 'passed' ? null : new Set();

	const paths = new Set<string>();

	for (const unit of Object.values(context.units)) for (const item of unit.supplied) paths.add(item.path);
	for (const reviewer of context.reviewers) for (const item of reviewer.read) paths.add(item.path);

	return paths;
}

function classify(
	diff: FileDiff,
	open: Decision[],
	all: Decision[],
	examined: Set<string> | null
): Omit<SurfaceFile, 'path' | 'additions' | 'deletions'> {
	const kind = pathClass(diff.path);
	const seen = examined === null || examined.has(diff.path);
	const decisionIds = all.filter((decision) => decision.file === diff.path).map((decision) => decision.id);

	if (open.length > 0) {
		const keys = new Set<string>();

		for (const decision of open) {
			for (const key of readingLines(diff, decision.line, decision.endLine, decision.side)) keys.add(key);
		}

		return { cls: 'read', readLines: keys.size || changedLines(diff), decisionIds, examined: seen };
	}

	if (kind === 'skim') return { cls: 'skim', readLines: 0, decisionIds, examined: seen };
	if (kind === 'tests') return { cls: 'tests', readLines: 0, decisionIds, examined: seen };
	if (!seen) return { cls: 'read', readLines: changedLines(diff), decisionIds, examined: false };

	return { cls: 'checked', readLines: 0, decisionIds, examined: true };
}

/** True when people's dismissals quieted the finding's topic. */
function isQuieted(finding: Finding): boolean {
	return finding.topic?.quieted === true;
}

/** Quieted findings as decisions, grouped by topic (see {@link QuietedTopic}). */
function quietedTopics(findings: Finding[]): QuietedTopic[] {
	const topics = new Map<string, QuietedTopic>();

	for (const finding of findings) {
		if (!finding.topic) continue;

		const topic = topics.get(finding.topic.id) ?? { id: finding.topic.id, label: finding.topic.label, decisions: [] };

		topic.decisions.push(findingDecision(finding));
		topics.set(topic.id, topic);
	}

	for (const topic of topics.values()) topic.decisions.sort(byAttention);

	return [...topics.values()].sort((a, b) => byAttention(a.decisions[0], b.decisions[0]));
}

type SurfaceItems = Pick<Surface, 'decisions' | 'receipts' | 'quieted'>;

/** Decisions and receipts by review: they depend on the review alone, so deciding keeps every item the same object. */
const items = new WeakMap<Review, SurfaceItems>();

/** A review's decisions, riskiest first, its receipts and its quieted findings; built once per copy of the review. */
function itemsOf(review: Review): SurfaceItems {
	let built = items.get(review);

	if (!built) {
		const active = review.findings.filter((finding) => !isQuieted(finding));

		built = {
			decisions: [...active.map(findingDecision), ...questionDecisions(review.questions)].sort(byAttention),
			receipts: [...questionReceipts(review.questions), ...obligationReceipts(review.obligations)],
			quieted: quietedTopics(review.findings.filter(isQuieted))
		};

		items.set(review, built);
	}

	return built;
}

/**
 * The review as a person works it: what needs them, what was checked for
 * them, and how many changed lines are left to read. Decided items stop
 * counting toward reading time; their lines move to `checked`. Quieted
 * findings count toward none of it.
 */
export function buildSurface(review: Review, diffs: FileDiff[], states: Record<string, DecisionState> = {}): Surface {
	const { decisions, receipts, quieted } = itemsOf(review);
	const examined = examinedPaths(review);
	const isOpen = (decision: Decision) => (states[decision.id] ?? 'open') === 'open';
	const attention: Attention = { read: 0, checked: 0, tests: 0, skim: 0, total: 0 };

	const files = diffs.map((diff): SurfaceFile => {
		const mine = decisions.filter((decision) => decision.file === diff.path);
		const shape = classify(diff, mine.filter(isOpen), mine, examined);
		const lines = changedLines(diff);

		attention.total += lines;

		if (shape.cls === 'read') {
			attention.read += shape.readLines;
			attention.checked += lines - shape.readLines;
		} else {
			attention[shape.cls] += lines;
		}

		return { path: diff.path, additions: diff.additions, deletions: diff.deletions, ...shape };
	});

	const openCount = decisions.filter(isOpen).length;

	return {
		intent: review.summary,
		decisions,
		receipts,
		quieted,
		files,
		attention,
		minutes:
			attention.read === 0 && openCount === 0
				? 0
				: Math.max(1, Math.round(attention.read / LINES_PER_MINUTE + openCount * 0.75))
	};
}

/** The quieted topic that holds the finding `id`; null when no quieted finding has it. */
export function quietedTopicOf(surface: Surface | null, id: string): QuietedTopic | null {
	return surface?.quieted.find((topic) => topic.decisions.some((decision) => decision.id === id)) ?? null;
}
