import type { UpdateHistoryEntry, UpdateState, UpdateStatus } from '@recoder/shared';

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

/** The versions the sample has run. */
const SAMPLE_HISTORY: UpdateHistoryEntry[] = [
	{
		id: 'u3',
		version: '0.2.1',
		installedAt: '2026-11-12T16:20:00Z',
		by: 'aidan',
		durationMs: 134_000,
		outcome: 'running',
		rollback: 'none'
	},
	{
		id: 'u2',
		version: '0.2.0',
		installedAt: '2026-10-30T09:02:00Z',
		by: 'aidan',
		durationMs: 98_000,
		outcome: 'replaced',
		rollback: 'none'
	}
];

/** The branches the sample's remote holds. */
const SAMPLE_BRANCHES = ['main', 'feat/cost-per-review', 'fix/diff-scroll', 'aidan/branch-switch'];

/**
 * An updater that answers from memory: one update is waiting, and applying it
 * (or switching branches) steps through the states on each read.
 */
export function createSampleUpdate(): UpdateApi {
	let available: UpdateStatus['available'] = SAMPLE_UPDATE;
	let branch = 'main';
	let step = -1;

	function status(): UpdateStatus {
		const state = SAMPLE_STEPS[step] ?? 'idle';

		return { mode: 'git', current: { version: '0.2.1', commit: '1f3a9d6e', branch }, available, state };
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
		},
		branches: async () => ({ current: branch, branches: SAMPLE_BRANCHES }),
		switchBranch: async (next) => {
			available = { branch: next, commits: [], changes: { server: true, web: true, install: false } };
			branch = next;
			step = 0;

			return status();
		},
		rollback: async () => status(),
		history: async () => ({ entries: SAMPLE_HISTORY }),
		historyLog: async () => ({ lines: [], before: null }),
		policy: async () => {
			throw new Error('The sample updates from git.');
		},
		setPolicy: async (policy) => policy
	};
}
