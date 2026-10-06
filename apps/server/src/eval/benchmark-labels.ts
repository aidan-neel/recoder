import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { PrScore } from './benchmark-score';
import type { EvalFinding } from './metrics';

/**
 * What one published finding is. The judge decides planted and duplicate; a
 * human decides the rest, once, in the dataset's adjudication file.
 */
export const FINDING_CLASSES = ['planted', 'additional', 'false', 'unresolved', 'duplicate'] as const;

export type FindingClass = (typeof FINDING_CLASSES)[number];

export type ClassCounts = Record<FindingClass, number>;

/** How a finding was verified, in three coarse groups; `unproven` covers the rest. */
export const EVIDENCE_GROUPS = ['runtime', 'static', 'policy', 'unproven'] as const;

type EvidenceGroup = (typeof EVIDENCE_GROUPS)[number];

/** A human's call on a finding the judge matched to no planted defect. */
const adjudicationSchema = z.object({
	label: z.enum(['additional', 'false', 'unresolved']),
	file: z.string(),
	line: z.number().nullable().default(null),
	title: z.string().default(''),
	/** Why the human decided so; free text. */
	note: z.string().default('')
});

type Adjudication = z.infer<typeof adjudicationSchema>;

/**
 * A human's correction of the judge: whether one claim, by its hash, reports
 * one planted defect, and why. It is filed under `matchKey` and applies
 * wherever that claim is judged against that defect, at every stage of every run.
 */
const matchAdjudicationSchema = z.object({ reports: z.boolean(), reason: z.string().min(1) });

type MatchAdjudication = z.infer<typeof matchAdjudicationSchema>;

/** Finding labels by finding key, and match corrections by match key. */
export type Adjudications = Record<string, Adjudication | MatchAdjudication>;

/** A match key's shape: `match:<pr>:<defect id>:<claim hash>`, the hash being 16 hex digits. */
const MATCH_KEY = /^match:[^:]+:[^:]+:[0-9a-f]{16}$/;

/** An adjudication file entry that is neither a well-formed finding label nor a well-formed match correction. */
export class AdjudicationError extends Error {
	override name = 'AdjudicationError';

	constructor(key: string, problem: string) {
		super(`Adjudication "${key}": ${problem}`);
	}
}

/** The issues of a failed parse, one per field. */
function issues(error: z.ZodError): string {
	return error.issues.map((issue) => `${issue.path.join('.') || 'value'} ${issue.message}`).join('; ');
}

/**
 * One file entry, read by the shape of its key: a `match:` key holds a
 * correction and any other key a finding label, so a value filed under the
 * wrong kind of key is an error, not a silent mismatch.
 */
function entryOf(key: string, value: unknown): Adjudication | MatchAdjudication {
	if (key.startsWith('match:')) {
		if (!MATCH_KEY.test(key))
			throw new AdjudicationError(key, 'a match key is match:<pr>:<defect>:<16-hex claim hash>');

		const parsed = matchAdjudicationSchema.safeParse(value);

		if (!parsed.success)
			throw new AdjudicationError(key, `a match correction is { reports, reason }: ${issues(parsed.error)}`);

		return parsed.data;
	}

	const parsed = adjudicationSchema.safeParse(value);

	if (parsed.success) return parsed.data;

	const misfiled = matchAdjudicationSchema.safeParse(value).success
		? ' (this is a match correction; file it under match:<pr>:<defect>:<claim hash>)'
		: '';

	throw new AdjudicationError(key, `a finding label is { label, file, ... }${misfiled}: ${issues(parsed.error)}`);
}

/** Where a match correction is filed: `match:<pr>:<defect id>:<claim hash>`. */
export function matchKey(pr: string, defect: string, claim: string): string {
	return `match:${pr}:${defect}:${claim}`;
}

/** The match correction filed under `key`, if the entry there is one. */
export function matchAdjudication(adjudications: Adjudications, key: string): MatchAdjudication | undefined {
	const entry = adjudications[key];

	return entry && 'reports' in entry ? entry : undefined;
}

/** The finding label filed under `key`; unresolved when there is none. */
function findingLabel(adjudications: Adjudications, key: string): Adjudication['label'] {
	const entry = adjudications[key];

	return entry && 'label' in entry ? entry.label : 'unresolved';
}

/** One run's findings with their class, evidence group and key, in the order the judge scored them. */
export interface LabeledFindings {
	keys: string[];
	classes: FindingClass[];
	evidence: EvidenceGroup[];
}

/** A run's shown findings, and its hidden candidates when they were judged. */
export interface LabeledRun extends LabeledFindings {
	hidden?: LabeledFindings;
}

const EVIDENCE_BY_METHOD = {
	run: 'runtime',
	trace: 'static',
	detector: 'static',
	rule: 'policy',
	convention: 'policy'
} as const;

/** The adjudication file of a dataset, next to its `labels/` and outside any path the server reads. */
export function adjudicationPath(dataset: string): string {
	return join(dataset, 'adjudications.json');
}

/** The saved adjudications; none yet is an empty set, and a malformed file is an error, not an empty set. */
export function readAdjudications(path: string): Adjudications {
	if (!existsSync(path)) return {};

	const raw = z.record(z.string(), z.unknown()).parse(JSON.parse(readFileSync(path, 'utf8')));

	return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, entryOf(key, value)]));
}

/** Writes the adjudications sorted by key, so a diff of the file shows only what changed. */
export function writeAdjudications(path: string, adjudications: Adjudications): void {
	const sorted = Object.fromEntries(Object.entries(adjudications).sort(([a], [b]) => a.localeCompare(b)));

	writeFileSync(path, `${JSON.stringify(sorted, null, '\t')}\n`);
}

/**
 * A finding's identity across runs and models: its PR and the pipeline's
 * fingerprint, which wording, line numbers and the run's other findings leave
 * unchanged. A finding without a fingerprint falls back to its place.
 */
export function findingKey(pr: string, finding: EvalFinding): string {
	return `${pr}:${finding.fingerprint ?? `${finding.file}:${finding.line ?? 0}:${finding.category ?? ''}`}`;
}

/** The evidence group of a finding, by the way its verification ended. */
function evidenceGroup(finding: EvalFinding): EvidenceGroup {
	const { verification } = finding;

	if (verification?.status !== 'verified' || !verification.method) return 'unproven';

	return EVIDENCE_BY_METHOD[verification.method];
}

function emptyCounts(): ClassCounts {
	return { planted: 0, additional: 0, false: 0, unresolved: 0, duplicate: 0 };
}

/**
 * Gives every finding a class: planted and duplicate from the judge's score,
 * and for the rest the adjudication under its key, or unresolved when there is
 * none. The judge's call on a planted defect is never overridden.
 */
function classify(
	pr: string,
	findings: readonly EvalFinding[],
	score: PrScore,
	adjudications: Adjudications
): LabeledFindings {
	const planted = new Set(Object.values(score.found));
	const duplicates = new Set(score.duplicates);
	const keys = findings.map((finding) => findingKey(pr, finding));

	const classes = findings.map((_, index): FindingClass => {
		if (planted.has(index)) return 'planted';
		if (duplicates.has(index)) return 'duplicate';

		return findingLabel(adjudications, keys[index]!);
	});

	return { keys, classes, evidence: findings.map(evidenceGroup) };
}

/** Classifies a passed run's shown findings and, when the judge scored them, its hidden candidates. */
export function labelRun(
	pr: string,
	run: {
		findings: readonly EvalFinding[];
		score: PrScore;
		unconfirmed?: readonly EvalFinding[];
		hiddenScore?: PrScore | null;
	},
	adjudications: Adjudications
): LabeledRun {
	const shown = classify(pr, run.findings, run.score, adjudications);

	if (!run.unconfirmed || !run.hiddenScore) return shown;

	return { ...shown, hidden: classify(pr, run.unconfirmed, run.hiddenScore, adjudications) };
}

/**
 * Adds every finding with no human label to the adjudications as unresolved,
 * with enough of the finding to decide it without opening the report. Returns
 * whether anything was added.
 */
export function queueUnresolved(
	adjudications: Adjudications,
	findings: readonly EvalFinding[],
	labeled: LabeledFindings
): boolean {
	let added = false;

	labeled.keys.forEach((key, index) => {
		if (labeled.classes[index] !== 'unresolved' || key in adjudications) return;

		const finding = findings[index]!;

		adjudications[key] = {
			label: 'unresolved',
			file: finding.file,
			line: finding.line ?? null,
			title: finding.title ?? '',
			note: ''
		};

		added = true;
	});

	return added;
}

/** Counts findings by class. */
export function countClasses(classes: readonly FindingClass[]): ClassCounts {
	const counts = emptyCounts();

	for (const kind of classes) counts[kind]++;

	return counts;
}

/** Adds `more` into `into`. */
function addCounts(into: ClassCounts, more: ClassCounts): void {
	for (const kind of FINDING_CLASSES) into[kind] += more[kind];
}

/** Precision as an interval, because an unresolved finding is neither right nor wrong yet. */
export interface PrecisionBounds {
	/** Every unresolved finding counted wrong. */
	lower: number;
	/** Every unresolved finding counted right. */
	upper: number;
	unresolved: number;
	/** Every published finding, the denominator of both bounds. */
	published: number;
}

/**
 * `TP/N <= precision <= (TP+U)/N`, where TP is planted plus additional true
 * positives and N is every published finding, duplicates included: a
 * duplicate is a comment the reader did not need. Null when no finding was judged.
 */
export function precisionBounds(counts: ClassCounts): PrecisionBounds | null {
	const tp = counts.planted + counts.additional;
	const total = FINDING_CLASSES.reduce((sum, kind) => sum + counts[kind], 0);

	if (!total) return null;

	return {
		lower: tp / total,
		upper: (tp + counts.unresolved) / total,
		unresolved: counts.unresolved,
		published: total
	};
}

/** One group of findings: counts, and how many runs they came from. */
export interface LabelGroup {
	runs: number;
	counts: ClassCounts;
}

/** What the runs of control PRs, which plant no defect, published wrongly. */
interface ControlTotals {
	prs: number;
	runs: number;
	/** Runs with a published comment adjudicated false. */
	wrong: number;
	/** Runs with a published comment adjudicated false or still unresolved. */
	possiblyWrong: number;
}

/** The five counts over every judged run, grouped by codebase and by evidence, and the control PRs' noise. */
export interface LabelSummary {
	overall: LabelGroup;
	byCodebase: Record<string, LabelGroup>;
	byEvidence: Record<EvidenceGroup, LabelGroup>;
	control: ControlTotals;
	/** Hidden candidates adjudicated as additional true positives that no shown finding of the run repeats. */
	hiddenAdditional: number;
}

/** One PR's labeled runs. */
export interface LabeledPr {
	codebase: string;
	/** A PR with no planted defect. */
	control: boolean;
	runs: readonly LabeledRun[];
}

function group(): LabelGroup {
	return { runs: 0, counts: emptyCounts() };
}

/** Hidden candidates of a run that are additional true positives and not among its shown findings. */
function hiddenAdditional({ keys, hidden }: LabeledRun): number {
	if (!hidden) return 0;

	const shown = new Set(keys);

	return hidden.keys.filter((key, index) => hidden.classes[index] === 'additional' && !shown.has(key)).length;
}

/** Sums the classes of every labeled run into the report's groups. */
export function summarizeLabels(prs: readonly LabeledPr[]): LabelSummary {
	const summary: LabelSummary = {
		overall: group(),
		byCodebase: {},
		byEvidence: { runtime: group(), static: group(), policy: group(), unproven: group() },
		control: { prs: 0, runs: 0, wrong: 0, possiblyWrong: 0 },
		hiddenAdditional: 0
	};

	for (const pr of prs) {
		const codebase = (summary.byCodebase[pr.codebase] ??= group());

		if (pr.control && pr.runs.length) summary.control.prs++;

		for (const run of pr.runs) {
			const counts = countClasses(run.classes);

			for (const target of [summary.overall, codebase]) {
				target.runs++;
				addCounts(target.counts, counts);
			}

			run.classes.forEach((kind, index) =>
				addCounts(summary.byEvidence[run.evidence[index]!].counts, countClasses([kind]))
			);

			summary.hiddenAdditional += hiddenAdditional(run);

			if (!pr.control) continue;

			summary.control.runs++;
			if (counts.false) summary.control.wrong++;
			if (counts.false || counts.unresolved) summary.control.possiblyWrong++;
		}
	}

	return summary;
}
