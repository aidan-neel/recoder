'use client';

import { Button, Meter, Spinner } from '@recoder/ui';
import { Check } from 'lucide-react';

import type { RunStage, RunView } from '@/lib/run/types';
import { runClock } from '@/lib/shell/age';
import { errorToast } from '@/lib/shell/notify';
import { useAction } from '@/lib/shell/use-action';
import { useNow } from '@/lib/shell/use-now';

/** The first seven characters of a commit, as every forge shortens it. */
function shortSha(sha: string): string {
	return sha.slice(0, 7);
}

/** The time the review has run, ticking each second. */
function Clock({ since }: { since: string }) {
	const now = useNow(1000);

	return <span className="mono tabular text-fg-secondary">{runClock(now - Date.parse(since))}</span>;
}

/** The mark before a step: a check once done, a dot while active, a ring while it waits. */
function StageMark({ state }: Pick<RunStage, 'state'>) {
	return (
		<span className="run-stage-mark" data-state={state} aria-hidden>
			{state === 'done' ? <Check /> : null}
		</span>
	);
}

interface StageRowProps {
	stage: RunStage;
	/** What the review does right now, shown under the active step. */
	activity: string | null;
}

/** One step: its mark, its name and its count; the active one shows how far it is and what it does now. */
function StageRow({ stage, activity }: StageRowProps) {
	const active = stage.state === 'active';

	return (
		<li className="run-stage" data-state={stage.state} aria-current={active ? 'step' : undefined}>
			<StageMark state={stage.state} />
			<span>{stage.label}</span>
			{stage.detail ? <span className="run-stage-detail">{stage.detail}</span> : null}
			{active && (stage.share !== null || activity) ? (
				<div className="run-stage-more">
					{stage.share !== null ? (
						<Meter value={stage.share} max={1} aria-label={`${stage.label}: ${stage.detail ?? ''}`} />
					) : null}
					{activity ? <span className="run-activity">{activity}</span> : null}
				</div>
			) : null}
		</li>
	);
}

/**
 * A review in progress: the commit it reads, how long it has run, and its
 * four steps, the active one with its count and what it does right now. A
 * queued review says why it waits.
 */
export function RunCard({ run }: { run: RunView }) {
	const stopping = useAction();
	const pausing = useAction();
	const queued = run.phase === 'queued';

	/** Runs a control of the review; a refusal shows as a toast. */
	function control(action: ReturnType<typeof useAction>, call: () => Promise<void>): void {
		action.run(() =>
			call().catch((error: unknown) => {
				errorToast(error instanceof Error ? error.message : 'That did not go through.');
				throw error;
			})
		);
	}

	return (
		<section className="run-card" aria-label="Review in progress">
			<header className="run-card-head">
				<Spinner size={14} />
				{queued ? 'Queued' : 'Reviewing'}
				{run.headSha ? <span className="meta mono">{shortSha(run.headSha)}</span> : null}
				{queued && run.waiting ? <span className="meta">{run.waiting}</span> : null}
				<div className="run-card-end">
					{run.connection === 'reconnecting' ? <span className="meta">Reconnecting…</span> : null}
					{run.startedAt && !queued ? <Clock since={run.startedAt} /> : null}
					{!queued ? (
						<Button variant="ghost" status={pausing.status} onClick={() => control(pausing, run.pause)}>
							Pause
						</Button>
					) : null}
					<Button variant="ghost" status={stopping.status} onClick={() => control(stopping, run.cancel)}>
						Cancel
					</Button>
				</div>
			</header>
			<ol className="run-stages">
				{run.stages.map((stage) => (
					<StageRow key={stage.id} stage={stage} activity={stage.state === 'active' ? run.activity : null} />
				))}
			</ol>
		</section>
	);
}
