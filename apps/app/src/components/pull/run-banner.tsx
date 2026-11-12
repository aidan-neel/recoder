'use client';

import { Button, Keycap, Spinner, StatusGlyph } from '@recoder/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { useApi } from '@/lib/api/client';
import type { RunStage, RunView } from '@/lib/run/types';
import { runClock } from '@/lib/shell/age';
import { plural } from '@/lib/shell/format';
import { errorToast } from '@/lib/shell/notify';
import { pullHref, settingsHref } from '@/lib/shell/routes';
import { useAction } from '@/lib/shell/use-action';
import { useKeys } from '@/lib/shell/use-keys';
import { useNow } from '@/lib/shell/use-now';

import { Age } from '@/components/common/age';

interface RunBannerProps {
	run: RunView;
	repoId: string;
	number: number;
	/** Open findings of the finished review; null before one. */
	bugs: number | null;
}

/** A sentence for a rejection: its own message, else a plain fallback. */
function reason(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

/** The step the review is on, with its count: `Checking each claim · 12 of 31`. */
function stageText(stages: RunStage[]): string | null {
	const active = stages.find((stage) => stage.state === 'active');

	if (!active) return null;

	return active.detail ? `${active.label} · ${active.detail}` : active.label;
}

/** The time a review has run, ticking each second. */
function Clock({ since }: { since: string }) {
	const now = useNow(1000);

	return <span className="meta mono tabular">{runClock(now - Date.parse(since))}</span>;
}

interface BannerFrameProps {
	lead: ReactNode;
	title: ReactNode;
	detail?: ReactNode;
	children?: ReactNode;
}

/** The banner's one layout: a glyph, a sentence, a quiet detail, then the actions. */
function BannerFrame({ lead, title, detail, children }: BannerFrameProps) {
	return (
		<section className="run-banner" aria-label="Review">
			{lead}
			<div className="run-banner-text">
				<span>{title}</span>
				{detail ? <span className="meta">{detail}</span> : null}
			</div>
			<div className="run-banner-actions">{children}</div>
		</section>
	);
}

/** Starts a review, or one more: the page's one primary action until a review has run. `r` presses it. */
function ReviewButton({ run, again }: { run: RunView; again: boolean }) {
	const action = useAction();

	/** Starts the review; a refusal shows as a toast and the button offers to try again. */
	function start(): void {
		action.run(() =>
			run.start().catch((error: unknown) => {
				errorToast(reason(error, 'The review did not start.'));
				throw error;
			})
		);
	}

	useKeys({ r: start });

	return (
		<Button variant={again ? 'outline' : 'primary'} status={run.starting ? 'pending' : action.status} onClick={start}>
			{again ? 'Review again' : 'Review'}
			<Keycap k="r" />
		</Button>
	);
}

/** The way out a failed review offers beside trying again. */
function FailureLink({ action }: { action: NonNullable<RunView['failure']>['action'] }) {
	if (!action) return null;

	return (
		<Button asChild variant="outline">
			<Link href={settingsHref('models')}>{action === 'sign-in' ? 'Add a provider' : 'Open settings'}</Link>
		</Button>
	);
}

/** What a finished review found, as one sentence. */
function foundText(bugs: number | null): string {
	return bugs ? `Recoder found ${plural(bugs, 'bug')}.` : 'Recoder found no bugs.';
}

/**
 * Where the newest review stands, in one line above the diff: not reviewed,
 * queued, running, paused, failed, cancelled, out of date, or done. Each
 * state offers its one next step.
 */
export function RunBanner({ run, repoId, number, bugs }: RunBannerProps) {
	const { base } = useApi();
	const bugsHref = pullHref(base, repoId, number, 'bugs');
	const stopping = useAction();
	const resuming = useAction();
	const retrying = useAction();

	if (run.phase === 'queued' || run.phase === 'running') {
		return (
			<BannerFrame
				lead={<Spinner size={14} label={run.phase === 'queued' ? 'Queued' : 'Reviewing'} />}
				title={run.phase === 'queued' ? 'Queued' : 'Reviewing'}
				detail={run.phase === 'queued' ? run.waiting : stageText(run.stages)}
			>
				{run.connection === 'reconnecting' ? <span className="meta">Reconnecting…</span> : null}
				{run.startedAt && run.phase === 'running' ? <Clock since={run.startedAt} /> : null}
				<Button asChild variant="ghost">
					<Link href={bugsHref} replace scroll={false}>
						See progress
					</Link>
				</Button>
				<Button variant="ghost" status={stopping.status} onClick={() => stopping.run(run.cancel)}>
					Cancel
				</Button>
			</BannerFrame>
		);
	}

	if (run.phase === 'paused') {
		return (
			<BannerFrame lead={<StatusGlyph kind="idle" />} title="The review is paused." detail={stageText(run.stages)}>
				<Button variant="ghost" status={stopping.status} onClick={() => stopping.run(run.cancel)}>
					Cancel
				</Button>
				<Button variant="primary" status={resuming.status} onClick={() => resuming.run(run.resume)}>
					Resume
				</Button>
			</BannerFrame>
		);
	}

	if (run.phase === 'failed') {
		return (
			<BannerFrame
				lead={<StatusGlyph kind="failed" />}
				title="The review failed."
				detail={run.failure?.message ?? null}
			>
				<FailureLink action={run.failure?.action ?? null} />
				<Button variant="primary" status={retrying.status} onClick={() => retrying.run(run.retry)}>
					Try again
				</Button>
			</BannerFrame>
		);
	}

	if (run.phase === 'passed' && !run.outdated) {
		return (
			<BannerFrame
				lead={<StatusGlyph kind={bugs ? 'high' : 'ok'} />}
				title={foundText(bugs)}
				detail={
					<>
						Reviewed <Age at={run.finishedAt} form="long" />
					</>
				}
			>
				{bugs ? (
					<Button asChild variant="primary">
						<Link href={bugsHref} replace scroll={false}>
							{bugs === 1 ? 'See the bug' : 'See the bugs'}
						</Link>
					</Button>
				) : null}
				<ReviewButton run={run} again />
			</BannerFrame>
		);
	}

	if (run.phase === 'passed') {
		return (
			<BannerFrame
				lead={<StatusGlyph kind="outdated" />}
				title="This pull request has commits newer than its review."
				detail={foundText(bugs)}
			>
				<Button asChild variant="ghost">
					<Link href={bugsHref} replace scroll={false}>
						See the last review
					</Link>
				</Button>
				<ReviewButton run={run} again={false} />
			</BannerFrame>
		);
	}

	return (
		<BannerFrame
			lead={<StatusGlyph kind="idle" />}
			title={run.phase === 'cancelled' ? 'The review was cancelled.' : 'Recoder has not reviewed this pull request.'}
			detail={run.modelLabel}
		>
			<ReviewButton run={run} again={false} />
		</BannerFrame>
	);
}
