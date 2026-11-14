'use client';

import type { UpdateStatus } from '@recoder/shared';
import { Button, Collapsible, CollapsibleContent, Skeleton } from '@recoder/ui';

import { useUpdateStrip, type UpdateStrip as UpdateStripView } from '@/lib/update/use-update-strip';

import { UpdateAction } from './update-action';
import { UpdateCommits } from './update-commits';
import { UpdateDetail } from './update-detail';

/**
 * The top of Settings → Admin: the running version over what the updater
 * found ("Up to date", an update waiting, its progress), and the button for
 * the next step. An update's changes open under it.
 */
export function UpdateStrip() {
	const strip = useUpdateStrip();

	return (
		<section className="update-strip" aria-label="Updates">
			<StripBody strip={strip} />
		</section>
	);
}

/** What the running build is called: Recoder and its release version, never a commit or a branch. */
function recoderName(status: UpdateStatus): string {
	const { version } = status.current;

	return version ? `Recoder ${version}` : 'Recoder';
}

function StripBody({ strip }: { strip: UpdateStripView }) {
	if (strip.view === 'loading') {
		return (
			<div className="update-line">
				<div className="update-text">
					<Skeleton className="update-skeleton-name" />
					<Skeleton className="update-skeleton-detail" />
				</div>
			</div>
		);
	}

	if (strip.view === 'failed') {
		return (
			<div className="update-line">
				<div className="update-text" role="alert">
					<span data-tone="danger">{strip.error}</span>
				</div>
				<Button variant="outline" onClick={strip.retry}>
					Retry
				</Button>
			</div>
		);
	}

	return (
		<Collapsible>
			<div className="update-line">
				<div className="update-text">
					<span className="update-name">{recoderName(strip.status)}</span>
					<span className="update-detail">
						<UpdateDetail line={strip.line} />
					</span>
				</div>
				<UpdateAction strip={strip} />
			</div>
			{strip.line.kind === 'available' ? (
				<CollapsibleContent>
					<UpdateCommits commits={strip.line.commits} />
				</CollapsibleContent>
			) : null}
		</Collapsible>
	);
}
