'use client';

import { Button, StatusNotice } from '@recoder/ui';
import { RotateCcw, SearchX } from 'lucide-react';
import Link from 'next/link';

import { OfflineNotice } from '@/components/common/offline-notice';
import { useApi } from '@/lib/api/client';
import type { PullPageView } from '@/lib/pull/types';
import { pullsHref } from '@/lib/shell/routes';

/**
 * What the page says when it has no pull request to show, as a banner at the
 * top of the page: the server is down, there is no such pull request, or the
 * load failed. The way forward is the last action.
 */
export function PullNotice({ view }: { view: PullPageView }) {
	const { base } = useApi();

	if (view.offline) return <OfflineNotice onRetry={view.refresh} />;

	if (view.phase === 'not-found') {
		return (
			<StatusNotice
				variant="banner"
				glyph={<SearchX aria-hidden />}
				title="There is no such pull request."
				detail="It may be in a repository that is not connected, or the link may be wrong."
				actions={
					<Button asChild>
						<Link href={pullsHref(base)}>Back to pull requests</Link>
					</Button>
				}
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
					<Button asChild variant="outline">
						<Link href={pullsHref(base)}>Back to pull requests</Link>
					</Button>
					<Button onClick={view.refresh}>
						<RotateCcw aria-hidden />
						Try again
					</Button>
				</>
			}
		/>
	);
}
