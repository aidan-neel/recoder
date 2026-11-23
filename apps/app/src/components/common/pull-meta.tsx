import type { PullRow } from '@/lib/pulls/types';

import { AuthorLink } from '@/components/people/author-link';

import { Age } from './age';
import { RepoLabel } from './repo-label';

interface PullMetaProps {
	row: PullRow;
	/** False leaves the repository out, on a page that is about one repository. */
	showRepo?: boolean;
}

/** The line under a pull request's title: who opened it (their profile and card), where, and how long ago it last moved. */
export function PullMeta({ row, showRepo = true }: PullMetaProps) {
	return (
		<span className="meta pull-meta">
			<AuthorLink login={row.author} repoId={row.repoId} />
			{showRepo ? <RepoLabel className="meta-sep" name={row.repoName} forge={row.repoForge} /> : null}
			<Age at={row.activeAt} className="meta-sep" />
		</span>
	);
}
