import { parseArgs } from 'node:util';
import type { CitedVia, ContextItem, OmissionReason, ReviewContext, ReviewerContext } from '@recoder/shared';
import { readReport, type BenchmarkReport } from './benchmark-report';
import { percent } from './benchmark-labels-report';
import { getReview } from './client';

const OMISSION_REASONS: OmissionReason[] = [
	'contract-unchanged',
	'caller-cap',
	'reference-cap',
	'test-cap',
	'context-cap',
	'file-cap',
	'diff-cap'
];

const CITED_VIAS: CitedVia[] = ['supplied', 'read', 'unknown'];

/** What a group of reviewers received, as counts only; a prompt shared by lenses counts once per reviewer. */
interface ReviewerTotals {
	reviewers: number;
	/** Places the prompts supplied, by kind of context. */
	supplied: Record<string, number>;
	read: number;
	cited: Record<CitedVia, number>;
	omitted: Record<OmissionReason, number>;
	/** Reads past the per-reviewer cap, counted but not listed. */
	readsDropped: number;
	/**
	 * Listed prompt omissions a reviewer's candidates cited through context it
	 * fetched itself (`via` read or unknown). Citations of the prompt's own
	 * patch pages are left out: a page's record spans from its first hunk to
	 * its last, so it would touch every cut between them.
	 */
	citedOmitted: Record<OmissionReason, number>;
	/** Supplied places none of the reviewer's candidate citations (`cited`, not only published findings) touch. */
	suppliedUncited: number;
}

/** One codebase's reviewers, plus its runs and how its published findings' evidence arrived. */
export interface ContextTotals extends ReviewerTotals {
	/** Passed runs, and those whose review stored a context record. */
	runs: number;
	recorded: number;
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

function emptyReviewerTotals(): ReviewerTotals {
	return {
		reviewers: 0,
		supplied: {},
		read: 0,
		cited: zero(CITED_VIAS),
		omitted: zero(OMISSION_REASONS),
		readsDropped: 0,
		citedOmitted: zero(OMISSION_REASONS),
		suppliedUncited: 0
	};
}

function emptyTotals(): ContextTotals {
	return {
		...emptyReviewerTotals(),
		runs: 0,
		recorded: 0,
		findings: 0,
		foundByReading: 0,
		citingNothing: 0,
		findingCited: zero(CITED_VIAS)
	};
}

const sum = (counts: Record<string, number>) => Object.values(counts).reduce((total, count) => total + count, 0);

/** Whether two places share a line, or a path when either has no lines (a test file, a whole read). */
function touches(a: ContextItem, b: ContextItem): boolean {
	if (a.path !== b.path) return false;
	if (a.startLine === undefined || b.startLine === undefined) return true;

	return a.startLine <= (b.endLine ?? b.startLine) && b.startLine <= (a.endLine ?? a.startLine);
}

/**
 * Adds one reviewer: its unit's prompt (supplied and cut), its own reads and
 * read cuts, and what its candidates cited. Cited-after-omission matches only
 * the prompt's listed cuts, not those past the listing cap or its own read cuts,
 * and only citations of context the reviewer fetched, not of its prompt.
 */
function addReviewer(totals: ReviewerTotals, context: ReviewContext, reviewer: ReviewerContext): void {
	const prompt = reviewer.unit ? context.units[reviewer.unit] : undefined;
	const cites = (item: ContextItem) => reviewer.cited.some((cited) => touches(cited, item));
	const fetched = reviewer.cited.filter((cited) => cited.via !== 'supplied');

	totals.reviewers++;

	for (const item of prompt?.supplied ?? []) {
		totals.supplied[item.kind] = (totals.supplied[item.kind] ?? 0) + 1;

		if (!cites(item)) totals.suppliedUncited++;
	}

	for (const item of prompt?.omitted ?? []) {
		if (fetched.some((cited) => touches(cited, item))) totals.citedOmitted[item.reason]++;
	}

	for (const item of reviewer.cited) totals.cited[item.via]++;
	for (const item of [...(prompt?.omitted ?? []), ...reviewer.omitted]) totals.omitted[item.reason]++;
	for (const reason of OMISSION_REASONS) totals.omitted[reason] += prompt?.omittedPast?.[reason] ?? 0;

	totals.read += reviewer.read.length;
	totals.readsDropped += reviewer.readsDropped ?? 0;
}

/** Adds one passed run's record; a run without one counts only as a run. */
export function addContext(totals: ContextTotals, context: ReviewContext | undefined): void {
	totals.runs++;

	if (!context) return;

	totals.recorded++;

	for (const reviewer of context.reviewers) addReviewer(totals, context, reviewer);

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

const vias = (counts: Record<CitedVia, number>) => CITED_VIAS.map((via) => `${via} ${counts[via]}`).join(', ');

/** Cut from the prompt yet cited, by reason. */
function citedOmittedText(totals: ReviewerTotals): string {
	return `${sum(totals.citedOmitted)}${sum(totals.citedOmitted) ? ` (${listed(totals.citedOmitted)})` : ''}`;
}

/** One codebase's block: supplied, read and cited counts, omissions by reason, and how published evidence arrived. */
export function totalsLines(name: string, totals: ContextTotals): string[] {
	const share = (count: number) => (totals.findings ? percent(count / totals.findings).trim() : '-');

	return [
		`${name}  runs ${totals.runs} (${totals.recorded} recorded)  reviewers ${totals.reviewers}`,
		`  supplied ${sum(totals.supplied)}${sum(totals.supplied) ? ` (${listed(totals.supplied)})` : ''}`,
		`    cited by none of the reviewer's candidates ${totals.suppliedUncited}`,
		`  read ${totals.read}${totals.readsDropped ? ` (+${totals.readsDropped} past the cap)` : ''}`,
		`  cited ${sum(totals.cited)} (${vias(totals.cited)})`,
		`  omitted ${OMISSION_REASONS.map((reason) => `${reason} ${totals.omitted[reason]}`).join(', ')}`,
		`    cut from the prompt, then cited ${citedOmittedText(totals)}`,
		`  published findings ${totals.findings}: backed by a read ${share(totals.foundByReading)}, citing nothing held ${share(totals.citingNothing)}`,
		`    their citations ${vias(totals.findingCited)}`
	];
}

/**
 * One line per lens over all codebases; a reviewer without a lens (a subagent
 * or an obligation investigator) counts under its role.
 */
function lensLines(byLens: Map<string, ReviewerTotals>): string[] {
	return [...byLens.keys()].sort().map((lens) => {
		const totals = byLens.get(lens)!;

		return [
			`  ${lens}  reviewers ${totals.reviewers}`,
			`supplied ${sum(totals.supplied)} (uncited ${totals.suppliedUncited})`,
			`read ${totals.read}`,
			`cited ${sum(totals.cited)} (${vias(totals.cited)})`,
			`omitted ${sum(totals.omitted)}, then cited ${citedOmittedText(totals)}`
		].join('  ');
	});
}

function addByLens(byLens: Map<string, ReviewerTotals>, context: ReviewContext): void {
	for (const reviewer of context.reviewers) {
		const lens = reviewer.lens ?? reviewer.role;
		const totals = byLens.get(lens) ?? emptyReviewerTotals();

		byLens.set(lens, totals);
		addReviewer(totals, context, reviewer);
	}
}

/**
 * Reads every passed run's review from the server and totals what its
 * reviewers received, by codebase and over all. Aggregates only: no paths,
 * findings or labels reach the output.
 */
export async function contextReport(report: BenchmarkReport, base: string): Promise<string[]> {
	const byCodebase = new Map<string, ContextTotals>();
	const byLens = new Map<string, ReviewerTotals>();
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

			if (review.context) addByLens(byLens, review.context);
		}
	}

	const names = [...byCodebase.keys()].sort();

	return [
		`Context received by reviewers in ${report.dataset}${unreadable ? ` (${unreadable} unreadable review${unreadable === 1 ? '' : 's'})` : ''}`,
		...names.flatMap((name) => ['', ...totalsLines(name, byCodebase.get(name)!)]),
		'',
		...totalsLines('all', all),
		'',
		'By lens over all codebases',
		...lensLines(byLens)
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
