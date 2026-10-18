'use client';

import { Check, X } from 'lucide-react';
import { Slot } from 'radix-ui';
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

import { cn } from '../lib/cn';
import { pressOnce } from './press-once';
import { Spinner } from './spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'quiet' | 'destructive';

export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

/** Where an async action stands. Pending keeps the button's width; success and error crossfade in. */
export type ButtonStatus = 'idle' | 'pending' | 'success' | 'error';

const BASE = cn(
	'relative inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap select-none',
	'rounded-[8px] leading-none font-medium text-[length:var(--font-size-button)] outline-none',
	'transition-[background-color,color,box-shadow,filter] duration-(--dur-hover) ease-out',
	'focus-visible:shadow-(--focus-ring) disabled:pointer-events-none disabled:opacity-40',
	'aria-disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg:not([class*=size-])]:size-4'
);

const VARIANTS: Record<ButtonVariant, string> = {
	primary: 'bg-(--primary) text-(--on-primary) hover:brightness-108 data-[state=open]:brightness-108',
	secondary: 'bg-menu text-fg hover:bg-hover data-[state=open]:bg-hover',
	outline: cn(
		'bg-transparent text-fg shadow-[inset_0_0_0_1px_var(--line-menu)]',
		'hover:bg-line-subtle hover:shadow-[inset_0_0_0_1px_var(--line-hover)]',
		'data-[state=open]:bg-line-subtle focus-visible:shadow-[var(--focus-ring),inset_0_0_0_1px_var(--line-hover)]'
	),
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

/** The label each non-idle face shows beside its icon. */
type FaceLabels = Record<Exclude<ButtonStatus, 'idle'>, ReactNode>;

/** Whether a face label renders anything a screen reader can speak. */
function hasLabel(label: ReactNode): boolean {
	return label !== null && label !== undefined && label !== false && label !== '';
}

/**
 * Idle, pending, success and error faces in one grid cell, so the button
 * keeps its widest face's width. Only the shown face names the button for
 * assistive tech; a pending face with no label (a bare spinner) leaves the
 * idle label as the name, so the button is never nameless.
 */
function Faces({ status, labels, children }: { status: ButtonStatus; labels: FaceLabels; children: ReactNode }) {
	const spoken = status !== 'idle' && hasLabel(labels[status]) ? status : 'idle';

	return (
		<span data-ui="button-faces">
			<span data-face="idle" data-on={status === 'idle'} aria-hidden={spoken !== 'idle'}>
				{children}
			</span>
			<span data-face="pending" data-on={status === 'pending'} aria-hidden={spoken !== 'pending'}>
				<Spinner size={13} />
				{labels.pending}
			</span>
			<span data-face="success" data-on={status === 'success'} aria-hidden={spoken !== 'success'}>
				<Check />
				{labels.success}
			</span>
			<span data-face="error" data-on={status === 'error'} aria-hidden={spoken !== 'error'}>
				<X />
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
