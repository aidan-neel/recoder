'use client';

import { Button, cn, Keycap, StatusGlyph, StatusNotice } from '@recoder/ui';
import { Check, Circle, RotateCcw, X } from 'lucide-react';
import Link from 'next/link';
import type { ComponentProps } from 'react';

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
import { CancelReviewButton } from '@/components/common/cancel-review';

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

/** Runs one control of the review on its button; a refusal shows the server's reason in a toast. */
function runControl(action: ReturnType<typeof useAction>, call: () => Promise<void>, fallback: string): void {
	action.run(() =>
		call().catch((error: unknown) => {
			errorToast(reason(error, fallback));
			throw error;
		})
	);
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

/** When the review ended and the model it ran with: `4 minutes ago · Opus 5.5 · High`. */
function RunFacts({ at, model }: { at: string | null; model: string | null }) {
	return (
		<>
			<Age at={at} form="long" />
			{at && model ? ' · ' : null}
			{model}
		</>
	);
}

type BannerProps = Omit<ComponentProps<typeof StatusNotice>, 'variant' | 'role' | 'label'>;

/**
 * The banner's one shape, the kit's banner notice. It is a region named
 * Review, not a live one: its step and its clock change every few seconds.
 */
function Banner(props: BannerProps) {
	return <StatusNotice {...props} variant="banner" role="region" label="Review" />;
}

/** The mark before a step in the footer: a check once done, a cross where it stopped, a ring for the rest. */
function StepMark({ done, stopped }: { done: boolean; stopped: boolean }) {
	if (done) return <Check className="text-ok" strokeWidth={2.5} aria-hidden />;
	if (stopped) return <X className="text-danger" strokeWidth={2.5} aria-hidden />;

	return (
		<span className="grid size-3 place-items-center" aria-hidden>
			<Circle className="size-2 text-fg-ghost" strokeWidth={3} />
		</span>
	);
}

/** One step in the footer; the one the review stopped at reads in ink and says so. */
function Step({ stage, stopped }: { stage: RunStage; stopped: boolean }) {
	return (
		<li className={cn('inline-flex items-center gap-1.5', stopped && 'text-fg')} data-state={stage.state}>
			<StepMark done={stage.state === 'done'} stopped={stopped} />
			{stopped ? `Stopped at ${stage.label}` : stage.label}
		</li>
	);
}

/** What a failed review kept: the steps it finished, the one it stopped at, then the ones it never reached. */
function KeptSteps({ stages }: { stages: RunStage[] }) {
	const stopped = stages.findIndex((stage) => stage.state !== 'done');

	return (
		<ol className="contents" aria-label="Steps">
			{stages.map((stage, index) => (
				<Step key={stage.id} stage={stage} stopped={index === stopped} />
			))}
		</ol>
	);
}

/** Starts a review, or one more: the page's one primary action until a review has run. `r` presses it. */
function ReviewButton({ run, again }: { run: RunView; again: boolean }) {
	const action = useAction();

	/** Starts the review; a refusal shows as a toast and the button offers to try again. */
	function start(): void {
		runControl(action, () => run.start(), 'The review did not start.');
	}

	useKeys({ r: start });

	return (
		<Button
			variant={again ? 'outline' : 'primary'}
			status={run.starting ? 'pending' : action.status}
			onClick={start}
			data-run-primary=""
		>
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
			<Link href={settingsHref('models')}>Open settings</Link>
		</Button>
	);
}

/** What a finished review found, as one sentence. */
function foundText(bugs: number | null): string {
	return bugs ? `Recoder found ${plural(bugs, 'bug')}.` : 'Recoder found no bugs.';
}

/**
 * Where the newest review stands, in a banner above the tab's content: not
 * reviewed, queued, running, paused, failed, cancelled, out of date, or done.
 * Each state offers its one next step at the right. A failure says why, when,
 * and which steps it kept. Every state is the same `Banner`, so the glyph
 * morphs in place when the review moves on.
 */
export function RunBanner({ run, repoId, number, bugs }: RunBannerProps) {
	const { base } = useApi();
	const bugsHref = pullHref(base, repoId, number, 'bugs');
	const resuming = useAction();
	const retrying = useAction();

	if (run.phase === 'queued' || run.phase === 'running') {
		const queued = run.phase === 'queued';

		return (
			<Banner
				glyph={<StatusGlyph kind="spinner" />}
				title={queued ? 'Queued' : 'Reviewing'}
				meta={queued ? run.waiting : stageText(run.stages)}
				actions={
					<>
						{run.connection === 'reconnecting' ? <span className="meta">Reconnecting…</span> : null}
						{run.startedAt && !queued ? <Clock since={run.startedAt} /> : null}
						<Button asChild variant="ghost">
							<Link href={bugsHref} replace scroll={false}>
								See progress
							</Link>
						</Button>
						<CancelReviewButton variant="ghost" />
					</>
				}
			/>
		);
	}

	if (run.phase === 'paused') {
		return (
			<Banner
				glyph={<StatusGlyph kind="idle" />}
				title="The review is paused."
				meta={stageText(run.stages)}
				actions={
					<>
						<CancelReviewButton variant="ghost" />
						<Button
							variant="primary"
							status={resuming.status}
							onClick={() => runControl(resuming, run.resume, 'The review did not resume.')}
						>
							Resume
						</Button>
					</>
				}
			/>
		);
	}

	if (run.phase === 'failed') {
		return (
			<Banner
				tone="danger"
				glyph={<StatusGlyph kind="failed" />}
				title="The review failed."
				meta={<RunFacts at={run.finishedAt} model={run.modelLabel} />}
				detail={run.failure?.message}
				footer={run.stages.length > 0 ? <KeptSteps stages={run.stages} /> : null}
				actions={
					<>
						<FailureLink action={run.failure?.action ?? null} />
						<Button
							status={retrying.status}
							onClick={() => runControl(retrying, run.retry, 'The review did not start again.')}
						>
							<RotateCcw aria-hidden />
							Try again
						</Button>
					</>
				}
			/>
		);
	}

	if (run.phase === 'passed' && !run.outdated) {
		return (
			<Banner
				glyph={<StatusGlyph kind={bugs ? 'high' : 'ok'} />}
				title={foundText(bugs)}
				meta={
					<>
						Reviewed <Age at={run.finishedAt} form="long" />
					</>
				}
				actions={
					<>
						{bugs ? (
							<Button asChild variant="primary">
								<Link href={bugsHref} replace scroll={false}>
									{bugs === 1 ? 'See the bug' : 'See the bugs'}
								</Link>
							</Button>
						) : null}
						<ReviewButton run={run} again />
					</>
				}
			/>
		);
	}

	if (run.phase === 'passed') {
		return (
			<Banner
				glyph={<StatusGlyph kind="outdated" />}
				title="This pull request has commits newer than its review."
				meta={foundText(bugs)}
				actions={
					<>
						<Button asChild variant="ghost">
							<Link href={bugsHref} replace scroll={false}>
								See the last review
							</Link>
						</Button>
						<ReviewButton run={run} again={false} />
					</>
				}
			/>
		);
	}

	const cancelled = run.phase === 'cancelled';

	return (
		<Banner
			glyph={<StatusGlyph kind="idle" />}
			title={cancelled ? 'The review was cancelled.' : 'Recoder has not reviewed this pull request.'}
			meta={<RunFacts at={cancelled ? run.finishedAt : null} model={run.modelLabel} />}
			actions={<ReviewButton run={run} again={false} />}
		/>
	);
}
