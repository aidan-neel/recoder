'use client';

import { reviewStage } from '@recoder/shared';
import { Meter, StatusGlyph, SwapText } from '@recoder/ui';

import { livePhase, progressShare } from '@/lib/live/live-progress';
import { stageRows, stageStep } from '@/lib/live/stages';
import { useReview } from '@/lib/review/review-store';

import { usePhase, useShownReview } from './review-view';

/**
 * A slim strip over the reading pane while a review that already has
 * decisions keeps running: the stage, a meter and the step, so the
 * reader knows more may come. A paused review leads with "Paused" and still
 * names the stage it holds at. The meter and the step read the same as the
 * live view's.
 */
export function LiveStrip() {
	const review = useShownReview();
	const progress = useReview((state) => state.progress);
	const phase = usePhase();
	const live = livePhase(review.status, progress);
	const step = progress && live ? stageStep(stageRows(progress, live, review.status)) : null;
	const stage = progress ? reviewStage({ ...progress, paused: false }, review.status).label : null;
	const lead = phase === 'paused' ? 'Paused' : 'Still running';
	const label = phase === 'queued' ? 'Waiting for a free slot' : stage;

	return (
		<div data-ui="live-strip" data-phase={phase} className="live-strip" role="status">
			<StatusGlyph kind={phase === 'paused' ? 'idle' : 'spinner'} />
			<span className="live-strip-label">
				<SwapText textClassName={phase === 'running' ? 'shimmer-text' : undefined}>{lead}</SwapText>
				{label ? (
					<>
						<span className="live-strip-sep" aria-hidden>
							·
						</span>
						<SwapText textClassName="live-strip-stage">{label}</SwapText>
					</>
				) : null}
			</span>
			<Meter
				value={progressShare(progress, phase)}
				tone={phase === 'paused' ? 'medium' : 'neutral'}
				aria-label="Review progress"
				className="live-strip-meter"
			/>
			{step ? (
				<span className="live-strip-count tabular">
					Step {step.step} of {step.total}
				</span>
			) : null}
		</div>
	);
}
