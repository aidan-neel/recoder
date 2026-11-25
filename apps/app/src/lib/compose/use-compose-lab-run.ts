'use client';

import { useEffect, useRef, useState } from 'react';

type Phase = 'idle' | 'pending' | 'success';

export function useComposeLabRun() {
	const [phase, setPhase] = useState<Phase>('idle');
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	useEffect(() => () => clearTimeout(timer.current), []);

	function reset() {
		clearTimeout(timer.current);
		timer.current = undefined;
		setPhase('idle');
	}

	function simulate() {
		if (timer.current !== undefined || phase === 'success') return;

		setPhase('pending');

		timer.current = setTimeout(() => {
			timer.current = undefined;
			setPhase('success');
		}, 650);
	}

	return { phase, reset, simulate };
}

export type ComposeLabRun = ReturnType<typeof useComposeLabRun>;
