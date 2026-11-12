'use client';

import { Button, StatusNotice } from '@recoder/ui';
import Link from 'next/link';

import { OfflineNotice } from '@/components/common/offline-notice';
import { useApi } from '@/lib/api/client';
import type { PullPageView } from '@/lib/pull/types';
import { pullsHref } from '@/lib/shell/routes';

/** What the page says when it has no pull request to show: the server is down, there is no such pull request, or the load failed. */
export function PullNotice({ view }: { view: PullPageView }) {
	const { base } = useApi();

	const back = (
		<Button asChild variant="outline">
			<Link href={pullsHref(base)}>Back to pull requests</Link>
		</Button>
	);

	if (view.offline) return <OfflineNotice onRetry={view.refresh} />;

	if (view.phase === 'not-found') {
		return (
			<StatusNotice
				title="There is no such pull request."
				detail="It may be in a repository that is not connected, or the link may be wrong."
				actions={back}
			/>
		);
	}

	return (
		<StatusNotice
			tone="danger"
			title="The pull request did not load."
			detail={view.error}
			actions={
				<>
					<Button onClick={view.refresh}>Try again</Button>
					{back}
				</>
			}
		/>
	);
}
