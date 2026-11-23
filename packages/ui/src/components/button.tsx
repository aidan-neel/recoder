'use client';

import { Icon } from './icon';
import { Slot } from 'radix-ui';
import {
	Children,
	isValidElement,
	useLayoutEffect,
	useRef,
	useState,
	type ButtonHTMLAttributes,
	type ReactElement,
	type ReactNode,
	type Ref,
	type TransitionEvent
} from 'react';

import { cn } from '../lib/cn';
import { pressOnce } from './press-once';
import { Spinner } from './spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'quiet' | 'destructive';

export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

/**
 * Where an async action stands. The faces crossfade in the idle label's
 * place: pending shows a spinner, success a check and error a cross, each
 * with a label only when one is passed, so the button keeps its idle width.
 */
export type ButtonStatus = 'idle' | 'pending' | 'success' | 'error';

/**
 * The look every button shares. Its edge and lift come from the kit's surface
 * recipes (`--shadow-raised`, `--shadow-edge`, `--shadow-primary` in
 * tokens.css) through `--button-shadow`, so the focus ring can sit over them.
 * Hover and press on the see-through variants lay a wash over whatever is
 * behind them, so they still show inside a hovered row. The filled variants
 * draw one gradient whose stops (`--button-top`, `--button-bottom`) are
 * registered colours, so hover and press blend to darker stops instead of
 * swapping the fill for a frame. Hover eases in and out over `--dur-hover`;
 * a press shades in faster (`--dur-tap`) and eases back on release. A press
 * shades the button; it never changes size. A failed action tints the button red while its cross shows. These class lists hold no two classes that conflict, so
 * they are plain strings: merging them as the module loads would set up
 * tailwind-merge on every route that imports the kit.
 */
const BASE = [
	'relative inline-flex shrink-0 items-center justify-center whitespace-nowrap select-none outline-none',
	'font-normal text-[length:var(--font-size-button)] leading-none',
	'shadow-(--button-shadow) focus-visible:shadow-[var(--focus-ring),var(--button-shadow)]',
	'transition-[background-color,color,box-shadow,filter,--button-top,--button-bottom] duration-(--dur-hover) ease-(--ease-hover)',
	'active:duration-(--dur-tap) active:ease-out',
	'disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none [&_svg]:pointer-events-none',
	'data-[status=error]:[background:var(--danger-tint)] data-[status=error]:text-danger',
	'data-[status=error]:[--button-shadow:inset_0_0_0_1px_color-mix(in_oklab,var(--danger)_30%,transparent)]'
].join(' ');

/**
 * The wash a see-through button takes on hover, while a list it closed holds its hover (`holdHover`) and when open,
 * and the deeper one while pressed.
 */
const WASH = [
	'hover:bg-[rgb(var(--wash-rgb)/6%)] data-hover-hold:bg-[rgb(var(--wash-rgb)/6%)]',
	'active:bg-[rgb(var(--wash-rgb)/10%)]'
].join(' ');

/** The hairline and dark outline of the outline button, the edge a chip or a field draws. */
const EDGE = '[--button-shadow:var(--shadow-edge)] hover:[--button-shadow:var(--shadow-edge-hover)]';

/** The gradient a filled button draws from its two stops, which each variant and state sets. */
const FILL = '[background:linear-gradient(180deg,var(--button-top),var(--button-bottom))]';

const VARIANTS: Record<ButtonVariant, string> = {
	primary: [
		`${FILL} font-medium text-(--on-primary) [--button-shadow:var(--shadow-primary)]`,
		'[--button-top:var(--fill-primary-top)] [--button-bottom:var(--fill-primary-bottom)]',
		'hover:[--button-top:var(--fill-primary-hover-top)] hover:[--button-bottom:var(--fill-primary-hover-bottom)]',
		'data-[state=open]:[--button-top:var(--fill-primary-hover-top)] data-[state=open]:[--button-bottom:var(--fill-primary-hover-bottom)]',
		'active:[--button-top:var(--fill-primary-press-top)] active:[--button-bottom:var(--fill-primary-press-bottom)]'
	].join(' '),
	secondary: [
		`${FILL} text-fg [--button-shadow:var(--shadow-raised)] hover:[--button-shadow:var(--shadow-raised-hover)]`,
		'[--button-top:var(--fill-raised-top)] [--button-bottom:var(--fill-raised-bottom)]',
		'hover:[--button-top:var(--fill-raised-hover-top)] hover:[--button-bottom:var(--fill-raised-hover-bottom)]',
		'data-[state=open]:[--button-top:var(--fill-raised-hover-top)] data-[state=open]:[--button-bottom:var(--fill-raised-hover-bottom)]',
		'active:[--button-top:var(--fill-raised-press-top)] active:[--button-bottom:var(--fill-raised-press-bottom)]'
	].join(' '),
	outline: `bg-transparent text-fg ${EDGE} ${WASH} data-[state=open]:bg-[rgb(var(--wash-rgb)/6%)]`,
	ghost: [
		'bg-transparent text-fg-subtle [--button-shadow:0_0_transparent] hover:text-fg data-[state=open]:text-fg',
		`${WASH} data-[state=open]:bg-[rgb(var(--wash-rgb)/6%)]`
	].join(' '),
	quiet: `bg-transparent text-fg [--button-shadow:0_0_transparent] ${WASH} data-[state=open]:bg-[rgb(var(--wash-rgb)/10%)]`,
	destructive: [
		'bg-danger-tint text-danger [--button-shadow:0_0_transparent]',
		'hover:brightness-115 active:brightness-100'
	].join(' ')
};

/**
 * Height, radius, padding and icon size per size. The side an icon sits on
 * gets 2px less padding than a side with text (`data-icon-start`,
 * `data-icon-end`), so the label reads centred.
 */
const SIZES: Record<ButtonSize, string> = {
	sm: [
		'h-(--size-control-sm) gap-1 rounded-(--radius-chip) px-[7px] text-[12.5px] [&_svg:not([class*=size-])]:size-[13px]',
		'data-[icon-start]:pl-[5px] data-[icon-end]:pr-[5px]'
	].join(' '),
	md: [
		'h-(--size-control-md) gap-1.5 rounded-(--radius-control) px-[9px] [&_svg:not([class*=size-])]:size-3.5',
		'data-[icon-start]:pl-[7px] data-[icon-end]:pr-[7px]'
	].join(' '),
	lg: [
		'h-(--size-control-lg) gap-2 rounded-(--radius-control) px-[11px] text-[13.5px] [&_svg:not([class*=size-])]:size-4',
		'data-[icon-start]:pl-[9px] data-[icon-end]:pr-[9px]'
	].join(' '),
	icon: 'size-(--size-icon-md) min-w-(--size-icon-md) rounded-(--radius-control) p-0 [&_svg:not([class*=size-])]:size-4'
};

/** The class list for a button look, for elements that must not be a `Button` (a Radix trigger rendered as a link). */
export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', className?: string): string {
	return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: ButtonVariant;
	size?: ButtonSize;
	/** Render the child element (an anchor or a Next `Link`) with the button's look. */
	asChild?: boolean;
	status?: ButtonStatus;
	/** Shown beside the spinner. Leave it out to keep the button its idle width. */
	pendingLabel?: ReactNode;
	/** Shown beside the check. Leave it out to keep the button its idle width; "Done" is still announced. */
	successLabel?: ReactNode;
	/** Shown beside the cross. Leave it out to keep the button its idle width; "Failed" is still announced. */
	errorLabel?: ReactNode;
	/**
	 * Eases the button's width to fit new content instead of jumping, for a button whose label changes with what it
	 * does. Pair it with a `SwapText` label so the words crossfade while the width moves.
	 */
	morph?: boolean;
	ref?: Ref<HTMLButtonElement>;
}

/** A face that stands for a status, with an icon before its label. */
type StatusFace = Exclude<ButtonStatus, 'idle'>;

/** The label each status face shows beside its icon. */
type FaceLabels = Record<StatusFace, ReactNode>;

/** What a screen reader hears when a face shows no label of its own. */
const ANNOUNCED: FaceLabels = { pending: null, success: 'Done', error: 'Failed' };

/** Whether a face label renders anything a screen reader can speak. */
function hasLabel(label: ReactNode): boolean {
	return label !== null && label !== undefined && label !== false && label !== '';
}

/** Which ends of a button's content are an icon rather than text. */
interface IconEdges {
	start: boolean;
	end: boolean;
}

/**
 * Finds whether the content starts or ends with an icon, so that side can
 * take less padding. An icon is an element with no children of its own (a
 * Phosphor icon, a keycap, a dot); an element that wraps a label is text. With
 * `asChild` the content is the child link's own children.
 *
 * The children are read as React elements, so a button with an icon must be
 * rendered from a client component: across the server component boundary an
 * icon arrives as a reference that the server and the browser read
 * differently, and hydration fails.
 */
function iconEdges(children: ReactNode, asChild: boolean): IconEdges {
	const content = isWrapper(children) && asChild ? children.props.children : children;
	const nodes = Children.toArray(content).filter((node) => typeof node !== 'string' || node.trim() !== '');

	return { start: isIcon(nodes.at(0)), end: isIcon(nodes.at(-1)) };
}

/** An element that may hold children, such as the link an `asChild` button renders. */
function isWrapper(node: ReactNode): node is ReactElement<{ children?: ReactNode }> {
	return isValidElement<{ children?: ReactNode }>(node);
}

/** An element with no children: an icon, a keycap or a dot. */
function isIcon(node: ReactNode): boolean {
	return isWrapper(node) && node.props.children === undefined;
}

/**
 * The status faces whose icons are mounted: the one on show, and any still
 * fading out, so a page of idle buttons builds no spinners and no icons.
 * Returns the faces' transition-end handler, which drops a face once its
 * fade out ends.
 */
function useDrawnFaces(status: ButtonStatus): [readonly StatusFace[], (event: TransitionEvent) => void] {
	const [drawn, setDrawn] = useState<readonly StatusFace[]>(status === 'idle' ? [] : [status]);

	if (status !== 'idle' && !drawn.includes(status)) setDrawn([...drawn, status]);

	const faded = (event: TransitionEvent) => {
		const face = event.target instanceof HTMLElement ? event.target.dataset.face : undefined;

		if (event.propertyName !== 'opacity' || face === status) return;

		setDrawn((current) => (current.some((kind) => kind === face) ? current.filter((kind) => kind !== face) : current));
	};

	return [drawn, faded];
}

/**
 * A face's icon while it is drawn; else an empty svg, which the button's icon
 * sizing gives the icon's size (`size` where that sizing does not reach), so
 * the face keeps its width.
 */
function faceIcon(drawn: boolean, icon: ReactNode, size: number): ReactNode {
	return drawn ? icon : <svg aria-hidden className="shrink-0" width={size} height={size} />;
}

/**
 * Idle, pending, success and error faces in one grid cell, so the button
 * keeps its widest face's width. Only the shown face names the button for
 * assistive tech; a pending face with no label (a bare spinner) leaves the
 * idle label as the name, so the button is never nameless.
 */
function Faces({ status, labels, children }: { status: ButtonStatus; labels: FaceLabels; children: ReactNode }) {
	const spoken = status !== 'idle' && hasLabel(labels[status]) ? status : 'idle';
	const [drawn, faded] = useDrawnFaces(status);

	return (
		<span data-ui="button-faces" onTransitionEnd={drawn.length > 0 ? faded : undefined}>
			<span data-face="idle" data-on={status === 'idle'} aria-hidden={spoken !== 'idle'}>
				{children}
			</span>
			<span data-face="pending" data-on={status === 'pending'} aria-hidden={spoken !== 'pending'}>
				{faceIcon(drawn.includes('pending'), <Spinner size={13} />, 13)}
				{labels.pending}
			</span>
			<span data-face="success" data-on={status === 'success'} aria-hidden={spoken !== 'success'}>
				{faceIcon(drawn.includes('success'), <Icon name="check" />, 24)}
				{labels.success}
			</span>
			<span data-face="error" data-on={status === 'error'} aria-hidden={spoken !== 'error'}>
				{faceIcon(drawn.includes('error'), <Icon name="close" />, 24)}
				{labels.error}
			</span>
		</span>
	);
}

/**
 * The button's content in a box whose width follows the content's own over `--dur-swap`, so a new label widens or
 * narrows the button in one smooth move. The content keeps its natural width and starts at the box's start edge, so
 * text leaving or arriving never moves; the box clips what is wider than it while it grows. The first measure sets
 * the width without a move, and reduced motion snaps.
 */
function MorphWidth({ children }: { children: ReactNode }) {
	const content = useRef<HTMLSpanElement>(null);
	const [width, setWidth] = useState<number>();

	useLayoutEffect(() => {
		const node = content.current;

		if (!node) return;

		const observer = new ResizeObserver(([entry]) => setWidth(entry.borderBoxSize[0].inlineSize));

		observer.observe(node);

		return () => observer.disconnect();
	}, []);

	return (
		<span data-ui="button-morph" style={{ width }}>
			<span ref={content} data-ui="button-morph-content">
				{children}
			</span>
		</span>
	);
}

/** What the status announcer says: the face's own label, else a plain word for it. */
function announcement(status: ButtonStatus, labels: FaceLabels): ReactNode {
	if (status === 'idle') return null;

	return hasLabel(labels[status]) ? labels[status] : ANNOUNCED[status];
}

/**
 * Speaks the pending, success or error label when the button reaches that
 * state. It sits beside the button, not inside it: a button's content is
 * presentational, so a live region within it is not reliably announced.
 */
function StatusAnnouncer({ children }: { children: ReactNode }) {
	return (
		<span role="status" data-ui="button-status" className="sr-only">
			{children}
		</span>
	);
}

/**
 * The kit's button. Quiet at rest: ghost and quiet variants have no background
 * until hovered, and one blue primary button leads each region. Pass `status`
 * for an async action; clicks are ignored while it is pending. A held Enter
 * presses it once.
 */
export function Button({
	variant = 'secondary',
	size = 'md',
	asChild = false,
	status,
	pendingLabel,
	successLabel,
	errorLabel,
	morph = false,
	className,
	children,
	onClick,
	onKeyDown,
	type = 'button',
	ref,
	...props
}: ButtonProps) {
	const busy = status === 'pending';
	const labels: FaceLabels = { pending: pendingLabel, success: successLabel, error: errorLabel };
	const edges = iconEdges(children, asChild);

	const look = {
		'data-ui': 'button',
		'data-variant': variant,
		'data-size': size,
		'data-icon-start': edges.start || undefined,
		'data-icon-end': edges.end || undefined,
		className: buttonClass(variant, size, className)
	};

	const content = status ? (
		<Faces status={status} labels={labels}>
			{children}
		</Faces>
	) : (
		children
	);

	if (asChild) {
		return (
			<Slot.Root ref={ref} {...look} onClick={onClick} onKeyDown={pressOnce(onKeyDown)} {...props}>
				{children}
			</Slot.Root>
		);
	}

	const button = (
		<button
			ref={ref}
			type={type}
			{...look}
			data-status={status}
			aria-busy={busy || undefined}
			onClick={(event) => {
				if (busy) return event.preventDefault();

				onClick?.(event);
			}}
			onKeyDown={pressOnce(onKeyDown)}
			{...props}
		>
			{morph ? <MorphWidth>{content}</MorphWidth> : content}
		</button>
	);

	if (!status) return button;

	return (
		<>
			{button}
			<StatusAnnouncer>{announcement(status, labels)}</StatusAnnouncer>
		</>
	);
}
