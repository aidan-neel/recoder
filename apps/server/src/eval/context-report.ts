import { parseArgs } from 'node:util';
import type { CitedVia, OmissionReason, ReviewContext } from '@recoder/shared';
import { readReport, type BenchmarkReport } from './benchmark-report';
import { percent } from './benchmark-labels-report';
import { getReview } from './client';

const OMISSION_REASONS: OmissionReason[] = ['caller-cap', 'context-cap', 'file-cap', 'diff-cap'];
const CITED_VIAS: CitedVia[] = ['supplied', 'read', 'unknown'];

/** What the reviewers of one codebase's passed runs received, as counts only; a prompt shared by lenses counts once per reviewer. */
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
	/** Published findings; those a reporter backed with something it read itself; those citing nothing a reviewer held. */
	findings: number;
	foundByReading: number;
	citingNothing: number;
	/** The published findings' citations, one per member and evidence id, by how the reporter had it. */
	findingCited: Record<CitedVia, number>;
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
		findings: 0,
		foundByReading: 0,
		citingNothing: 0,
		findingCited: zero(CITED_VIAS)
	};
}

const sum = (counts: Record<string, number>) => Object.values(counts).reduce((total, count) => total + count, 0);

/** Adds one passed run's record; a run without one counts only as a run. */
export function addContext(totals: ContextTotals, context: ReviewContext | undefined): void {
	totals.runs++;

	if (!context) return;

	totals.recorded++;
	totals.reviewers += context.reviewers.length;

	for (const reviewer of context.reviewers) {
		const prompt = reviewer.unit ? context.units[reviewer.unit] : undefined;

		for (const item of prompt?.supplied ?? []) totals.supplied[item.kind] = (totals.supplied[item.kind] ?? 0) + 1;
		for (const item of reviewer.cited) totals.cited[item.via]++;
		for (const item of [...(prompt?.omitted ?? []), ...reviewer.omitted]) totals.omitted[item.reason]++;
		for (const reason of OMISSION_REASONS) totals.omitted[reason] += prompt?.omittedPast?.[reason] ?? 0;

		totals.read += reviewer.read.length;
		totals.readsDropped += reviewer.readsDropped ?? 0;
	}

	for (const finding of context.findings) {
		totals.findings++;

		if (finding.readBy) totals.foundByReading++;
		if (!sum(finding.cited)) totals.citingNothing++;

		for (const via of CITED_VIAS) totals.findingCited[via] += finding.cited[via];
	}
}

const listed = (counts: Record<string, number>) =>
	Object.entries(counts)
		.filter(([, count]) => count)
		.map(([key, count]) => `${key} ${count}`)
		.join(', ');

/** One codebase's block: supplied, read and cited counts, omissions by reason, and how published evidence arrived. */
export function totalsLines(name: string, totals: ContextTotals): string[] {
	const share = (count: number) => (totals.findings ? percent(count / totals.findings).trim() : '-');

	return [
		`${name}  runs ${totals.runs} (${totals.recorded} recorded)  reviewers ${totals.reviewers}`,
		`  supplied ${sum(totals.supplied)}${sum(totals.supplied) ? ` (${listed(totals.supplied)})` : ''}`,
		`  read ${totals.read}${totals.readsDropped ? ` (+${totals.readsDropped} past the cap)` : ''}`,
		`  cited ${sum(totals.cited)} (${CITED_VIAS.map((via) => `${via} ${totals.cited[via]}`).join(', ')})`,
		`  omitted ${OMISSION_REASONS.map((reason) => `${reason} ${totals.omitted[reason]}`).join(', ')}`,
		`  published findings ${totals.findings}: backed by a read ${share(totals.foundByReading)}, citing nothing held ${share(totals.citingNothing)}`,
		`    their citations ${CITED_VIAS.map((via) => `${via} ${totals.findingCited[via]}`).join(', ')}`
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
