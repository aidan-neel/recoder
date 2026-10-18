'use client';

import { motion, type HTMLMotionProps } from 'motion/react';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';
import { modalMotion, scrimMotion } from '../../motion/presets';
import { useMotionVariants } from '../../motion/reduced';

/** Widths of a modal panel: 24, 28, 36 and 42rem (Sivir's sm, md, lg and xl). */
export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

/** Variant names every overlay animates through: in from `closed`, out back to it. */
export const PRESENCE = { initial: 'closed', animate: 'open', exit: 'closed' } as const;

/** The panel title: 15px, 500, a hair of negative tracking. */
export const TITLE_CLASS =
	'text-[length:var(--font-size-title)] leading-[1.375] font-medium tracking-[-0.005em] text-balance text-fg';

/** The line under a title: body size, loose leading, subtle ink. */
export const DESCRIPTION_CLASS = 'text-[length:var(--font-size-body)] leading-[1.625] text-pretty text-fg-subtle';

const SIZES: Record<ModalSize, string> = {
	sm: 'max-w-[24rem]',
	md: 'max-w-[28rem]',
	lg: 'max-w-[36rem]',
	xl: 'max-w-[42rem]'
};

/**
 * Centered and fixed; `kit-overlay.css` owns the centering translate, so the
 * entrance transform composes on top of it. Content past the viewport scrolls.
 */
const PANEL = cn(
	'fixed top-1/2 left-1/2 flex w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] flex-col gap-4 p-5',
	'overflow-y-auto overscroll-contain rounded-[16px] bg-raised-2 text-fg shadow-(--shadow-modal) outline-none',
	'thin-scroll data-[state=closed]:pointer-events-none!'
);

/**
 * One modal's stacking context, holding its scrim and panel. A modal opened
 * from another one stacks wholly above it, so its scrim dims the first panel.
 * Popovers (130) and tooltips (140) still float over every modal.
 */
export function Layer(props: ComponentProps<'div'>) {
	return <div {...props} data-ui="modal-layer" className="relative z-[120]" />;
}

/** The scrim behind a modal: a flat `--scrim` wash with no blur, fading only. */
export function Scrim(props: HTMLMotionProps<'div'>) {
	return (
		<motion.div
			{...props}
			{...PRESENCE}
			data-ui="modal-overlay"
			variants={scrimMotion}
			className="fixed inset-0 bg-(--scrim) data-[state=closed]:pointer-events-none!"
		/>
	);
}

interface PanelProps extends HTMLMotionProps<'div'> {
	size: ModalSize;
}

/**
 * The modal surface shared by `ModalContent`, `ConfirmDialog` and
 * `InlineModal`. Radix renders through it with `asChild`. Under reduced
 * motion it only fades.
 */
export function Panel({ size, className, children, ...props }: PanelProps) {
	const variants = useMotionVariants(modalMotion);

	return (
		<motion.div
			{...props}
			{...PRESENCE}
			data-ui="modal-panel"
			data-size={size}
			variants={variants}
			className={cn(PANEL, SIZES[size], className)}
		>
			{children}
		</motion.div>
	);
}
