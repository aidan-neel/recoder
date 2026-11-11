import type { HarnessEvents } from '../../review/pipeline/harness/types.js';
import type { ProgressSink } from '../progress.js';

/** Passes the harness's progress to the command line's sink; the rest of the harness's callbacks are for the web app. */
export function harnessEvents(progress: ProgressSink): HarnessEvents {
	return {
		onStage: (stage) => progress({ type: 'stage', stage }),
		onLog: (message) => progress({ type: 'log', message }),
		onAssignment: (assignment) => progress({ type: 'assignment', assignment }),
		onBudget: (budget) => progress({ type: 'budget', budget }),
		onCandidates: (count) => progress({ type: 'candidates', count })
	};
}
