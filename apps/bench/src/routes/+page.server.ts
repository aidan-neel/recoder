import { LIVE } from '$lib/live/poll';
import { liveRuns } from '$lib/server/live';
import { listReports } from '$lib/server/report-index';

export async function load({ depends }) {
	depends(LIVE);

	return { live: liveRuns.read(), reports: await listReports() };
}
