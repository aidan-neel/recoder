'use client';

import { Button, SkeletonRows } from '@recoder/ui';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';

import type { PullListView } from '@/lib/pulls/types';

/** How many placeholder rows stand in while the next page loads. */
const LOADING_ROWS = 3;

/** How far above the end of the list the next page starts to load, in px. */
const LOOKAHEAD_PX = 480;

/** The scroller the list sits in, which the end of the list is watched against. */
const SCROLLER_SELECTOR = '.page-scroll';

/**
 * Where the list ends: the next page loads as the end nears, placeholder rows
 * stand in while it does, and a failed page says so with a way to try again.
 * `rowCount` restarts the watch after each page, so a list that is still short
 * after a page keeps loading.
 */
export function PullsMore({ more, rowCount }: { more: PullListView['more']; rowCount: number }) {
	const end = useRef<HTMLDivElement | null>(null);
	const { load } = more;
	const watching = more.available && !more.loading && more.error === null;

	useEffect(() => {
		const element = end.current;

		if (!watching || !element) return;

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) load();
			},
			{ root: element.closest(SCROLLER_SELECTOR), rootMargin: `0px 0px ${LOOKAHEAD_PX}px 0px` }
		);

		observer.observe(element);

		return () => observer.disconnect();
	}, [watching, load, rowCount]);

	return (
		<>
			{more.loading ? <SkeletonRows count={LOADING_ROWS} height={60} glyph className="pull-list-skeleton" /> : null}
			{more.error !== null ? (
				<div className="strip" role="status">
					<TriangleAlert aria-hidden />
					<span className="strip-text">More pull requests did not load. {more.error}</span>
					<Button variant="outline" onClick={more.load}>
						Retry
					</Button>
				</div>
			) : null}
			{watching ? <div ref={end} aria-hidden className="pulls-end" /> : null}
		</>
	);
}
