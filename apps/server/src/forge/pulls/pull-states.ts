import type { PullState } from '@recoder/shared';
import { collection } from '../../storage/backend';

/**
 * The pull request's state on the forge when Recoder last saw it, one record
 * per pull request (a pull request has many reviews). Written when the server
 * learns the state from work it already does — page and list reads, merges,
 * webhooks and the sweep — never by a forge call of its own.
 */
export interface PullStateRecord {
	/** {@link pullStateKey} of the pull request. */
	id: string;
	repoId: string;
	number: number;
	state: PullState;
	/** When the forge last told us the state. */
	checkedAt: string;
}

/** One pull request, keyed `repoId#number` as `latestReviews` keys reviews. */
export function pullStateKey(repoId: string, n: number): string {
	return `${repoId}#${n}`;
}

export const pullStates = collection<PullStateRecord>('pull_states');

/** The last learned state per pull request, keyed by {@link pullStateKey}. */
export async function pullStateMap(): Promise<Map<string, PullState>> {
	return new Map((await pullStates.list()).map((record) => [record.id, record.state]));
}

/**
 * Record the state the server just learned. `merged` is final: a stale read
 * landing after it must not unsettle the pull request. A storage failure is
 * logged, never thrown — the record is bookkeeping for the list, not worth
 * failing the read that learned the state.
 */
export async function recordPullState(repoId: string, n: number, state: PullState): Promise<void> {
	const id = pullStateKey(repoId, n);

	try {
		await pullStates.update(id, (current) =>
			current?.state === 'merged' && state !== 'merged'
				? current
				: { id, repoId, number: n, state, checkedAt: new Date().toISOString() }
		);
	} catch (error) {
		console.error(`[pulls] could not record the state of pull request ${n} for repo ${repoId}`, error);
	}
}
