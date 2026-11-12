'use client';

import { preloadHighlighter } from '@recoder/ui';
import { usePathname } from 'next/navigation';
import { use, useMemo, useState } from 'react';

import { ReviewPage } from '@/components/review/review-page';
import { cachedReview } from '@/lib/review/review-cache';
import { firstLangs, grammarsFirst } from '@/lib/review/review-grammars';
import { beforeMount } from '@/lib/shell/mounted';
import { reviewId } from '@/lib/shell/routes';

/** The wait under way for a return visit's linked code: which review and item it is for, and what React waits on. */
let arrival: { key: string; done: Promise<void> } | null = null;

/** Languages whose grammar a return visit has already waited for and seen load. */
const loaded = new Set<string>();

/**
 * What a return visit (Back or Forward to a review the tab kept a copy of)
 * waits on before its page shows: the grammar of the code its address opens
 * at (`?item=`), for the short wait a first visit gives it (`grammarsFirst`).
 * The kept copy paints at once, so without this its code would paint plain,
 * then colored. The router keeps the page it leaves on screen meanwhile, as
 * for any page still on its way. A full page load (the app not mounted yet)
 * waits in the review's own load instead, under its skeleton.
 */
function returnWait(id: string): Promise<void> | null {
	if (typeof window === 'undefined' || beforeMount()) return null;

	const link = new URLSearchParams(window.location.search).get('item');

	if (!link) return null;

	const key = `${id}\n${link}`;

	if (arrival?.key === key) return arrival.done;

	const kept = cachedReview(id);
	const langs = kept ? firstLangs(kept.review, kept.files, link).filter((lang) => !loaded.has(lang)) : [];

	if (langs.length === 0) return null;

	void preloadHighlighter(langs).then(() => langs.forEach((lang) => loaded.add(lang)));
	arrival = { key, done: grammarsFirst(langs) };

	return arrival.done;
}

/**
 * The review route's page: the review its address names. A switch between
 * review tabs changes only the address (`goToTab`), so the route's own `id`
 * can name the review it first opened; the address wins. The page element is
 * kept while the review stays the same, so an address write that keeps it
 * (`?item=`) renders nothing below this. A return visit waits for its linked
 * code's grammar once, as the route first renders ({@link returnWait}).
 */
export function ReviewRoute({ id }: { id: string }) {
	const shown = reviewId(usePathname()) ?? id;
	const [wait] = useState(() => returnWait(shown));

	if (wait) use(wait);

	return useMemo(() => <ReviewPage key={shown} id={shown} />, [shown]);
}
