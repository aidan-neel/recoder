import type { Finding } from '@recoder/shared';
import { consolidateFindings } from '../consolidate-merge.js';
import { orchestratorSays, publishCandidates, type ReviewRun } from './context.js';

export interface Consolidated {
	confirmed: Finding[];
	/** The reviewers' recommended checks. */
	checks: string[];
}

/** Without this the review ends in silence and reads as if nothing ran. */
function announceNothingFound(run: ReviewRun): void {
	orchestratorSays(run.events, 'message_nothing_found', 'I finished without finding anything worth flagging.');
}

/** The verified candidates, merged by place without a model, so the same candidates always give the same findings. */
export function confirmedFindings(run: ReviewRun): Finding[] {
	return consolidateFindings(run.candidates);
}

/**
 * The consolidation stage: verified candidates merge deterministically into
 * findings. Unverified ones were hidden by the verify stage and never show.
 */
export function consolidate(run: ReviewRun): Consolidated {
	const { task } = run;

	run.events?.onStage?.('consolidation');
	publishCandidates(run);

	const checks = [...run.recommended];
	const confirmed = confirmedFindings(run);

	task(
		'consolidation',
		'Consolidating findings',
		'done',
		confirmed.length
			? `Confirmed ${confirmed.length} finding${confirmed.length === 1 ? '' : 's'}`
			: 'No verified findings',
		{ kind: 'consolidation' }
	);

	if (!confirmed.length) announceNothingFound(run);

	return { confirmed, checks };
}
