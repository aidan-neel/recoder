'use client';

import { Button, StatusNotice } from '@recoder/ui';
import Link from 'next/link';

import { OfflineNotice } from '@/components/common/offline-notice';
import { useApi } from '@/lib/api/client';
import type { PullListView } from '@/lib/pulls/types';
import { newReviewHref, SAMPLE_HREF, settingsHref } from '@/lib/shell/routes';

/** True when a filter, a repository or search text narrows the list. */
function narrowed(view: PullListView): boolean {
	return view.filter !== 'all' || view.repoId !== null || view.query !== '';
}

/** Shows every open pull request again. */
function clearNarrowing(view: PullListView): void {
	view.setFilter('all');
	view.setRepoId(null);
	view.setQuery('');
}

/**
 * What the list says when it has no rows to show: the server is down, the
 * load failed, nothing is connected yet, the filters match nothing, or there
 * is nothing open. Each one names the way out.
 */
export function PullsNotice({ view }: { view: PullListView }) {
	const { base } = useApi();

	if (view.offline) return <OfflineNotice onRetry={view.refresh} />;

	if (view.phase === 'failed') {
		return (
			<StatusNotice
				tone="danger"
				title="The pull requests did not load."
				detail={view.error}
				actions={<Button onClick={view.refresh}>Try again</Button>}
			/>
		);
	}

	if (view.noRepos) {
		return (
			<StatusNotice
				title="No repository is connected yet."
				detail="Connect one and its open pull requests show here."
				actions={
					<>
						<Button asChild variant="primary">
							<Link href={settingsHref('connections')}>Connect a repository</Link>
						</Button>
						<Button asChild variant="outline">
							<Link href={SAMPLE_HREF}>Look at a sample</Link>
						</Button>
					</>
				}
			/>
		);
	}

	if (narrowed(view)) {
		return (
			<StatusNotice
				title="No pull request matches."
				actions={<Button onClick={() => clearNarrowing(view)}>Show all open</Button>}
			/>
		);
	}

	return (
		<StatusNotice
			title="No open pull requests."
			detail="New ones show here when they open. You can also review a branch."
			actions={
				<Button asChild>
					<Link href={newReviewHref(base)}>New review</Link>
				</Button>
			}
		/>
	);
}
