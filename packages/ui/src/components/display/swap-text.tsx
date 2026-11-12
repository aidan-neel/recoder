'use client';

import { useEffect, useLayoutEffect, useRef, useState, type AnimationEvent, type ReactNode } from 'react';

import { cn } from '../../lib/cn';

interface SwapTextProps {
	/** What is shown. A new `id` crossfades the new content in. */
	children: ReactNode;
	/**
	 * Names what is shown. Defaults to the text when `children` is a string or
	 * a number; other content never swaps without one.
	 */
	id?: string | number;
	/**
	 * `popLayout` (the default): old and new cross in one place, for one line
	 * that truncates. `wait`: the old leaves before the new comes in, for text
	 * that wraps, so two lines never overlap. The new one is drawn at once and
	 * held unseen by CSS for the leave, so a busy page never leaves a gap.
	 */
	mode?: 'popLayout' | 'wait';
	/**
	 * Shows each value for at least this long, in ms, so a burst of changes
	 * reads as calm swaps. The latest value always lands.
	 */
	holdMs?: number;
	/** Shows the full text on hover, for a line that truncates. */
	titled?: boolean;
	/** On the wrapper, which keeps its place in the layout while the text swaps. */
	className?: string;
	/** On the swapping text itself (a color, `inline-block`). */
	textClassName?: string;
}

/** What one swap shows: its key, its content and its hover title. */
interface Shown {
	key: string | number;
	children: ReactNode;
	title: string | undefined;
}

/**
 * Where a swap stands: the key on show, whether it has finished arriving,
 * and the value before it while that one leaves. The value on show is drawn
 * from the latest props, so new content under the same key changes no state.
 */
interface Swap {
	key: Shown['key'];
	settled: boolean;
	leaving: Shown | null;
	/**
	 * True while the value on show arrives behind a leave (a `wait` swap): it
	 * is drawn at once and held unseen by a CSS delay as long as the leave, so
	 * it comes in on time however late the page hears that the leave ended.
	 */
	waits: boolean;
}

/**
 * How long a leaving value may wait for its animation to end, in ms. The exit
 * takes 80ms; this covers one that never runs, under a hidden ancestor, so a
 * leaving value always goes.
 */
const LEAVE_LIMIT_MS = 250;

/**
 * The value, changing at most once per `holdMs`. A change waits until the
 * shown one has had its time, and only the latest pending one lands. New
 * content under the same key shows at once.
 */
function useHeld(value: Shown, holdMs: number): Shown {
	const [shown, setShown] = useState(value);
	const shownAt = useRef(0);
	const held = holdMs > 0 && !Object.is(value.key, shown.key);

	useEffect(() => {
		if (!held) return;

		const timer = setTimeout(
			() => {
				shownAt.current = Date.now();
				setShown(value);
			},
			Math.max(0, shownAt.current + holdMs - Date.now())
		);

		return () => clearTimeout(timer);
	}, [held, value, holdMs]);

	return held ? shown : value;
}

/** True when a value draws something; an empty one (no pill, say) has nothing to fade out or to wait for. */
function draws(value: Shown): boolean {
	return value.children !== null && value.children !== undefined && value.children !== false && value.children !== '';
}

/**
 * The swap once a new key arrives: `drawn`, the value last on screen, starts
 * leaving, unless it drew nothing. A `wait` swap keeps the value already
 * leaving until it has gone.
 */
function advance(swap: Swap, key: Shown['key'], drawn: Shown, mode: SwapTextProps['mode']): Swap {
	const kept = mode === 'wait' ? swap.leaving : null;
	const leaving = kept ?? (draws(drawn) ? drawn : null);

	return { key, settled: false, leaving, waits: mode === 'wait' && leaving !== null };
}

/** An update that drops `gone` once it has left, unless a newer value already took its place. */
function without(gone: Shown | null) {
	return (state: Swap): Swap => (state.leaving === gone ? { ...state, leaving: null } : state);
}

/**
 * Tracks the swap for `shown`, and returns the calls that end the leave and
 * the arrival. Only the latest leaving value is kept, so a burst of changes
 * never stacks copies. A `wait` swap keeps the first leaving value until it
 * has gone, and only then shows the latest one. State changes only on a new
 * key; the value last drawn waits in a ref, written as each render commits,
 * so a leave shows what was last on screen.
 */
function useSwap(shown: Shown, mode: SwapTextProps['mode']): [Swap, () => void, () => void] {
	const [swap, setSwap] = useState<Swap>(() => ({ key: shown.key, settled: true, leaving: null, waits: false }));
	const drawn = useRef(shown);
	const { leaving } = swap;

	const left = () => setSwap(without(leaving));

	const arrived = () => setSwap((state) => (Object.is(state.key, shown.key) ? { ...state, settled: true } : state));

	useLayoutEffect(() => {
		drawn.current = shown;
	});

	useEffect(() => {
		if (!leaving) return;

		const timer = setTimeout(() => setSwap(without(leaving)), LEAVE_LIMIT_MS);

		return () => clearTimeout(timer);
	}, [leaving]);

	if (!Object.is(swap.key, shown.key)) {
		// eslint-disable-next-line react-hooks/refs -- read only on a new key; it holds what the last commit drew
		const updated = advance(swap, shown.key, drawn.current, mode);

		setSwap(updated);

		return [updated, left, arrived];
	}

	return [swap, left, arrived];
}

/**
 * One copy of the text on screen, whether it rests, arrives or leaves, and
 * what ends its animation. `wait` marks the copies of a `wait` swap: the
 * leaving one, and the arriving one until it settles; the kit's CSS keeps
 * the leaving one in its place and has the arriving one wait out the leave,
 * over it. A leaving copy has a key of its own, so a value that comes back
 * while it still leaves (a `wait` swap keeps the first leaving one) is drawn
 * beside it.
 */
interface Layer {
	value: Shown;
	state: 'still' | 'in' | 'out';
	wait: boolean;
	onEnd: (event: AnimationEvent) => void;
}

/** Calls `done` when the element's own animation ends, not one inside it. */
function onOwnEnd(done: () => void) {
	return (event: AnimationEvent) => {
		if (event.target === event.currentTarget) done();
	};
}

/**
 * The copies to draw: the leaving one, then the one on show, drawn from the
 * latest `shown`. In a `wait` swap the one on show waits, unseen, for the
 * leaving one to go, and keeps the wait until it settles, since dropping it
 * would move the running fade.
 */
function layersOf(swap: Swap, shown: Shown, left: () => void, arrived: () => void): Layer[] {
	const layers: Layer[] = [];

	if (swap.leaving) layers.push({ value: swap.leaving, state: 'out', wait: swap.waits, onEnd: onOwnEnd(left) });

	layers.push({
		value: shown,
		state: swap.settled ? 'still' : 'in',
		wait: swap.waits && !swap.settled,
		onEnd: onOwnEnd(arrived)
	});

	return layers;
}

/**
 * Text that crossfades when it changes: the new text fades in with a 2px rise
 * as the old one leaves (a snap under reduced motion). The first paint never
 * animates. The wrapper is positioned, so a one-line swap never moves what
 * sits around it. The swap is a CSS animation on opacity and transform, so
 * text that never changes costs no animation work.
 */
export function SwapText({
	children,
	id,
	mode = 'popLayout',
	holdMs = 0,
	titled = false,
	className,
	textClassName
}: SwapTextProps) {
	const text = typeof children === 'string' || typeof children === 'number' ? children : undefined;
	const key = id ?? text ?? 'content';
	const shown = useHeld({ key, children, title: titled && text !== undefined ? String(text) : undefined }, holdMs);
	const [swap, left, arrived] = useSwap(shown, mode);
	const layerClass = cn('block', mode === 'popLayout' && 'truncate', textClassName);

	const layers = layersOf(swap, shown, left, arrived);

	return (
		<span data-ui="swap-text" className={cn('relative block min-w-0', className)}>
			{layers.map(({ value, state, wait, onEnd }) => (
				<span
					key={state === 'out' ? `out ${value.key}` : value.key}
					data-ui="swap-layer"
					data-state={state}
					data-wait={wait || undefined}
					title={value.title}
					className={layerClass}
					onAnimationEnd={state === 'still' ? undefined : onEnd}
				>
					{value.children}
				</span>
			))}
		</span>
	);
}
