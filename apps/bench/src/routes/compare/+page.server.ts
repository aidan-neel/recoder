import { compareView } from '$lib/reports/compare';
import { host } from '$lib/server/hosts';
import { listReports, readReport } from '$lib/server/report-index';

/** Compare takes at most this many reports; more bars a row stop reading as one group. */
const MOST = 4;

export async function load({ url }) {
	const reports = await listReports();

	const picked = url.searchParams
		.getAll('r')
		.slice(0, MOST)
		.flatMap((key) => reports.filter((entry) => entry.key === key));

	return {
		reports,
		view: picked.length
			? compareView(picked.map((entry) => ({ entry, report: readReport(host(entry.host), entry.file) })))
			: null
	};
}
