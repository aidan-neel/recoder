'use client';

import { useReducedMotionConfig } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

import { EASE_OUT } from '../../motion/presets';
import { arrivalAt, paceRate, revealStep, type Arrival } from './stream-pace';

/** How long a word takes to fade in, in ms. Long enough that the last few words read as one soft edge. */
const FADE_MS = 360;

/** A word comes in from nothing and a 2px blur, the kit's entrance, to rest. */
const WORD_IN: Keyframe[] = [
	{ opacity: 0, filter: 'blur(2px)' },
	{ opacity: 1, filter: 'blur(0)' }
];

/** A list item's marker comes in by colour: a marker takes no opacity. */
const MARKER_IN: Keyframe[] = [{ color: 'transparent' }, {}];

const EASING = `cubic-bezier(${EASE_OUT.join(', ')})`;

/** What the Markdown draws of streaming text: the part let out so far, and when each stretch of it went out. */
interface StreamReveal {
	text: string;
	/** True while text is still to come or still fading in. */
	streaming: boolean;
	/** When the character at an offset of `text` went out, in `performance.now()` time. */
	arrivalAt: (offset: number) => number;
}

/** What has been let out: its length, and when each stretch of it went out. */
interface Shown {
	length: number;
	arrivals: Arrival[];
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
	const [shown, setShown] = useState<Shown>({ length: text.length, arrivals: [] });
	const [source, setSource] = useState(text);
	const [settled, setSettled] = useState(!streaming);

	const pace = useRef<{ length: number; budget: number; last: number | null }>({
		length: shown.length,
		budget: 0,
		last: null
	});

	const length = reduced ? text.length : Math.min(shown.length, text.length);
	const behind = length < text.length;

	if (text !== source) {
		setSource(text);

		if (!text.startsWith(source.slice(0, shown.length))) setShown({ length: text.length, arrivals: [] });
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
				const end = next.length;

				state.length = end;
				setShown((before) => ({ length: end, arrivals: [...before.arrivals, { end, at: now }] }));
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

	return {
		text: text.slice(0, length),
		streaming: !reduced && !settled,
		arrivalAt: (offset) => arrivalAt(shown.arrivals, offset)
	};
}

/** Fades in a list item's marker, where the browser can animate one; elsewhere the marker shows at once. */
function fadeMarker(item: HTMLElement, timing: KeyframeAnimationOptions): void {
	try {
		item.animate(MARKER_IN, { ...timing, pseudoElement: '::marker' });
	} catch {
		return;
	}
}

/**
 * Fades in each word, code span, list marker and code block the streaming Markdown in `ref` draws for the first
 * time, from the moment its text went out: a word drawn again mid-fade (the parser regrouping its line) picks up
 * where it was, and one that has finished stays still. Runs before paint, so a new word never flashes in full.
 */
export function useWordFade(ref: RefObject<HTMLElement | null>, active: boolean): void {
	const seen = useRef(new WeakSet<Element>());

	useLayoutEffect(() => {
		const root = ref.current;

		if (!active || !root || typeof root.animate !== 'function') return;

		const now = performance.now();

		for (const element of root.querySelectorAll<HTMLElement>("[data-t], [data-ui='code-block']")) {
			if (seen.current.has(element)) continue;

			seen.current.add(element);

			const age = element.dataset.t === undefined ? 0 : now - Number(element.dataset.t);

			if (age >= FADE_MS) continue;

			const timing = { duration: FADE_MS, delay: -age, easing: EASING, fill: 'backwards' as const };

			if (element.tagName === 'LI') fadeMarker(element, timing);
			else element.animate(WORD_IN, timing);
		}
	});
}
