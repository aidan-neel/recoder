import { LIVE } from '$lib/live/poll';
import { activeRuns } from '$lib/server/live';

export async function load({ depends }) {
	depends(LIVE);

	return activeRuns();
}
