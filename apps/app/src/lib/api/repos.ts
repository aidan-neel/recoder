import type { RepoOverview } from '@recoder/shared';

import { request, seg } from './http';

/** What the repository page reads beyond the pull request list. */
export const reposApi = {
	overview: (repoId: string) => request<RepoOverview>(`/api/repos/${seg(repoId)}/overview`)
};
