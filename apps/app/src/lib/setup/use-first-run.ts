'use client';

import { useState } from 'react';

import { useTokenDialog, type TokenDialog } from '../connections/use-token-dialog';
import { recheckSetup, useSetupSteps } from './setup-gate';
import { stepsLeft, type SetupSteps } from './setup-steps';
import { useFinish } from './use-finish';

/** The dialogs first run opens over the checklist. */
export type SetupDialog = 'provider' | 'browse';

/** The step taking the tint: the first one not done yet. */
export type SetupCurrent = 'provider' | 'model' | 'repo';

/** Everything the first-run checklist shows and does. */
export interface FirstRunView {
	/** The three steps' done state; null until the settings and repositories load. */
	steps: SetupSteps | null;
	/** How many steps are left, 0 to 3 (3 until they load). */
	left: number;
	/** The first step not done yet; null once all are. */
	current: SetupCurrent | null;
	/** The dialog open over the checklist, if any. */
	dialog: SetupDialog | null;
	/** Opens the provider or repo-browser dialog. */
	openDialog: (dialog: SetupDialog) => void;
	/** The dialogs' onOpenChange: closing rechecks the steps. */
	dialogOpenChange: (open: boolean) => void;
	/** The token dialog state; `token.connect` opens it for a forge. */
	token: TokenDialog;
	/** True while the checklist fades out and the queue takes its place. */
	leaving: boolean;
}

/**
 * First run's checklist: a model provider, a review model and a repository.
 * Each step checks off in place as it is done; a beat after the last one,
 * with no dialog open, the queue takes the page (`leaving` fades the
 * checklist). Render nothing while `steps` is null.
 */
export function useFirstRun(): FirstRunView {
	const steps = useSetupSteps();
	const [dialog, setDialog] = useState<SetupDialog | null>(null);
	const token = useTokenDialog();
	const left = steps ? stepsLeft(steps) : 3;
	const leaving = useFinish(left === 0 && dialog === null && !token.open);

	const current: SetupCurrent | null = steps
		? !steps.provider
			? 'provider'
			: !steps.model
				? 'model'
				: !steps.repo
					? 'repo'
					: null
		: null;

	function dialogOpenChange(open: boolean): void {
		if (open) return;

		setDialog(null);
		recheckSetup();
	}

	return {
		steps,
		left,
		current,
		dialog,
		openDialog: setDialog,
		dialogOpenChange,
		token,
		leaving
	};
}
