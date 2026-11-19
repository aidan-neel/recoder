'use client';

import { useReducedMotionConfig } from 'motion/react';
import { memo, useLayoutEffect, useRef, useState } from 'react';

import { cn } from '../../lib/cn';
import { EASE_OUT } from '../../motion/presets';

/** How long a digit takes to roll to its new value, in ms: Capy's roll. */
const ROLL_MS = 500;

const ROLL_EASING = `cubic-bezier(${EASE_OUT.join(', ')})`;

/** The digits a rolling column draws, ten either side of the one at rest, so a roll of up to ten steps never runs dry. */
const COLUMN = Array.from({ length: 21 }, (_, index) => index - 10);

const DIGIT = /\d/;

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

/** Where a digit's column starts its roll from and comes to rest, in lines above its rest. */
interface Roll {
	from: number;
	to: number;
}

/** A remainder that stays in 0 to 9 for negative steps too. */
function wrap(n: number): number {
	return ((n % 10) + 10) % 10;
}

/**
 * How many lines the column moves to go from `from` to `to`: up through the digits when the number grew (`trend`
 * 1), down when it shrank (-1), and the shorter way when it is not a number that moved.
 */
function rollSteps(from: number, to: number, trend: number): number {
	const up = wrap(to - from);

	if (trend > 0) return up;
	if (trend < 0) return up - 10;

	return up <= 5 ? up : up - 10;
}

/**
 * Where a column moving now sits, in lines from its rest: a roll caught mid-way carries on from the line it is at
 * rather than jumping back to its start.
 */
function offsetNow(column: HTMLElement | null): number {
	if (!column) return 0;

	const style = getComputedStyle(column);
	const line = Number.parseFloat(style.lineHeight);

	if (!Number.isFinite(line) || line <= 0 || style.transform === 'none') return 0;

	return new DOMMatrixReadOnly(style.transform).m42 / line;
}

/**
 * One digit. At rest it is a plain character; once it changes it becomes a clipped column of digits that rolls the
 * new one into place over 500ms on a strong ease-out, the way Capy rolls its counters. A change mid-roll takes over
 * from where the column is.
 */
const RollingDigit = memo(function RollingDigit({ digit, trend }: { digit: number; trend: number }) {
	const reduced = useReducedMotionConfig() ?? false;
	const [shown, setShown] = useState(digit);
	const [rolling, setRolling] = useState(false);
	const last = useRef(digit);
	const rest = useRef(digit);
	const column = useRef<HTMLSpanElement | null>(null);
	const animation = useRef<Animation | null>(null);
	const pending = useRef<Roll | null>(null);

	useLayoutEffect(() => {
		if (digit === last.current) return;

		const target = rest.current + rollSteps(last.current, digit, trend);
		const to = wrap(target);
		const at = rest.current - offsetNow(column.current);
		const start = at + (to - target);

		last.current = digit;
		rest.current = to;
		pending.current = { from: start - Math.trunc((start - to) / 10) * 10, to };
		setRolling(true);
		setShown(to);
	}, [digit, trend]);

	useLayoutEffect(() => {
		const roll = pending.current;
		const element = column.current;

		if (!roll || !element || shown !== roll.to) return;

		pending.current = null;
		animation.current?.cancel();

		if (reduced) return;

		animation.current = element.animate(
			[{ transform: `translateY(calc(${roll.to - roll.from} * 1lh))` }, { transform: 'translateY(0px)' }],
			{ duration: ROLL_MS, easing: ROLL_EASING }
		);
	}, [shown, rolling, reduced]);

	return (
		<span className="relative inline-block">
			<span
				aria-hidden
				data-d={rolling ? 0 : digit}
				className={cn('before:content-[attr(data-d)]', rolling && 'invisible')}
			/>
			{rolling ? (
				<span
					aria-hidden
					className="absolute inset-0 overflow-clip [mask-image:linear-gradient(to_bottom,transparent,black_22%,black_78%,transparent)]"
				>
					<span ref={column} className="absolute inset-x-0 top-0">
						{COLUMN.map((line) => (
							<span
								key={line}
								data-d={wrap(shown + line)}
								className="absolute inset-x-0 before:content-[attr(data-d)]"
								style={{ top: `calc(${line} * 1lh)` }}
							/>
						))}
					</span>
				</span>
			) : null}
		</span>
	);
});

/** The value's direction at its last change: 1 up, -1 down, 0 when either side was unknown. */
function useTrend(value: number | null | undefined): number {
	const [previous, setPrevious] = useState(value);
	const [trend, setTrend] = useState(0);

	if (value !== previous) {
		const known = value !== null && value !== undefined && previous !== null && previous !== undefined;

		setPrevious(value);
		setTrend(known ? Math.sign(value - previous) : 0);
	}

	return trend;
}

/** False on the first commit, so the characters a number is first drawn with show at once and only later ones fade in. */
function useMounted(): boolean {
	const [mounted, setMounted] = useState(false);

	useLayoutEffect(() => {
		/* eslint-disable-next-line react-hooks/set-state-in-effect -- the first characters paint still; only ones added after mount fade in */
		setMounted(true);
	}, []);

	return mounted;
}

/**
 * A number in tabular figures whose changed digits roll, Capy's way: each digit is a column that moves up through
 * the digits when the value grows and down when it shrinks, keyed from the right so a new place (9 to 10, 59s to
 * 1m 0s) fades in on the left while the rest roll. A value that first becomes known appears at once, `still` turns
 * the roll off, and reduced motion swaps the digits in place. Assistive tech reads the whole value once.
 */
export function AnimatedNumber({ value, className, format = String, still = false }: AnimatedNumberProps) {
	const trend = useTrend(value);
	const mounted = useMounted();

	if (value === null || value === undefined) return <span data-ui="animated-number" className={className} />;

	const text = format(value);
	const chars = [...text];
	const fresh = mounted ? 'transition-opacity duration-(--dur-swap) ease-(--ease-out) starting:opacity-0' : undefined;

	return (
		<span
			data-ui="animated-number"
			className={cn('relative inline-flex items-baseline leading-[inherit] tabular-nums', className)}
		>
			<span className="sr-only">{text}</span>
			{chars.map((char, index) => {
				const key = `rpos-${chars.length - 1 - index}`;

				if (!still && DIGIT.test(char)) {
					return (
						<span key={key} aria-hidden className={cn('inline-block', fresh)}>
							<RollingDigit digit={Number(char)} trend={trend} />
						</span>
					);
				}

				return (
					<span
						key={key}
						aria-hidden
						data-c={char === ' ' ? '\u00a0' : char}
						className={cn('inline-block whitespace-pre before:content-[attr(data-c)]', fresh)}
					/>
				);
			})}
		</span>
	);
}
