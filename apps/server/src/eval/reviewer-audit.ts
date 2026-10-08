/**
 * Which models a benchmark's reviews ran on, read from the server's stored call metrics.
 *
 *   bun src/eval/reviewer-audit.ts <report.json> <recoder.db> [--snapshot]
 *
 * Opens the store read-only: it never writes a row, but as an ordinary SQLite reader of a WAL database it may create
 * the `-wal` and `-shm` files beside it. `--snapshot` opens the file as immutable instead, which reads it without
 * any lock or side file; it is only safe on a copy nobody writes to, since SQLite then assumes the file cannot change
 * and a write during the read can give wrong results. Per run it prints the review's pipeline calls by model, split by the pipeline run that
 * made them (a replay, reverify, continue or rerun runs the pipeline again on the same review), its lock misses, and
 * CLEAN, MIXED or MISSING. A run is MIXED when a pipeline call used a model outside its run's locked picks or the
 * report's reviewer, when its pipeline runs locked different picks, or when a call went without locked models.
 * Calls stored before runs were recorded are judged against the report's reviewer only, by the model name the call
 * stored. Exits 1 when any run is MIXED.
 */
import { constants, Database } from 'bun:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { StoredMetrics } from '../models/metrics';
import { readReport, type BenchmarkReport } from './benchmark-report';
import { classifyReview, reportedModels, segmentName, type ReviewVerdict, type SegmentAudit } from './run-reviewer';

export type RunAudit = ReviewVerdict & { task: string; index: number; reviewId: string };

/** Audits every run of `report` against the metrics `store` holds for its review. */
export function auditReport(report: BenchmarkReport, store: Database): RunAudit[] {
	const query = store.query<{ value: string }, [string]>('SELECT value FROM review_metrics WHERE id = ?');
	const reported = reportedModels(report);

	return report.prs.flatMap((pr) =>
		pr.runs.map((run): RunAudit => {
			const row = query.get(run.reviewId);
			const stored = row ? (JSON.parse(row.value) as StoredMetrics) : null;

			return { task: pr.id, index: run.index, reviewId: run.reviewId, ...classifyReview(stored, reported) };
		})
	);
}

function segmentLine(segment: SegmentAudit): string {
	const calls = Object.entries(segment.calls)
		.map(([model, count]) => `${model}×${count}`)
		.join(' ');

	return `${segmentName(segment)}${segment.picks ? ` [${segment.picks.join('/')}]` : ''}: ${calls || 'no calls'}`;
}

/** The audit as printed: a header, one line per run with its segments, and a summary. */
export function auditLines(report: BenchmarkReport, audits: RunAudit[]): string[] {
	const reported = reportedModels(report);
	const count = (status: RunAudit['status']) => audits.filter((audit) => audit.status === status).length;
	const reruns = audits.filter((audit) => audit.runs > 1).length;

	return [
		`Reviewer audit: ${report.dataset}, report reviewer ${reported ? reported.join('/') : 'not recorded'}`,
		...audits.flatMap((audit) => [
			`  ${audit.task} #${audit.index} ${audit.reviewId} ${audit.status}  pipeline runs ${audit.runs}  lock misses ${audit.lockMisses}  unlocked calls ${audit.unlockedCalls}`,
			...audit.segments.map((segment) => `    ${segmentLine(segment)}`),
			...audit.reasons.map((reason) => `    MIXED: ${reason}`)
		]),
		`Summary: ${audits.length} runs, ${count('CLEAN')} clean, ${count('MIXED')} mixed, ${count('MISSING')} missing from the store, ${reruns} with more than one pipeline run`
	];
}

/** Opens the store read-only; a snapshot opens it immutable, so SQLite takes no lock and writes no side file. */
function openStore(path: string, snapshot: boolean): Database {
	if (!snapshot) return new Database(path, { readonly: true });

	return new Database(
		`${pathToFileURL(resolve(path)).href}?immutable=1`,
		constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_URI
	);
}

/** Runs the audit for `args` (report path, store path, optional `--snapshot`) and returns the exit code. */
function main(args: string[]): number {
	const { values, positionals } = parseArgs({
		args,
		options: { snapshot: { type: 'boolean', default: false } },
		allowPositionals: true,
		strict: true
	});

	const [reportPath, storePath] = positionals;

	if (!reportPath || !storePath || positionals.length !== 2) {
		console.error('Usage: bun src/eval/reviewer-audit.ts <report.json> <recoder.db> [--snapshot]');

		return 2;
	}

	const report = readReport(reportPath);
	const store = openStore(storePath, values.snapshot);

	try {
		const audits = auditReport(report, store);

		console.log(auditLines(report, audits).join('\n'));

		return audits.some((audit) => audit.status === 'MIXED') ? 1 : 0;
	} finally {
		store.close();
	}
}

if (import.meta.main) process.exit(main(Bun.argv.slice(2)));
