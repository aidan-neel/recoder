'use client';

import { Slot } from 'radix-ui';
import type { ButtonHTMLAttributes, Ref } from 'react';

import { cn } from '../../lib/cn';
import { pressOnce } from '../press-once';

interface RowButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	/** Render the child element (a Next `Link` or an anchor) with the row's look. */
	asChild?: boolean;
	/**
	 * Stretch the click target over the nearest positioned ancestor, so the
	 * whole row opens it while the button holds only the title. Controls that
	 * stay clickable sit above it with `position: relative` and `z-index: 1`.
	 * The focus ring then rings the whole row.
	 */
	cover?: boolean;
	ref?: Ref<HTMLButtonElement>;
}

/**
 * A list row that is one button or link: a left-aligned flex row with no fill
 * of its own, so a `HoverList` highlight shows through it, and the kit focus
 * ring. It sets no stacking context, so a highlight placed behind the rows
 * stays under every row's text. Mark rows with your own data attribute;
 * `data-ui` is the kit's styling hook. A held Enter presses it once.
 */
export function RowButton({
	asChild = false,
	cover = false,
	type = 'button',
	className,
	onKeyDown,
	ref,
	...props
}: RowButtonProps) {
	const hooks = {
		'data-ui': 'row-button',
		'data-cover': cover || undefined,
		className: cn(className),
		onKeyDown: pressOnce(onKeyDown)
	};

	if (asChild) return <Slot.Root ref={ref} {...hooks} {...props} />;

	return <button ref={ref} type={type} {...hooks} {...props} />;
}
