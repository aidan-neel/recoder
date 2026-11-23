'use client';

import { Button, cn, Icon, StatusGlyph, StatusNotice } from '@recoder/ui';
import type { ComponentProps } from 'react';

import type { RunStage, RunView } from '@/lib/run/types';
import { plural } from '@/lib/shell/format';
import { openSettings } from '@/lib/settings/open-settings';

import { Age } from '@/components/common/age';

interface RunBannerProps {
	run: RunView;
	/** Open findings of the last finished review; null before one. */
	bugs: number | null;
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
	if (done) return <Icon name="check" className="text-ok" />;
	if (stopped) return <Icon name="close" className="text-danger" />;

	return (
		<span className="grid size-3 place-items-center" aria-hidden>
			<Icon name="circle" className="size-2 text-fg-ghost" />
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

/** The way out a failed review offers when the server named one; reviewing again is the header's Review button. */
function FailureLink({ action }: { action: NonNullable<RunView['failure']>['action'] }) {
	if (!action) return null;

	return (
		<Button variant="outline" onClick={() => openSettings('models')}>
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
 * reviewed. Starting the next review is the header's Review button, so the
 * banner only says where things stand; a failure says why, when, and which
 * steps it kept, with the way out the server offered. Every state is the same
 * `Banner`, so the glyph morphs in place when the review moves on. A queued,
 * running, paused or done review has no banner.
 */
export function RunBanner({ run, bugs }: RunBannerProps) {
	if (run.phase === 'failed') {
		return (
			<Banner
				tone="danger"
				glyph={<StatusGlyph kind="failed" />}
				title="The review failed."
				meta={<RunFacts at={run.finishedAt} model={run.modelLabel} />}
				detail={run.failure?.message}
				footer={run.stages.length > 0 ? <KeptSteps stages={run.stages} /> : null}
				actions={<FailureLink action={run.failure?.action ?? null} />}
			/>
		);
	}

	if (run.phase === 'passed' && run.outdated) {
		return (
			<Banner
				glyph={<StatusGlyph kind="outdated" />}
				title="This pull request has commits newer than its review."
				meta={foundText(bugs)}
			/>
		);
	}

	if (run.phase !== 'none' && run.phase !== 'cancelled') return null;

	const cancelled = run.phase === 'cancelled';

	return (
		<Banner
			glyph={<StatusGlyph kind={cancelled ? 'cancelled' : 'idle'} />}
			title={cancelled ? 'The review was cancelled.' : 'Recoder has not reviewed this pull request.'}
			meta={<RunFacts at={cancelled ? run.finishedAt : null} model={run.modelLabel} />}
		/>
	);
}
