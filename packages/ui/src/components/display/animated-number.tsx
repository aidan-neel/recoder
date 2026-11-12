'use client';

import { AnimatePresence, motion, useReducedMotionConfig, type Transition, type Variants } from 'motion/react';
import { useLayoutEffect, useState, type Ref } from 'react';

import { cn } from '../../lib/cn';
import { DURATION, EASE_OUT, SPRING } from '../../motion/presets';

/** Which way digits roll: 1 when the value went up (new digits rise from below), -1 when it went down. */
type Direction = 1 | -1;

interface AnimatedNumberProps {
	/**
	 * The number to show. Null or undefined means not known yet: nothing
	 * shows, and the number that follows appears at once rather than rolling
	 * up from nothing.
	 */
	value: number | null | undefined;
	className?: string;
	/** Turns the value into the printed text, for separators, units or a fixed precision. */
	format?: (n: number) => string;
	/**
	 * Swaps the text at once with no motion. For a position that changes on
	 * every keyboard step ("3 of 12"), where a roll would play on each key;
	 * counts that change with data keep the roll.
	 */
	still?: boolean;
}

/** A digit enters 0.6em from the side it rolls from and leaves 0.6em toward the other, crossfading on the way. */
const ROLL: Variants = {
	enter: (direction: Direction) => ({ y: `${0.6 * direction}em`, opacity: 0 }),
	settled: { y: '0em', opacity: 1 },
	leave: (direction: Direction) => ({ y: `${-0.6 * direction}em`, opacity: 0 })
};

/** Reduced motion: digits crossfade in place instead of rolling. */
const FADE: Variants = {
	enter: { opacity: 0 },
	settled: { opacity: 1 },
	leave: { opacity: 0 }
};

/** The roll springs; the crossfade is a short tween so a leaving digit is gone before the spring settles. */
const ROLL_TRANSITION: Transition = { y: SPRING, opacity: { duration: DURATION.swap, ease: EASE_OUT } };

/** Reduced motion: the crossfade is held to the shortest fade, so nothing lingers. */
const FADE_TRANSITION: Transition = { opacity: { duration: DURATION.menuOut, ease: EASE_OUT } };

interface DigitProps {
	char: string;
	direction: Direction;
	reduced: boolean;
	/** Lets the presence measure a leaving position and pop it out of the flow, so the rest reflows at once. */
	ref?: Ref<HTMLSpanElement>;
}

/**
 * One character position. A new position rolls in as a whole; inside it a
 * changed character rolls out while the new one rolls in, and an unchanged
 * one stays still.
 */
function Digit({ char, direction, reduced, ref }: DigitProps) {
	const variants = reduced ? FADE : ROLL;
	const transition = reduced ? FADE_TRANSITION : ROLL_TRANSITION;

	return (
		<motion.span
			ref={ref}
			data-ui="animated-number-digit"
			className="relative inline-block"
			custom={direction}
			variants={variants}
			initial="enter"
			animate="settled"
			exit="leave"
			transition={transition}
		>
			<AnimatePresence initial={false} custom={direction} mode="popLayout">
				<motion.span
					key={char}
					className="inline-block whitespace-pre"
					custom={direction}
					variants={variants}
					initial="enter"
					animate="settled"
					exit="leave"
					transition={transition}
				>
					{char}
				</motion.span>
			</AnimatePresence>
		</motion.span>
	);
}

/** A character drawn in the same boxes as a rolling `Digit`, with no motion, for a number that has not changed yet. */
function StillDigit({ char }: { char: string }) {
	return (
		<span data-ui="animated-number-digit" className="relative inline-block">
			<span className="inline-block whitespace-pre">{char}</span>
		</span>
	);
}

interface DigitsProps {
	text: string;
	direction: Direction;
	reduced: boolean;
	/** False until the number first changes: until then each character is a plain box and no motion is set up. */
	rolling: boolean;
}

/**
 * The characters. Each mount paints its value at once (the presence skips
 * its first render), so a number that was not shown before never rolls;
 * only a change to a shown number does.
 */
function Digits({ text, direction, reduced, rolling }: DigitsProps) {
	const chars = [...text];

	return (
		<>
			<span className="sr-only">{text}</span>
			<span aria-hidden className="inline-flex">
				{rolling ? (
					<AnimatePresence initial={false} custom={direction} mode="popLayout">
						{chars.map((char, index) => (
							<Digit key={chars.length - index} char={char} direction={direction} reduced={reduced} />
						))}
					</AnimatePresence>
				) : (
					chars.map((char, index) => <StillDigit key={chars.length - index} char={char} />)
				)}
			</span>
		</>
	);
}

/** What the digits show and how they move. */
interface Roll {
	/** The text to draw. */
	text: string;
	direction: Direction;
	/** False until the number first changes; most never do, so they set up no motion. */
	rolling: boolean;
}

/**
 * Follows the value for the digits. A number draws plain boxes until its
 * first change. On that change the rolling digits mount on the old text,
 * and a layout effect hands them the new one before the frame paints, so the
 * first change rolls like every later one.
 */
function useRoll(value: number | null | undefined, format: (n: number) => string): Roll {
	const [previous, setPrevious] = useState(value);
	const [direction, setDirection] = useState<Direction>(1);
	const [rolling, setRolling] = useState(false);
	const [start, setStart] = useState<string | null>(null);

	if (value !== previous) {
		setPrevious(value);

		if (value !== null && value !== undefined && previous !== null && previous !== undefined) {
			setDirection(value > previous ? 1 : -1);

			if (!rolling) {
				setRolling(true);
				setStart(format(previous));
			}
		}
	}

	useLayoutEffect(() => {
		/* eslint-disable-next-line react-hooks/set-state-in-effect -- the rolling digits commit once on the old text, so the presence sees the change */
		if (start !== null) setStart(null);
	}, [start]);

	return { text: start ?? (value === null || value === undefined ? '' : format(value)), direction, rolling };
}

/**
 * A number in tabular figures whose changed digits roll when a shown value
 * changes: up when it grows, down when it shrinks. A value that first becomes
 * known (on mount, from a saved copy on page load, or after null) appears at
 * once, and `still` turns the roll off. Assistive tech reads the whole value
 * once.
 */
export function AnimatedNumber({ value, className, format = String, still = false }: AnimatedNumberProps) {
	const reduced = useReducedMotionConfig() ?? false;
	const roll = useRoll(value, format);
	const known = value !== null && value !== undefined;

	return (
		<span
			data-ui="animated-number"
			data-still={still || undefined}
			className={cn('relative inline-flex tabular-nums', className)}
		>
			{known && (still ? format(value) : <Digits {...roll} reduced={reduced} />)}
		</span>
	);
}
