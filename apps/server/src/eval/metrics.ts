import { findingKind, type Finding, type FindingSeverity } from '@recoder/shared';

/** The fields of a finding the eval keeps: enough to name it and to tell identity drift from finding drift. */
export type EvalFinding = Pick<
	Finding,
	| 'fingerprint'
	| 'file'
	| 'line'
	| 'endLine'
	| 'message'
	| 'category'
	| 'kind'
	| 'ruleId'
	| 'smell'
	| 'symbol'
	| 'severity'
	| 'title'
	| 'verification'
>;

/** How consistent a set of runs is under one identity key. */
export interface ConsistencyMetrics {
	/** Distinct keys seen in any run. */
	union: number;
	/** Average over the union of (runs a key appears in) / (number of runs). */
	meanStability: number;
	/** Share of the union present in every run. */
	everyRunShare: number;
	/** Mean Jaccard similarity over every pair of runs. */
	meanJaccard: number;
}

/** What one run reported, counted. */
interface RunCounts {
	findings: number;
	bugs: number;
	quality: number;
	/** Findings the pipeline gave no fingerprint, so their identity fell back to a location key. */
	unfingerprinted: number;
	bySeverity: Record<FindingSeverity, number>;
}

/** One distinct finding across the runs, with the first occurrence standing in for it. */
export interface RankedFinding {
	key: string;
	appearances: number;
	finding: EvalFinding;
}

export interface StabilityMetrics {
	runs: number;
	/** Identity by the pipeline's fingerprint. */
	strict: ConsistencyMetrics;
	/** Identity by file, category and symbol, so a fingerprint that drifts on the same issue still matches. */
	loose: ConsistencyMetrics;
	perRun: RunCounts[];
	/** Distinct findings by fingerprint, most often found first. */
	findings: RankedFinding[];
	/** Distinct findings by the loose key, most often found first. */
	looseFindings: RankedFinding[];
}

/** Prefix of the fallback key a finding without a fingerprint gets. */
const UNFINGERPRINTED = 'unfingerprinted:';

/** The pipeline's fingerprint, or a location key marked as unfingerprinted when it gave none. */
function fingerprintKey(finding: EvalFinding): string {
	return finding.fingerprint ?? `${UNFINGERPRINTED}${finding.file}:${finding.line ?? 0}:${finding.category ?? ''}`;
}

/** File, category and enclosing symbol joined by `|`; a missing category or symbol is an empty part. */
function looseKey(finding: EvalFinding): string {
	return [finding.file, finding.category ?? '', finding.symbol ?? ''].join('|');
}

/** How many runs each key appears in; a key repeated within one run counts once for it. */
export function appearanceCounts(runs: readonly ReadonlySet<string>[]): Map<string, number> {
	const counts = new Map<string, number>();

	for (const run of runs) {
		for (const key of run) counts.set(key, (counts.get(key) ?? 0) + 1);
	}

	return counts;
}

/** Average of count / runs over every key. No findings in any run is perfectly stable. */
export function meanStability(counts: ReadonlyMap<string, number>, runs: number): number {
	if (counts.size === 0 || runs === 0) return 1;

	let total = 0;

	for (const count of counts.values()) total += count / runs;

	return total / counts.size;
}

/** Share of keys found in every run. No findings in any run is perfectly stable. */
export function everyRunShare(counts: ReadonlyMap<string, number>, runs: number): number {
	if (counts.size === 0 || runs === 0) return 1;

	let always = 0;

	for (const count of counts.values()) if (count === runs) always++;

	return always / counts.size;
}

/** |A ∩ B| / |A ∪ B|, where two empty sets agree completely. */
function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
	let shared = 0;

	for (const key of a) if (b.has(key)) shared++;

	const union = a.size + b.size - shared;

	return union === 0 ? 1 : shared / union;
}

/** Mean Jaccard similarity over every pair of runs; fewer than two runs have nothing to disagree with. */
export function meanPairwiseJaccard(runs: readonly ReadonlySet<string>[]): number {
	if (runs.length < 2) return 1;

	let total = 0;
	let pairs = 0;

	for (let i = 0; i < runs.length; i++) {
		for (let j = i + 1; j < runs.length; j++) {
			total += jaccard(runs[i], runs[j]);
			pairs++;
		}
	}

	return total / pairs;
}

/** Every consistency measure for runs already reduced to their key sets. */
function consistency(runs: readonly ReadonlySet<string>[]): ConsistencyMetrics {
	const counts = appearanceCounts(runs);

	return {
		union: counts.size,
		meanStability: meanStability(counts, runs.length),
		everyRunShare: everyRunShare(counts, runs.length),
		meanJaccard: meanPairwiseJaccard(runs)
	};
}

/** Counts one run's findings by kind and severity. A finding without a stored kind takes it from its category. */
function runCounts(findings: readonly EvalFinding[]): RunCounts {
	const counts: RunCounts = {
		findings: findings.length,
		bugs: 0,
		quality: 0,
		unfingerprinted: 0,
		bySeverity: { error: 0, warning: 0, info: 0 }
	};

	for (const finding of findings) {
		if ((finding.kind ?? findingKind(finding.category)) === 'quality') counts.quality++;
		else counts.bugs++;

		if (!finding.fingerprint) counts.unfingerprinted++;
		counts.bySeverity[finding.severity]++;
	}

	return counts;
}

/** Distinct findings under `key` with how many runs found each, most often found first, then by file. */
function rankFindings(
	runs: readonly (readonly EvalFinding[])[],
	key: (finding: EvalFinding) => string
): RankedFinding[] {
	const counts = appearanceCounts(runs.map((run) => new Set(run.map(key))));
	const first = new Map<string, EvalFinding>();

	for (const run of runs) {
		for (const finding of run) if (!first.has(key(finding))) first.set(key(finding), finding);
	}

	return [...first.entries()]
		.map(([id, finding]) => ({ key: id, appearances: counts.get(id) ?? 0, finding }))
		.sort(
			(a, b) =>
				b.appearances - a.appearances ||
				a.finding.file.localeCompare(b.finding.file) ||
				(a.finding.line ?? 0) - (b.finding.line ?? 0)
		);
}

/** Every stability measure over the findings of N completed runs of the same PR. */
export function stabilityMetrics(runs: readonly (readonly EvalFinding[])[]): StabilityMetrics {
	const keySets = (key: (finding: EvalFinding) => string) => runs.map((run) => new Set(run.map(key)));

	return {
		runs: runs.length,
		strict: consistency(keySets(fingerprintKey)),
		loose: consistency(keySets(looseKey)),
		perRun: runs.map(runCounts),
		findings: rankFindings(runs, fingerprintKey),
		looseFindings: rankFindings(runs, looseKey)
	};
}
