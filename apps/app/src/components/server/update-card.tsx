'use client';

import type { UpdateStatus } from '@recoder/shared';
import { Button, Card, GitHubMarkdown, SkeletonBox } from '@recoder/ui';

import type { UpdateLine } from '@/lib/update/update-line';
import { useLater } from '@/lib/update/use-later';
import { useUpdateStrip, type UpdateStrip } from '@/lib/update/use-update-strip';

import { Command } from '@/components/settings/providers/provider-notice';

import { UpdateAction } from './update-action';
import { UpdateCommits } from './update-commits';
import { UpdateDetail, UpdateSteps } from './update-detail';

type ReadyStrip = Extract<UpdateStrip, { view: 'ready' }>;

type AvailableLine = Extract<UpdateLine, { kind: 'available' }>;

/**
 * The top of Settings → Server → Updates: the running version, or the release waiting with its notes and what
 * installing it does, and the button for the next step. While an update runs, its steps tick off here.
 */
export function UpdateCard() {
	const strip = useUpdateStrip();

	return (
		<Card as="section" className="update-card" aria-label="Updates">
			<CardBody strip={strip} />
		</Card>
	);
}

/** What the running build is called: Recoder and its release version, never a commit or a branch. */
function recoderName(status: UpdateStatus): string {
	const { version } = status.current;

	return version ? `Recoder ${version}` : 'Recoder';
}

function CardBody({ strip }: { strip: UpdateStrip }) {
	if (strip.view === 'loading') {
		return (
			<div className="update-line">
				<div className="update-text">
					<SkeletonBox className="update-skeleton-name" />
					<SkeletonBox className="update-skeleton-detail" />
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

	return <ReadyBody strip={strip} />;
}

function ReadyBody({ strip }: { strip: ReadyStrip }) {
	const { line, status } = strip;
	const available = line.kind === 'available' ? line : null;
	const { later, setLater } = useLater(available?.version ?? null);

	if (available && later) {
		return (
			<div className="update-line">
				<div className="update-text">
					<span className="update-name">{recoderName(status)}</span>
					<span className="update-detail">{`Version ${available.version} is waiting`}</span>
				</div>
				<Button variant="ghost" onClick={() => setLater(false)}>
					Show
				</Button>
			</div>
		);
	}

	return (
		<>
			<div className="update-line" data-available={available ? true : undefined}>
				<div className="update-text">
					<span className="update-name">{available ? available.headline : recoderName(status)}</span>
					<span className="update-detail">
						<UpdateDetail line={line} />
					</span>
				</div>
				<div className="update-actions">
					{available ? (
						<Button variant="outline" onClick={() => setLater(true)}>
							Later
						</Button>
					) : null}
					<UpdateAction strip={strip} />
				</div>
			</div>
			{available ? <UpdateNews line={available} /> : null}
			{line.kind === 'progress' || line.kind === 'rolled-back' ? (
				<div className="update-part">
					<UpdateSteps steps={line.steps} label="Update progress" />
				</div>
			) : null}
			{available && status.mode === 'container' ? (
				<p className="update-promise">
					{`Backs up first. If the new version fails its health check, Recoder goes back to ${status.current.version ?? 'this version'} on its own.`}
				</p>
			) : null}
			{status.mode === 'managed' && status.managedCommand ? (
				<div className="update-part">
					<Command command={status.managedCommand} />
				</div>
			) : null}
		</>
	);
}

/** What the waiting release brings, and beside it what installing it does, step by step. */
function UpdateNews({ line }: { line: AvailableLine }) {
	if (!line.notes && line.commits.length === 0 && line.plan.length === 0) return null;

	return (
		<div className="update-part update-news">
			{line.notes || line.commits.length > 0 ? (
				<div className="update-news-part">
					<h3 className="update-part-title">What’s new</h3>
					{line.notes ? (
						<GitHubMarkdown className="update-notes">{line.notes}</GitHubMarkdown>
					) : (
						<UpdateCommits commits={line.commits} />
					)}
				</div>
			) : null}
			{line.plan.length > 0 ? (
				<div className="update-news-part">
					<h3 className="update-part-title">What the update does</h3>
					<UpdateSteps steps={line.plan} label="What the update does" />
				</div>
			) : null}
		</div>
	);
}
