import type { UpdateCommit, UpdateState, UpdateStatus } from '@recoder/shared';

import type { UpdatePhase } from './update-store';

/** What the strip reads to decide what to say. */
export interface UpdateSnapshot {
	status: UpdateStatus;
	phase: UpdatePhase;
	unreachableSince: number | null;
	/** Why the last check or start was refused. */
	error: string | null;
}

/** What a failed line's Retry does. */
export type UpdateRetry = 'load' | 'check' | 'update' | 'follow';

type StepStage = 'done' | 'current' | 'next';

export interface UpdateStep {
	label: string;
	stage: StepStage;
}

/** What the strip says about the updater, as plain data for its components. */
export type UpdateLine =
	| { kind: 'current' }
	| { kind: 'checking' }
	| {
			kind: 'available';
			headline: string;
			touches: string | null;
			commits: UpdateCommit[];
			blockedReason: string | null;
	  }
	| { kind: 'managed'; note: string }
	| { kind: 'progress'; steps: UpdateStep[] }
	| { kind: 'updated'; note: string | null; canReload: boolean }
	| { kind: 'failed'; error: string; retry: UpdateRetry };

/** The states a server update passes through, in order. A web-only update has the one. */
const SERVER_STEPS: readonly { state: UpdateState; label: string }[] = [
	{ state: 'pausing', label: 'Pausing reviews' },
	{ state: 'updating', label: 'Updating' },
	{ state: 'restarting', label: 'Restarting' },
	{ state: 'resuming', label: 'Resuming' }
];

const WEB_STEPS = SERVER_STEPS.filter((step) => step.state === 'updating');

/** A person's read of the updater's status: the one line the strip shows. */
export function describeUpdate({ status, phase, unreachableSince, error }: UpdateSnapshot): UpdateLine {
	if (phase === 'applying') return progressLine(status, unreachableSince !== null);

	if (phase === 'lost') return { kind: 'failed', error: 'Lost contact with the server.', retry: 'follow' };

	if (phase === 'updated') return updatedLine(status);

	if (error) return { kind: 'failed', error, retry: status.available ? 'update' : 'check' };

	if (status.state === 'failed') {
		return { kind: 'failed', error: status.error ?? 'The update failed.', retry: 'update' };
	}

	if (status.mode === 'managed')
		return { kind: 'managed', note: status.managedNote ?? 'This install updates by redeploying.' };

	if (phase === 'checking') return { kind: 'checking' };

	return status.available ? availableLine(status, status.available) : { kind: 'current' };
}

/** Whether applying this update restarts the server. Without an answer, it is assumed to. */
export function restartsServer(available: UpdateStatus['available']): boolean {
	return available?.changes.server ?? true;
}

function availableLine(status: UpdateStatus, available: NonNullable<UpdateStatus['available']>): UpdateLine {
	return {
		kind: 'available',
		headline: available.version ? `Version ${available.version} available` : 'Update available',
		touches: touchesLine(available.changes),
		commits: available.commits,
		blockedReason: status.blockedReason ?? null
	};
}

function touchesLine(changes: { server: boolean; web: boolean }): string | null {
	if (changes.server) return 'Restarts the server; running reviews pause and resume';

	return changes.web ? 'Web only; reviews keep running' : null;
}

function progressLine(status: UpdateStatus, serverIsAway: boolean): UpdateLine {
	const steps = restartsServer(status.available) ? SERVER_STEPS : WEB_STEPS;
	const state = serverIsAway ? 'restarting' : status.state;
	const at = steps.findIndex((step) => step.state === state);
	const current = at === -1 ? 0 : at;

	return {
		kind: 'progress',
		steps: steps.map((step, index) => ({
			label: step.label,
			stage: stageOf(index, current)
		}))
	};
}

function stageOf(index: number, current: number): StepStage {
	if (index < current) return 'done';

	return index === current ? 'current' : 'next';
}

function updatedLine(status: UpdateStatus): UpdateLine {
	if (status.webRestart === 'restart-required') {
		return { kind: 'updated', note: 'Restart the web app to finish.', canReload: false };
	}

	return { kind: 'updated', note: null, canReload: status.webRestart === 'hot-reload' };
}
