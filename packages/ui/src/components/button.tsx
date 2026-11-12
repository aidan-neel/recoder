'use client';

import { Check, X } from 'lucide-react';
import { Slot } from 'radix-ui';
import { useState, type ButtonHTMLAttributes, type ReactNode, type Ref, type TransitionEvent } from 'react';

import { cn } from '../lib/cn';
import { pressOnce } from './press-once';
import { Spinner } from './spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'quiet' | 'destructive';

export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

/** Where an async action stands. Pending keeps the button's width; success and error crossfade in. */
export type ButtonStatus = 'idle' | 'pending' | 'success' | 'error';

/**
 * The look every button shares. These class lists hold no two classes that
 * conflict, so they are plain strings: merging them as the module loads would
 * set up tailwind-merge on every route that imports the kit.
 */
const BASE = [
	'relative inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap select-none',
	'rounded-[8px] font-medium text-[length:var(--font-size-button)] outline-none',
	'transition-[background-color,color,box-shadow,filter] duration-(--dur-hover) ease-out',
	'focus-visible:shadow-(--focus-ring) disabled:pointer-events-none disabled:opacity-40',
	'aria-disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg:not([class*=size-])]:size-4'
].join(' ');

const VARIANTS: Record<ButtonVariant, string> = {
	primary: 'bg-(--primary) text-(--on-primary) hover:brightness-108 data-[state=open]:brightness-108',
	secondary: 'bg-menu text-fg hover:bg-hover data-[state=open]:bg-hover',
	outline: [
		'bg-transparent text-fg shadow-[inset_0_0_0_1px_var(--line-menu)]',
		'hover:bg-line-subtle hover:shadow-[inset_0_0_0_1px_var(--line-hover)]',
		'data-[state=open]:bg-line-subtle focus-visible:shadow-[var(--focus-ring),inset_0_0_0_1px_var(--line-hover)]'
	].join(' '),
	ghost:
		'bg-transparent text-fg-subtle hover:bg-menu hover:text-fg data-[state=open]:bg-menu data-[state=open]:text-fg',
	quiet: 'bg-transparent text-fg hover:bg-hover data-[state=open]:bg-selected',
	destructive: 'bg-danger-tint text-danger hover:brightness-115'
};

const SIZES: Record<ButtonSize, string> = {
	sm: 'h-[calc(var(--size-control-sm)-2px)] px-3',
	md: 'h-[calc(var(--size-control-md)-2px)] px-3',
	lg: 'h-[calc(var(--size-control-lg)-2px)] rounded-[9px] px-3.5 text-[13.5px]',
	icon: 'size-(--size-icon-md) min-w-(--size-icon-md) p-0'
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
	pendingLabel?: ReactNode;
	successLabel?: ReactNode;
	errorLabel?: ReactNode;
	ref?: Ref<HTMLButtonElement>;
}

/** A face that stands for a status, with an icon before its label. */
type StatusFace = Exclude<ButtonStatus, 'idle'>;

/** The label each status face shows beside its icon. */
type FaceLabels = Record<StatusFace, ReactNode>;

/** Whether a face label renders anything a screen reader can speak. */
function hasLabel(label: ReactNode): boolean {
	return label !== null && label !== undefined && label !== false && label !== '';
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
				{faceIcon(drawn.includes('success'), <Check />, 24)}
				{labels.success}
			</span>
			<span data-face="error" data-on={status === 'error'} aria-hidden={spoken !== 'error'}>
				{faceIcon(drawn.includes('error'), <X />, 24)}
				{labels.error}
			</span>
		</span>
	);
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
 * until hovered, and one cream primary button leads each region. Pass `status`
 * for an async action; clicks are ignored while it is pending. A held Enter
 * presses it once.
 */
export function Button({
	variant = 'secondary',
	size = 'md',
	asChild = false,
	status,
	pendingLabel,
	successLabel = 'Done',
	errorLabel = 'Try again',
	className,
	children,
	onClick,
	onKeyDown,
	type = 'button',
	ref,
	...props
}: ButtonProps) {
	const busy = status === 'pending';
	const classes = buttonClass(variant, size, className);
	const labels: FaceLabels = { pending: pendingLabel, success: successLabel, error: errorLabel };

	if (asChild) {
		return (
			<Slot.Root
				ref={ref}
				data-ui="button"
				data-variant={variant}
				data-size={size}
				className={classes}
				onClick={onClick}
				onKeyDown={pressOnce(onKeyDown)}
				{...props}
			>
				{children}
			</Slot.Root>
		);
	}

	const button = (
		<button
			ref={ref}
			type={type}
			data-ui="button"
			data-variant={variant}
			data-size={size}
			data-status={status}
			aria-busy={busy || undefined}
			className={classes}
			onClick={(event) => {
				if (busy) return event.preventDefault();

				onClick?.(event);
			}}
			onKeyDown={pressOnce(onKeyDown)}
			{...props}
		>
			{status ? (
				<Faces status={status} labels={labels}>
					{children}
				</Faces>
			) : (
				children
			)}
		</button>
	);

	if (!status) return button;

	return (
		<>
			{button}
			<StatusAnnouncer>{status === 'idle' ? null : labels[status]}</StatusAnnouncer>
		</>
	);
}
