import type { UpdateCommit, UpdateState, UpdateStatus, UpdateStep as ServerStep, UpdateStepId } from '@recoder/shared';

import { dayDate } from '../shell/age';

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

type StepStage = 'done' | 'current' | 'next' | 'failed';

export interface UpdateStep {
	label: string;
	stage: StepStage;
	/** What the step involves: `about 1.2 GB`, `2 running, they resume after`. */
	detail?: string;
}

/** What the strip says about the updater, as plain data for its components. */
export type UpdateLine =
	| { kind: 'current' }
	| { kind: 'checking' }
	| {
			kind: 'available';
			version: string | null;
			headline: string;
			/** `You run 0.3.0 · released Nov 19`. */
			since: string;
			touches: string | null;
			/** The release notes, in Markdown; null when the updater has none (a git install lists commits). */
			notes: string | null;
			commits: UpdateCommit[];
			/** What the update will do, step by step; empty when the updater does not say. */
			plan: UpdateStep[];
			blockedReason: string | null;
	  }
	| { kind: 'managed'; note: string }
	| { kind: 'progress'; steps: UpdateStep[] }
	| { kind: 'updated'; note: string | null; canReload: boolean }
	| { kind: 'failed'; error: string; retry: UpdateRetry }
	| { kind: 'rolled-back'; error: string; steps: UpdateStep[] };

/** What each step the updater reports is called while it runs. */
const STEP_LABELS: Record<UpdateStepId, string> = {
	pause: 'Pause reviews',
	backup: 'Back up',
	download: 'Download',
	start: 'Start the new version',
	health: 'Check its health'
};

/** Where each of the updater's step states puts the step in the card's list. */
const STEP_STAGES: Record<Exclude<ServerStep['state'], 'skipped'>, StepStage> = {
	pending: 'next',
	running: 'current',
	done: 'done',
	failed: 'failed'
};

/** The updater's own steps as the card lists them, leaving out the ones this update skips. */
function serverSteps(status: UpdateStatus): UpdateStep[] {
	return (status.steps ?? []).flatMap((step) =>
		step.state === 'skipped'
			? []
			: [{ label: STEP_LABELS[step.id], detail: step.detail, stage: STEP_STAGES[step.state] }]
	);
}

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

	if (status.state === 'rolled-back') {
		return {
			kind: 'rolled-back',
			error: status.error ?? 'The new version failed, so Recoder went back.',
			steps: serverSteps(status)
		};
	}

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
	const running = status.current.version ?? status.current.branch ?? null;
	const released = dayDate(available.releasedAt);

	return {
		kind: 'available',
		version: available.version ?? null,
		headline: available.version ? `Recoder ${available.version} is ready` : 'An update is ready',
		since: [running ? `You run ${running}` : null, released ? `released ${released}` : null]
			.filter(Boolean)
			.join(' · '),
		touches: touchesLine(available.changes),
		notes: available.notes?.trim() || null,
		commits: available.commits,
		plan: serverSteps(status),
		blockedReason: status.blockedReason ?? null
	};
}

function touchesLine(changes: { server: boolean; web: boolean }): string | null {
	if (changes.server) return 'Restarts the server; running reviews pause and resume';

	return changes.web ? 'Web only; reviews keep running' : null;
}

function progressLine(status: UpdateStatus, serverIsAway: boolean): UpdateLine {
	if (status.steps?.length) return { kind: 'progress', steps: serverSteps(status) };

	const steps = restartsServer(status.available) ? SERVER_STEPS : WEB_STEPS;
	const state = serverIsAway ? 'restarting' : status.state;
	const at = steps.findIndex((step) => step.state === state);
	const current = at === -1 ? 0 : at;

	const switching = status.available?.branch;

	return {
		kind: 'progress',
		steps: steps.map((step, index) => ({
			label: switching && step.state === 'updating' ? `Switching to ${switching}` : step.label,
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
