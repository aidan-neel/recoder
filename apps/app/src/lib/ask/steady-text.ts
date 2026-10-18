'use client';

import { useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

import { revealEnd } from './reveal';

/** The longest frame gap counted, so a background tab does not dump a paragraph at once. */
const MAX_FRAME_MS = 64;

/**
 * Streamed text fed out at a steady pace instead of in network-sized jumps.
 * Text present when the message mounts shows at once; what arrives later
 * reveals smoothly and keeps draining after the stream ends. Text that is
 * replaced rather than extended snaps to the new value. With reduced motion
 * the text shows as it arrives and no frame loop runs.
 */
export function useSteadyText(text: string): string {
	const reduced = useReducedMotion();
	const [shown, setShown] = useState(text);
	const latest = useRef(text);

	useEffect(() => {
		if (reduced) {
			latest.current = text;

			return;
		}

		let frame = 0;
		let last = 0;

		function tick(now: number): void {
			const ms = last ? Math.min(MAX_FRAME_MS, now - last) : 16;
			const from = text.startsWith(latest.current) ? latest.current.length : text.length;
			const next = text.slice(0, revealEnd(text, from, ms));

			last = now;
			latest.current = next;
			setShown(next);

			if (next.length < text.length) frame = requestAnimationFrame(tick);
		}

		if (!text.startsWith(latest.current) || latest.current.length < text.length) frame = requestAnimationFrame(tick);

		return () => cancelAnimationFrame(frame);
	}, [text, reduced]);

	if (reduced || !text.startsWith(shown)) return text;

	return shown;
}
