'use client';

import { DURATION } from '@recoder/ui';
import { useEffect, useState } from 'react';

import { useQueue } from '@/lib/queue/queue-store';
import { holdSetup } from '@/lib/setup/setup-gate';

/** How long the finished checklist stays, so the last check mark and "Nothing left" are seen. */
const BEAT_MS = 900;

/** The longest the checklist waits for the queue to load behind it before letting it through anyway. */
const QUEUE_WAIT_MS = 4000;

/** How long the checklist takes to fade before the queue takes its place. */
const FADE_MS = DURATION.swap * 1000;

/** Starts a timer each time `on` turns true, and reports true once it has run out while `on` stays true. */
function useElapsed(on: boolean, ms: number): boolean {
	const [elapsed, setElapsed] = useState(false);
	const [wasOn, setWasOn] = useState(on);

	if (on !== wasOn) {
		setWasOn(on);
		setElapsed(false);
	}

	useEffect(() => {
		if (!on) return;

		const timer = setTimeout(() => setElapsed(true), ms);

		return () => clearTimeout(timer);
	}, [on, ms]);

	return on && elapsed;
}

/**
 * First run's ending. It holds the gate while the checklist shows. Once every
 * step is done and no dialog is open, it waits a beat, loads the queue
 * behind the checklist so the queue paints whole, then fades the checklist
 * and lets the gate go. Returns true while the checklist fades.
 */
export function useFinish(complete: boolean): boolean {
	const queueLoaded = useQueue((state) => !state.sample && state.status !== 'loading');
	const beat = useElapsed(complete, BEAT_MS);
	const waited = useElapsed(complete, QUEUE_WAIT_MS);
	const leaving = complete && beat && (queueLoaded || waited);

	useEffect(() => {
		holdSetup(true);

		return () => holdSetup(false);
	}, []);

	useEffect(() => {
		if (complete) return useQueue.getState().load(false);
	}, [complete]);

	useEffect(() => {
		if (!leaving) return;

		const timer = setTimeout(() => holdSetup(false), FADE_MS);

		return () => clearTimeout(timer);
	}, [leaving]);

	return leaving;
}
