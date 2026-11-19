import type { SetupChecklist, SetupStep, SetupStepId } from '@recoder/shared';

import type { useSettings } from '../settings/settings-store';
import type { ChecklistStatus } from './checklist-store';
import type { SetupGate } from './setup-gate';

/** Where the settings load stands (`offline`: the server did not answer). */
type SettingsStatus = ReturnType<typeof useSettings.getState>['status'];

/** The checklist's steps, in order. */
export const STEP_ORDER: readonly SetupStepId[] = [
	'claim',
	'address',
	'admin',
	'provider',
	'model',
	'storage',
	'check'
];

/** Who can work on each step: `out` before the admin account exists, `in` once it is signed in, `any` either way. */
const STEP_WHO: Record<SetupStepId, 'out' | 'in' | 'any'> = {
	claim: 'out',
	address: 'any',
	admin: 'out',
	provider: 'in',
	model: 'in',
	storage: 'in',
	check: 'in'
};

/** One step as the server reported it; a step the server left out counts as not done. */
export function stepOf(checklist: SetupChecklist, id: SetupStepId): SetupStep {
	return checklist.steps.find((step) => step.id === id) ?? { id, done: false };
}

/** The first step not done yet, which the page leads with; null once all are. */
export function currentStep(checklist: SetupChecklist): SetupStepId | null {
	return STEP_ORDER.find((id) => !stepOf(checklist, id).done) ?? null;
}

/** How many steps are left, 0 to 7. */
export function stepsLeft(checklist: SetupChecklist): number {
	return STEP_ORDER.filter((id) => !stepOf(checklist, id).done).length;
}

/** Whether a step can be worked on: the claim and admin before an account exists, the server's own steps after. */
export function stepOpen(id: SetupStepId, signedIn: boolean): boolean {
	const who = STEP_WHO[id];

	return who === 'any' || (who === 'in') === signedIn;
}

interface GateInput {
	checklist: ChecklistStatus;
	settings: SettingsStatus;
	/** Null until the checklist has loaded. */
	steps: SetupChecklist | null;
	/** True while the checklist is on screen; it lets go a beat after setup is finished. */
	holding: boolean;
	/** True while the checklist and settings load again because the server came back after failing them. */
	recovering: boolean;
}

/**
 * The gate. A server that is down, or that cannot say where setup stands, lets the pull request list through so it
 * can show its own notice; once the server answers again, the gate checks until the checklist has reloaded. The
 * checklist waits for the settings too, so its provider and model steps paint with their controls in place.
 */
export function gateOf({ checklist, settings, steps, holding, recovering }: GateInput): SetupGate {
	if (recovering) return 'checking';
	if (checklist === 'offline' || checklist === 'error' || settings === 'offline') return 'done';
	if (!steps) return 'checking';
	if (steps.complete && !holding) return 'done';
	if (settings !== 'ready') return 'checking';

	return 'needed';
}
