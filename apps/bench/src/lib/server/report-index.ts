import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { allRuns, configKey } from '$lib/reports/stats';
import type { BenchmarkReport, HostConfig, ReportEntry } from '$lib/reports/types';
import { hosts } from './hosts';
import { evalsDir, syncHost } from './mirror';

const REPORT = /^benchmark-.+\.json$/;

/** Parsed entries by path, kept while the file's mtime and size stay the same. */
const cache = new Map<string, { stamp: string; entry: ReportEntry | null }>();

function entryOf(report: BenchmarkReport, target: HostConfig, file: string): ReportEntry {
	const runs = allRuns(report);
	const passed = runs.filter((run) => run.outcome === 'passed');
	const scored = passed.filter((run) => run.score);
	const totalMs = passed.reduce((sum, run) => sum + run.durationMs, 0);

	return {
		key: `${target.id}/${file}`,
		host: target.id,
		hostLabel: target.label,
		file,
		dataset: report.dataset,
		startedAt: report.startedAt,
		finishedAt: report.finishedAt,
		runsPerPr: report.runsPerPr,
		prIds: report.prs.map((pr) => pr.id),
		judge: report.judge,
		reviewer: report.reviewer ?? null,
		harnessCommit: report.harness?.tree.commit ?? null,
		config: configKey(report.reviewer, report.judge),
		overall: report.summary.overall,
		byKind: report.summary.byKind,
		runsExpected: report.prs.length * report.runsPerPr,
		runsPassed: passed.length,
		runsFailed: runs.length - passed.length,
		findings: scored.reduce((sum, run) => sum + run.findings.length, 0),
		unlabeled: scored.reduce((sum, run) => sum + (run.score?.unlabeled.length ?? 0), 0),
		meanReviewMinutes: passed.length ? totalMs / passed.length / 60_000 : null,
		lost: report.summary.hidden.lost,
		defectStability: report.summary.defectStability
	};
}

/** Reads one report file into an entry; a file mid-write or of another shape gives null. */
function indexFile(target: HostConfig, dir: string, file: string): ReportEntry | null {
	const path = join(dir, file);
	const stat = statSync(path);
	const stamp = `${stat.mtimeMs}:${stat.size}`;
	const cached = cache.get(path);

	if (cached?.stamp === stamp) return cached.entry;

	let entry: ReportEntry | null = null;

	try {
		const report = JSON.parse(readFileSync(path, 'utf8')) as BenchmarkReport;

		entry = report.prs && report.summary && report.judge ? entryOf(report, target, file) : null;
	} catch {}

	cache.set(path, { stamp, entry });

	return entry;
}

/** Every benchmark report on every host, newest first. Remote hosts are synced first. */
export async function listReports(): Promise<ReportEntry[]> {
	const targets = hosts();

	await Promise.all(targets.map((target) => syncHost(target)));

	return targets
		.flatMap((target) => {
			const dir = evalsDir(target);

			if (!existsSync(dir)) return [];

			return readdirSync(dir)
				.filter((file) => REPORT.test(file))
				.map((file) => indexFile(target, dir, file))
				.filter((entry): entry is ReportEntry => entry !== null);
		})
		.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** One report in full, by host id and file name. */
export function readReport(target: HostConfig, file: string): BenchmarkReport {
	if (!REPORT.test(file) || file.includes('/')) throw new Error(`Not a report name: ${file}`);

	return JSON.parse(readFileSync(join(evalsDir(target), file), 'utf8')) as BenchmarkReport;
}
