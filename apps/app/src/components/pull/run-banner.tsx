'use client';

import { REVIEW_SPEED_PLANS, type ReviewSpeed } from '@recoder/shared';
import { Button, cn, DropdownMenuItem, Keycap, SplitButton, StatusGlyph, StatusNotice } from '@recoder/ui';
import { Check, Circle, RotateCcw, X, Zap } from 'lucide-react';
import type { ComponentProps } from 'react';

import type { RunStage, RunView } from '@/lib/run/types';
import { plural } from '@/lib/shell/format';
import { errorToast } from '@/lib/shell/notify';
import { useChrome } from '@/lib/shell/chrome';
import { useAction } from '@/lib/shell/use-action';
import { useKeys } from '@/lib/shell/use-keys';

import { Age } from '@/components/common/age';

interface RunBannerProps {
	run: RunView;
	/** Open findings of the last finished review; null before one. */
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

/** The review the split button's menu offers beside the standard one. */
const SPARK = REVIEW_SPEED_PLANS.spark;

interface ReviewButtonProps {
	run: RunView;
	again: boolean;
	/** Binds `r`. Only the header's button does, so one press starts one review. */
	shortcut?: boolean;
	variant?: 'primary' | 'outline';
}

/**
 * Starts a review, or one more, as a split button: a click (or `r`) starts the
 * standard review, and its menu offers Spark, the fast one. A first review
 * shows its `r` keycap; the header's button binds the key.
 */
export function ReviewButton({ run, again, shortcut = false, variant }: ReviewButtonProps) {
	const action = useAction();

	/** Starts the review; a refusal shows as a toast and the button offers to try again. */
	function start(speed: ReviewSpeed): void {
		runControl(action, () => run.start(speed), 'The review did not start.');
	}

	useKeys(shortcut ? { r: () => start('standard') } : {});

	return (
		<SplitButton
			variant={variant ?? (again ? 'outline' : 'primary')}
			status={run.starting ? 'pending' : action.status}
			onClick={() => start('standard')}
			data-run-primary=""
			menuLabel="Other ways to review"
			menuClassName="w-[300px]"
			menu={
				<DropdownMenuItem icon={<Zap />} className="split-option" onSelect={() => start('spark')}>
					<span className="flex flex-col gap-0.5 whitespace-normal">
						{SPARK.label} review
						<span className="split-option-detail">{SPARK.description}</span>
					</span>
				</DropdownMenuItem>
			}
		>
			{again ? 'Review again' : 'Review'}
			{again ? null : <Keycap k="r" />}
		</SplitButton>
	);
}

/** The way out a failed review offers beside trying again. */
function FailureLink({ action }: { action: NonNullable<RunView['failure']>['action'] }) {
	if (!action) return null;

	return (
		<Button variant="outline" onClick={() => useChrome.getState().openSettings('models')}>
			Open settings
		</Button>
	);
}

/** What a finished review found, as one sentence. */
function foundText(bugs: number | null): string {
	return bugs ? `Recoder found ${plural(bugs, 'bug')}.` : 'Recoder found no bugs.';
}

/**
 * Where the newest review stands on the Review tab when its steps do not show
 * it and it is not simply done: failed, out of date, cancelled, or not
 * reviewed. Each state offers its one next step at the right. A failure says
 * why, when, and which steps it kept. Every state is the same `Banner`, so
 * the glyph morphs in place when the review moves on. A queued, running,
 * paused or done review has no banner.
 */
export function RunBanner({ run, bugs }: RunBannerProps) {
	const retrying = useAction();

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

	if (run.phase === 'passed' && run.outdated) {
		return (
			<Banner
				glyph={<StatusGlyph kind="outdated" />}
				title="This pull request has commits newer than its review."
				meta={foundText(bugs)}
				actions={<ReviewButton run={run} again={false} />}
			/>
		);
	}

	if (run.phase !== 'none' && run.phase !== 'cancelled') return null;

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
