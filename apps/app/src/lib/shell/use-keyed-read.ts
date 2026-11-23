'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * A page's read of one thing, named by `key`: once per visit and again on `retry`. `read` answers the state to show,
 * or null to keep what already shows (a failed read over a copy on screen), and never rejects. Before it answers, and
 * when its answer was for another key, `answer` is null, so the page shows the copy it kept.
 */
export function useKeyedRead<State>(
	key: string,
	read: () => Promise<State | null>
): { answer: State | null; retry: () => void } {
	const latest = useRef(read);
	const [answer, setAnswer] = useState<{ key: string; state: State } | null>(null);
	const [attempt, setAttempt] = useState(0);

	useLayoutEffect(() => {
		latest.current = read;
	});

	const retry = useCallback(() => {
		setAnswer(null);
		setAttempt((count) => count + 1);
	}, []);

	useEffect(() => {
		let current = true;

		void latest.current().then((state) => {
			if (current && state) setAnswer({ key, state });
		});

		return () => {
			current = false;
		};
	}, [key, attempt]);

	return { answer: answer?.key === key ? answer.state : null, retry };
}
