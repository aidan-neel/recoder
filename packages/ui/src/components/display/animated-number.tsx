'use client';

import { AnimatePresence, motion, useReducedMotionConfig, type Transition, type Variants } from 'motion/react';
import { useState, type Ref } from 'react';

import { cn } from '../../lib/cn';
import { DURATION, EASE_OUT, SPRING } from '../../motion/presets';

/** Which way digits roll: 1 when the value went up (new digits rise from below), -1 when it went down. */
type Direction = 1 | -1;

interface AnimatedNumberProps {
	value: number;
	className?: string;
	/** Turns the value into the printed text, for separators, units or a fixed precision. */
	format?: (n: number) => string;
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

interface DigitProps {
	char: string;
	direction: Direction;
	variants: Variants;
	/** Lets the presence measure a leaving position and pop it out of the flow, so the rest reflows at once. */
	ref?: Ref<HTMLSpanElement>;
}

/**
 * One character position. A new position rolls in as a whole; inside it a
 * changed character rolls out while the new one rolls in, and an unchanged
 * one stays still.
 */
function Digit({ char, direction, variants, ref }: DigitProps) {
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
			transition={ROLL_TRANSITION}
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
					transition={ROLL_TRANSITION}
				>
					{char}
				</motion.span>
			</AnimatePresence>
		</motion.span>
	);
}

/**
 * A number in tabular figures whose changed digits roll when the value
 * changes: up when it grows, down when it shrinks. The first paint does not
 * animate. Assistive tech reads the whole value once.
 */
export function AnimatedNumber({ value, className, format = String }: AnimatedNumberProps) {
	const reduced = useReducedMotionConfig();
	const [previous, setPrevious] = useState(value);
	const [direction, setDirection] = useState<Direction>(1);
	const text = format(value);
	const chars = [...text];

	if (value !== previous) {
		setPrevious(value);
		setDirection(value > previous ? 1 : -1);
	}

	return (
		<span data-ui="animated-number" className={cn('relative inline-flex tabular-nums', className)}>
			<span className="sr-only">{text}</span>
			<span aria-hidden className="inline-flex">
				<AnimatePresence initial={false} custom={direction} mode="popLayout">
					{chars.map((char, index) => (
						<Digit key={chars.length - index} char={char} direction={direction} variants={reduced ? FADE : ROLL} />
					))}
				</AnimatePresence>
			</span>
		</span>
	);
}
