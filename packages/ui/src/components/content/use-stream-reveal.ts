'use client';

import { useReducedMotionConfig } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { FADE_MS } from './stream-fade';
import { paceRate, revealStep } from './stream-pace';

/** What the Markdown draws of streaming text: the part let out so far. */
interface StreamReveal {
	text: string;
	/** True while text is still to come or still fading in. */
	streaming: boolean;
}

/** The longest frame the pace counts, in seconds, so a tab coming back from the background does not dump its text. */
const MAX_FRAME_S = 0.1;

/**
 * Lets `text` out a few words at a time while it streams, so a burst of text reads as a steady flow, and keeps
 * `streaming` on until the last word has faded in. Text present at mount, text that is complete from the start,
 * text that is replaced rather than extended, and reduced motion show at once.
 */
export function useStreamReveal(text: string, streaming: boolean): StreamReveal {
	const reduced = useReducedMotionConfig() ?? false;
	const [shown, setShown] = useState(text.length);
	const [source, setSource] = useState(text);
	const [settled, setSettled] = useState(!streaming);

	const pace = useRef<{ length: number; budget: number; last: number | null }>({
		length: shown,
		budget: 0,
		last: null
	});

	const length = reduced ? text.length : Math.min(shown, text.length);
	const behind = length < text.length;

	if (text !== source) {
		setSource(text);

		if (!text.startsWith(source.slice(0, shown))) setShown(text.length);
	}

	if (streaming && settled) setSettled(false);

	useLayoutEffect(() => {
		pace.current.length = length;
	}, [length]);

	useEffect(() => {
		if (!behind) return;

		let frame = requestAnimationFrame(function tick(now) {
			const state = pace.current;
			const seconds = state.last === null ? 0 : Math.min(MAX_FRAME_S, (now - state.last) / 1000);
			const budget = state.budget + seconds * paceRate(text.length - state.length);
			const next = revealStep(text, state.length, budget, !streaming);

			state.last = now;
			state.budget = next.budget;

			if (next.length > state.length) {
				state.length = next.length;
				setShown(next.length);
			}

			if (state.length < text.length) frame = requestAnimationFrame(tick);
			else state.last = null;
		});

		return () => cancelAnimationFrame(frame);
	}, [text, streaming, behind]);

	useEffect(() => {
		if (streaming || behind || settled) return;

		const timer = setTimeout(() => setSettled(true), reduced ? 0 : FADE_MS);

		return () => clearTimeout(timer);
	}, [streaming, behind, settled, reduced]);

	return { text: text.slice(0, length), streaming: !reduced && !settled };
}
