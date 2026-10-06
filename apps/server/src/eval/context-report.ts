import { parseArgs } from 'node:util';
import type { CitedVia, FindingCitation, OmissionReason, ReviewContext } from '@recoder/shared';
import { readReport, type BenchmarkReport } from './benchmark-report';
import { percent } from './benchmark-labels-report';
import { getReview } from './client';

type FindingVia = FindingCitation['via'];

const OMISSION_REASONS: OmissionReason[] = ['caller-cap', 'context-cap', 'file-cap', 'diff-cap'];
const CITED_VIAS: CitedVia[] = ['supplied', 'read', 'unknown'];
const FINDING_VIAS: FindingVia[] = ['supplied', 'read', 'unknown', 'none'];

/** What the reviewers of one codebase's passed runs received, as counts only. */
export interface ContextTotals {
	/** Passed runs, and those whose review stored a context record. */
	runs: number;
	recorded: number;
	reviewers: number;
	/** Places the prompts supplied, by kind of context. */
	supplied: Record<string, number>;
	read: number;
	cited: Record<CitedVia, number>;
	omitted: Record<OmissionReason, number>;
	/** Reads past the per-reviewer cap, counted but not listed. */
	readsDropped: number;
	/** Published findings, by how their reporters had the evidence they cited. */
	findings: Record<FindingVia, number>;
}

function zero<K extends string>(keys: K[]): Record<K, number> {
	return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
}

function emptyTotals(): ContextTotals {
	return {
		runs: 0,
		recorded: 0,
		reviewers: 0,
		supplied: {},
		read: 0,
		cited: zero(CITED_VIAS),
		omitted: zero(OMISSION_REASONS),
		readsDropped: 0,
		findings: zero(FINDING_VIAS)
	};
}

/** Adds one passed run's record; a run without one counts only as a run. */
export function addContext(totals: ContextTotals, context: ReviewContext | undefined): void {
	totals.runs++;

	if (!context) return;

	totals.recorded++;
	totals.reviewers += context.reviewers.length;

	for (const reviewer of context.reviewers) {
		for (const item of reviewer.supplied) totals.supplied[item.kind] = (totals.supplied[item.kind] ?? 0) + 1;
		for (const item of reviewer.cited) totals.cited[item.via]++;
		for (const item of reviewer.omitted) totals.omitted[item.reason]++;

		totals.read += reviewer.read.length;
		totals.readsDropped += reviewer.readsDropped ?? 0;
	}

	for (const finding of context.findings) totals.findings[finding.via]++;
}

const sum = (counts: Record<string, number>) => Object.values(counts).reduce((total, count) => total + count, 0);

const listed = (counts: Record<string, number>) =>
	Object.entries(counts)
		.filter(([, count]) => count)
		.map(([key, count]) => `${key} ${count}`)
		.join(', ');

/** One codebase's block: supplied, read and cited counts, omissions by reason, and how published evidence arrived. */
export function totalsLines(name: string, totals: ContextTotals): string[] {
	const published = sum(totals.findings);
	const share = (via: FindingVia) => `${via} ${published ? percent(totals.findings[via] / published).trim() : '-'}`;

	return [
		`${name}  runs ${totals.runs} (${totals.recorded} recorded)  reviewers ${totals.reviewers}`,
		`  supplied ${sum(totals.supplied)}${sum(totals.supplied) ? ` (${listed(totals.supplied)})` : ''}`,
		`  read ${totals.read}${totals.readsDropped ? ` (+${totals.readsDropped} past the cap)` : ''}`,
		`  cited ${sum(totals.cited)} (${CITED_VIAS.map((via) => `${via} ${totals.cited[via]}`).join(', ')})`,
		`  omitted ${OMISSION_REASONS.map((reason) => `${reason} ${totals.omitted[reason]}`).join(', ')}`,
		`  published findings ${published}: evidence ${FINDING_VIAS.map(share).join(', ')}`
	];
}

/**
 * Reads every passed run's review from the server and totals what its
 * reviewers received, by codebase and over all. Aggregates only: no paths,
 * findings or labels reach the output.
 */
export async function contextReport(report: BenchmarkReport, base: string): Promise<string[]> {
	const byCodebase = new Map<string, ContextTotals>();
	const all = emptyTotals();
	let unreadable = 0;

	for (const pr of report.prs) {
		for (const run of pr.runs.filter((item) => item.outcome === 'passed')) {
			const review = await getReview(base, run.reviewId).catch(() => null);

			if (!review) {
				unreadable++;
				continue;
			}

			const totals = byCodebase.get(pr.codebase) ?? emptyTotals();

			byCodebase.set(pr.codebase, totals);
			addContext(totals, review.context);
			addContext(all, review.context);
		}
	}

	const names = [...byCodebase.keys()].sort();

	return [
		`Context received by reviewers in ${report.dataset}${unreadable ? ` (${unreadable} unreadable review${unreadable === 1 ? '' : 's'})` : ''}`,
		...names.flatMap((name) => ['', ...totalsLines(name, byCodebase.get(name)!)]),
		'',
		...totalsLines('all', all)
	];
}

if (import.meta.main) {
	const { values, positionals } = parseArgs({
		args: Bun.argv.slice(2),
		options: { base: { type: 'string', default: 'http://localhost:3001' } },
		allowPositionals: true,
		strict: true
	});

	if (positionals.length !== 1) {
		console.error('Usage: bun src/eval/context-report.ts <benchmark report.json> --base http://localhost:PORT');
		process.exit(1);
	}

	console.log((await contextReport(readReport(positionals[0]), values.base)).join('\n'));
}
