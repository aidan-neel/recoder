import { LIVE } from '$lib/live/poll';
import { activeRuns } from '$lib/server/live';
import { listReports } from '$lib/server/report-index';

export async function load({ depends }) {
	depends(LIVE);

	const [active, reports] = await Promise.all([activeRuns(), listReports()]);

	return { hosts: active.hosts, runs: active.runs, reports };
}
