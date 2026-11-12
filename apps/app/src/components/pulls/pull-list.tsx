'use client';

import { HoverList } from '@recoder/ui';
import { useRef } from 'react';

import type { PullRow as PullRowView } from '@/lib/pulls/types';
import { useKeys } from '@/lib/shell/use-keys';

import { PullRow } from './pull-row';

interface PullListProps {
	rows: PullRowView[];
	starting: ReadonlySet<string>;
	onReview: (row: PullRowView) => void;
}

/** The link of every row, top to bottom. */
function rowLinks(list: HTMLElement | null): HTMLElement[] {
	return [...(list?.querySelectorAll<HTMLElement>('[data-row-link]') ?? [])];
}

/**
 * The rows, with `j` and `k` walking them (focus moves, so Enter opens the
 * row it rests on) and `r` reviewing that row.
 */
export function PullList({ rows, starting, onReview }: PullListProps) {
	const list = useRef<HTMLDivElement | null>(null);

	/** Moves focus `by` rows from the focused one; with none focused, to the first or the last. */
	function step(by: 1 | -1): void {
		const links = rowLinks(list.current);
		const at = links.findIndex((link) => link === document.activeElement);
		const resting = by === 1 ? 0 : links.length - 1;
		const next = at === -1 ? resting : Math.min(links.length - 1, Math.max(0, at + by));

		links[next]?.focus();
	}

	/** Reviews the pull request of the focused row, when it has one. */
	function reviewFocused(): boolean {
		const key = document.activeElement?.closest('[data-pull-row]')?.getAttribute('data-pull-row');
		const row = rows.find((candidate) => candidate.key === key);

		if (!row) return false;

		onReview(row);

		return true;
	}

	useKeys({ j: () => step(1), k: () => step(-1), r: reviewFocused });

	return (
		<div ref={list}>
			<HoverList as="ul" className="pull-list" itemSelector="[data-pull-row]" aria-label="Open pull requests">
				{rows.map((row) => (
					<PullRow key={row.key} row={row} starting={starting.has(row.key)} onReview={onReview} />
				))}
			</HoverList>
		</div>
	);
}
