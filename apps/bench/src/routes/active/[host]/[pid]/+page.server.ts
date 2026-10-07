import { LIVE } from '$lib/live/poll';
import { reportView } from '$lib/reports/detail';
import { host } from '$lib/server/hosts';
import { activeRuns, tailLog, withTasks } from '$lib/server/live';
import { listReports, readReport } from '$lib/server/report-index';

export async function load({ params, depends }) {
	depends(LIVE);

	const target = host(params.host);
	const { runs } = await activeRuns();
	const found = runs.find((run) => run.key === `${target.id}/${params.pid}`);

	if (!found) return { run: null, log: '', view: null, now: Date.now() };

	const [run, log, reports] = await Promise.all([
		withTasks(target, found),
		found.log ? tailLog(target, found.log, 80) : '',
		listReports()
	]);

	const entry = reports.find((item) => item.key === `${target.id}/${found.report}`);
	const view = entry && found.report ? reportView(readReport(target, found.report), entry) : null;

	return { run, log: log.trimEnd().split('\n').reverse().join('\n'), view, now: Date.now() };
}
