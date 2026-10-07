import { LIVE } from '$lib/live/poll';
import { host } from '$lib/server/hosts';
import { runPages } from '$lib/server/run-page';

export function load({ params, depends }) {
	depends(LIVE);

	return { page: runPages.read(`${host(params.host).id}/${params.pid}`), now: Date.now() };
}
