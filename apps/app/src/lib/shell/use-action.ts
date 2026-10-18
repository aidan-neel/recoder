'use client';

import type { ButtonStatus } from '@recoder/ui';
import { useEffect, useRef, useState } from 'react';

/** How long a failed action's "Try again" face stays before the button rests again. */
const ERROR_MS = 2400;

/** How long the success face stays, for the actions that show one. */
const SUCCESS_MS = 1600;

interface ActionOptions {
	/** Show the success face for a moment when the action resolves, for actions whose result can look the same as before. */
	showSuccess?: boolean;
}

/**
 * Drives a `Button`'s status through one async action: pending while it
 * runs, back to idle when it resolves (the page's new state is the success,
 * unless `showSuccess` asks for the success face first), "Try again" for a
 * moment when it rejects. A second click while pending is ignored, even one
 * that lands before the pending face renders.
 */
export function useAction({ showSuccess = false }: ActionOptions = {}): {
	status: ButtonStatus;
	run: (action: () => Promise<unknown>) => void;
} {
	const [status, setStatus] = useState<ButtonStatus>('idle');
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const busy = useRef(false);

	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[]
	);

	/** Shows `face` for `ms`, then lets the button rest. */
	function hold(face: 'success' | 'error', ms: number): void {
		setStatus(face);
		timer.current = setTimeout(() => setStatus('idle'), ms);
	}

	function run(action: () => Promise<unknown>): void {
		if (busy.current) return;

		if (timer.current) clearTimeout(timer.current);

		busy.current = true;
		setStatus('pending');

		action()
			.then(
				() => (showSuccess ? hold('success', SUCCESS_MS) : setStatus('idle')),
				() => hold('error', ERROR_MS)
			)
			.finally(() => {
				busy.current = false;
			});
	}

	return { status, run };
}
