'use client';

import { useEffect } from 'react';

import { useReview } from '@/lib/review/review-store';
import { itemOf } from '@/lib/review/selection';
import { reviewHref } from '@/lib/shell/routes';

import { pullTitle } from './review-view';
import { usePageItems } from './use-page-items';

/** A held j moves the selection many times a second; the address follows once it rests. */
const ADDRESS_DELAY_MS = 200;

/** Writes the selected item into the address (`?item=`), replacing the entry, so Back still leaves the review. */
function writeItem(item: string | null): void {
	const url = new URL(window.location.href);

	if (item) url.searchParams.set('item', item);
	else url.searchParams.delete('item');

	if (url.href !== window.location.href) window.history.replaceState(null, '', url);
}

/**
 * Keeps the selection in the address, so a reload or a shared link opens the
 * same item. A link that named nothing in the review leaves the address as
 * soon as the page knows (on mount, or when the diff it waited for arrives),
 * so a reload never carries it again.
 */
function useSelectionAddress(): void {
	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const { status, link, selection } = useReview.getState();

		if (status === 'ready' && link === null) writeItem(itemOf(selection));

		const stop = useReview.subscribe((state, before) => {
			if (state.status !== 'ready' || state.link !== null) return;
			if (state.selection === before.selection && before.link === null) return;

			clearTimeout(timer);
			timer = setTimeout(() => writeItem(itemOf(state.selection)), ADDRESS_DELAY_MS);
		});

		return () => {
			clearTimeout(timer);
			stop();
		};
	}, []);
}

/**
 * Names the browser tab after the pull request, so open reviews and history
 * entries can be told apart. Next writes the route's static title into the
 * head again after the page mounts, so the name is put back whenever the head
 * changes, for as long as the address is still this review's.
 */
function useDocumentTitle(): void {
	const id = useReview((state) => state.review?.id ?? null);

	const title = useReview((state) =>
		state.review ? `#${state.review.prNumber} ${pullTitle(state.review, state.pull)} · Recoder` : null
	);

	useEffect(() => {
		if (!id || !title) return;

		const path = reviewHref(id);
		const name = title;

		function apply(): void {
			if (window.location.pathname === path && document.title !== name) document.title = name;
		}

		apply();

		const observer = new MutationObserver(apply);

		observer.observe(document.head, { childList: true, subtree: true, characterData: true });

		return () => observer.disconnect();
	}, [id, title]);
}

/**
 * The review page's ties to the world outside it: the palette's rows, the
 * address and the tab title. It renders nothing, so the changes it follows
 * never re-render the page.
 */
export function ReviewSync() {
	usePageItems();
	useSelectionAddress();
	useDocumentTitle();

	return null;
}
