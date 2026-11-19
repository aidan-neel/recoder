'use client';

import type { SetupChecklist } from '@recoder/shared';

import { useChecklist } from './checklist-store';
import { useFinish } from './use-finish';

/** Everything the signed-in checklist shows. */
export interface FirstRunView {
	/** Null until it loads. */
	checklist: SetupChecklist | null;
	/** True while the checklist fades out and the pull request list takes its place. */
	leaving: boolean;
}

/** The signed-in checklist: once the server says setup is complete, a beat later the pull request list takes the page. */
export function useFirstRun(): FirstRunView {
	const checklist = useChecklist((state) => state.checklist);
	const leaving = useFinish(checklist?.complete ?? false);

	return { checklist, leaving };
}
