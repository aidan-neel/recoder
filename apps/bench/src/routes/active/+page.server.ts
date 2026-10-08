import { LIVE } from '$lib/live/poll';
import { liveRuns } from '$lib/server/live';

export function load({ depends }) {
	depends(LIVE);

	return { live: liveRuns.read() };
}
