'use client';

import { Button, cn } from '@recoder/ui';
import type { ReactNode } from 'react';

import { where } from '@/lib/review/labels';
import { useReview } from '@/lib/review/review-store';

/** The reading column for one decision or receipt: centred, with room under it for the decision bar. */
export function DetailArticle({ label, children }: { label: string; children: ReactNode }) {
	return (
		<article aria-label={label} className="decision-detail">
			{children}
		</article>
	);
}

/** The line above the title: tone, category, how it was proven, and the decided state at the far end. */
export function Kicker({ children }: { children: ReactNode }) {
	return <div className="mb-3.5 flex min-h-5 flex-wrap items-center gap-x-2.5 gap-y-1.5">{children}</div>;
}

/** Quiet text in the kicker row. */
export function KickerText({ children, className }: { children: ReactNode; className?: string }) {
	return <span className={cn('text-[12.5px] text-fg-subtle', className)}>{children}</span>;
}

/** A titled part of a detail: How it breaks, Evidence, Code. */
export function DetailSection({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section aria-label={title} className="mt-9">
			<h3 className="mb-3 text-[12.5px] font-medium text-fg-subtle">{title}</h3>
			{children}
		</section>
	);
}

interface WhereProps {
	file: string;
	line: number | null;
	endLine?: number | null;
	symbol: string | null;
}

/** The place classes shared by the button and the plain line, so both sit at the same spot. */
const WHERE = '-mx-1.5 mt-2 h-6 max-w-full gap-2.5 px-1.5 font-mono text-[12px] font-normal text-fg-subtle';

/**
 * `src/a.ts:12  symbol` in mono under the title. It opens the whole file when
 * the diff holds it; a place outside the diff is plain text.
 */
export function WhereButton({ file, line, endLine = null, symbol }: WhereProps) {
	const inDiff = useReview((state) => state.files.some((item) => item.path === file));

	const label = (
		<>
			<span className="truncate">{where(file, line, endLine)}</span>
			{symbol ? <span className="truncate text-fg-faint">{symbol}</span> : null}
		</>
	);

	if (!inDiff) return <div className={cn('flex w-fit items-center', WHERE)}>{label}</div>;

	return (
		<Button variant="ghost" className={WHERE} onClick={() => useReview.getState().select({ kind: 'file', path: file })}>
			{label}
		</Button>
	);
}
