'use client';

import { useEffect, useState } from 'react';

import { readStored, writeStored } from '../shell/browser-storage';
import { useSetupGate, type SetupGate } from './setup-gate';

/** What the gate decided: first run, or the pull request list. */
export type SettledGate = Exclude<SetupGate, 'checking'>;

/** Where this browser keeps the gate's last answer, so a set-up server's list paints at once on the next load. */
const GATE_KEY = 'recoder-setup-gate';

/**
 * The answer to start from: `done` when this browser last saw the list, else
 * nothing. First run is never assumed, so it cannot flash in front of a list.
 */
function rememberedGate(): SettledGate | null {
	return readStored(GATE_KEY) === 'done' ? 'done' : null;
}

/**
 * The gate's last answer, kept while it checks again. The page on screen
 * then stays put: first run while the window regains focus, and the list's
 * own notice while the server comes back. A browser that has seen the list
 * starts on it, so a load paints the list's skeleton and not an empty page.
 * Null before the first answer anywhere else, when nothing should paint.
 */
export function useSettledGate(): SettledGate | null {
	const gate = useSetupGate();
	const [settled, setSettled] = useState<SettledGate | null>(rememberedGate);

	if (gate !== 'checking' && gate !== settled) setSettled(gate);

	useEffect(() => {
		if (gate !== 'checking') writeStored(GATE_KEY, gate);
	}, [gate]);

	return gate === 'checking' ? settled : gate;
}
