'use client';

import { Button, Icon, StatusNotice } from '@recoder/ui';

import type { RepoPageView } from '@/lib/repo/types';

import { Link } from '@/components/common/link';
import { OfflineNotice } from '@/components/common/offline-notice';

/**
 * What the page says when it has no repository to show, as a banner at the top of the page: the server is down,
 * the repository is not tracked, or the load failed.
 */
export function RepoNotice({ view }: { view: RepoPageView }) {
	if (view.offline) {
		return (
			<div className="page-column repo-page">
				<OfflineNotice onRetry={view.retry} />
			</div>
		);
	}

	const back = (
		<Button asChild variant={view.phase === 'missing' ? 'secondary' : 'outline'}>
			<Link href={view.pullsHref}>Back to pull requests</Link>
		</Button>
	);

	return (
		<div className="page-column repo-page">
			{view.phase === 'missing' ? (
				<StatusNotice
					variant="banner"
					glyph={<Icon name="search_off" />}
					title="This repository is not tracked."
					detail="It may have been removed, or the link may be wrong."
					actions={back}
				/>
			) : (
				<StatusNotice
					tone="danger"
					title="The repository did not load."
					detail={view.error}
					actions={
						<>
							{back}
							<Button onClick={view.retry}>
								<Icon name="replay" />
								Try again
							</Button>
						</>
					}
				/>
			)}
		</div>
	);
}
