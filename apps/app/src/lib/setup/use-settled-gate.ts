'use client';

import { useState } from 'react';

import { useSetupGate, type SetupGate } from './setup-gate';

/** What the gate decided: first run, or the pull request list. */
export type SettledGate = Exclude<SetupGate, 'checking'>;

/**
 * The gate's last answer, kept while it checks again. The page on screen
 * then stays put: first run while the window regains focus, and the list's
 * own notice while the server comes back. Null before the first answer, when
 * nothing should paint.
 */
export function useSettledGate(): SettledGate | null {
	const gate = useSetupGate();
	const [settled, setSettled] = useState<SettledGate | null>(null);

	if (gate !== 'checking' && gate !== settled) setSettled(gate);

	return gate === 'checking' ? settled : gate;
}
