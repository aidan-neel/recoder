import type { RepoOverview } from '@recoder/shared';

import type { ApiClient } from '../api/client';
import { keptReads, type KeptReads } from '../api/kept-reads';

/** Repository overviews the app has read: a repository page paints its last one while a fresh one loads. */
export type OverviewCache = KeptReads<RepoOverview>;

export function createOverviewCache(client: ApiClient): OverviewCache {
	return keptReads((repoId) => client.repoOverview(repoId));
}
