'use client';

import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../../lib/cn';

interface CardProps extends HTMLAttributes<HTMLElement> {
	/** The element to render; use `section` or `article` when the card is a landmark or a self-contained item. */
	as?: 'div' | 'section' | 'article';
	className?: string;
	children: ReactNode;
}

/** A raised surface drawn with a 1px ring and no drop shadow: only menus and modals float. */
export function Card({ as: Tag = 'div', className, children, ...props }: CardProps) {
	return (
		<Tag
			data-ui="card"
			className={cn('rounded-[12px] bg-raised shadow-[0_0_0_1px_var(--line-card)]', className)}
			{...props}
		>
			{children}
		</Tag>
	);
}
