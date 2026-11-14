import type { UpdateState, UpdateStatus } from '@recoder/shared';

import type { UpdateApi } from '../api/update';

const SAMPLE_UPDATE: NonNullable<UpdateStatus['available']> = {
	commits: [
		{ sha: '4be1d02', subject: 'Show model cost per review' },
		{ sha: '9a7c3f5', subject: 'Keep the diff scroll position when a review finishes' },
		{ sha: 'c20e8b1', subject: 'Fix the repository search on narrow pages' }
	],
	changes: { server: true, web: true, install: false }
};

/** The states a sample update walks through, one per status read. */
const SAMPLE_STEPS: readonly UpdateState[] = ['pausing', 'updating', 'restarting', 'resuming'];

/** An updater that answers from memory: one update is waiting, and applying it steps through the states on each read. */
export function createSampleUpdate(): UpdateApi {
	let available: UpdateStatus['available'] = SAMPLE_UPDATE;
	let step = -1;

	function status(): UpdateStatus {
		const state = SAMPLE_STEPS[step] ?? 'idle';

		return { mode: 'git', current: { version: '0.2.1', commit: '1f3a9d6e', branch: 'main' }, available, state };
	}

	return {
		status: async () => {
			if (step >= 0) step += 1;

			if (step >= SAMPLE_STEPS.length) {
				step = -1;
				available = null;
			}

			return status();
		},
		check: async () => status(),
		apply: async () => {
			step = 0;

			return status();
		}
	};
}
