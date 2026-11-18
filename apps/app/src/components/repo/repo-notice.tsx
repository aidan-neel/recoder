'use client';

import { Button, StatusNotice } from '@recoder/ui';
import { RotateCcw, SearchX } from 'lucide-react';

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
			<div className="repo-page">
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
		<div className="repo-page">
			{view.phase === 'missing' ? (
				<StatusNotice
					variant="banner"
					glyph={<SearchX aria-hidden />}
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
								<RotateCcw aria-hidden />
								Try again
							</Button>
						</>
					}
				/>
			)}
		</div>
	);
}
