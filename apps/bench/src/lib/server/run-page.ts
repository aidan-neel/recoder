import { reportView, type ReportView } from '$lib/reports/detail';
import type { ActiveRun } from '$lib/reports/types';
import { host } from './hosts';
import { liveRuns, tailLog, withTasks } from './live';
import { listReports, readReport } from './report-index';
import { swr } from './swr';

/** What the run page shows: the run with its tasks, its log newest line first, and its partial report. */
export interface RunPage {
	run: ActiveRun | null;
	log: string;
	view: ReportView | null;
}

/**
 * The run by `host/pid`. A run missing from the cached list is looked up
 * again, so a run that just started is not shown as ended.
 */
async function findRun(key: string): Promise<ActiveRun | undefined> {
	const cached = await liveRuns.read();

	return cached.runs.find((run) => run.key === key) ?? (await liveRuns.fresh()).runs.find((run) => run.key === key);
}

async function loadRunPage(key: string): Promise<RunPage> {
	const target = host(key.split('/')[0]!);
	const found = await findRun(key);

	if (!found) return { run: null, log: '', view: null };

	const [run, log, reports] = await Promise.all([
		withTasks(target, found),
		found.log ? tailLog(target, found.log, 80) : '',
		listReports()
	]);

	const entry = reports.find((item) => item.key === `${target.id}/${found.report}`);
	const view = entry && found.report ? reportView(readReport(target, found.report), entry) : null;

	return { run, log: log.trimEnd().split('\n').reverse().join('\n'), view };
}

/** Run pages by `host/pid`, read through a short cache like the run list. */
export const runPages = swr(3_000, loadRunPage, 60_000);
