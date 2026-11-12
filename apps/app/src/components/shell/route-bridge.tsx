'use client';

import { preloadHighlighter, whenIdle } from '@recoder/ui';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

import { whenSettled } from '@/lib/shell/idle';
import {
	onSettings,
	opensInPlace,
	queueHref,
	reviewHref,
	reviewId,
	SAMPLE_REVIEW_HREF,
	SETTINGS_HREF
} from '@/lib/shell/routes';
import { focusPageFromBar } from '@/lib/shell/selected-focus';
import { useShell } from '@/lib/shell/shell-store';
import { showSkeletonsAfterNavigation } from '@/lib/shell/skeleton-handoff';
import { routeWaits } from '@/lib/shell/stuck-route';

type Router = ReturnType<typeof useRouter>;

/** The router's prefetch kinds, named by its own `prefetch` signature. */
type PrefetchKind = NonNullable<Parameters<Router['prefetch']>[1]>['kind'];

/**
 * A prefetch of the whole page. The default fetches a dynamic route only up
 * to a loading boundary, and with none (there are no loading files) nothing
 * of the page; every page here is a thin client component, so its payload
 * is small.
 */
const FULL = { kind: 'full' as PrefetchKind };

/** The open tabs' ids as one string, so the selector stays equal while a tab only changes its count or title. */
function tabIds(state: { tabs: { id: string }[] }): string {
	return state.tabs.map((tab) => tab.id).join('\n');
}

/**
 * Every page the top bar leads to from `pathname`: the queue, each open
 * review and settings, less the page on screen. With no review tab open,
 * the sample review's page stands in, so the review page's code is in
 * before the first review opens from the queue.
 */
function barTargets(pathname: string, ids: string): string[] {
	const reviews = ids ? ids.split('\n').map(reviewHref) : [SAMPLE_REVIEW_HREF];
	const targets = [queueHref(pathname), ...reviews, ...(onSettings(pathname) ? [] : [SETTINGS_HREF])];

	return targets.filter((href) => href !== pathname);
}

/** The longest the highlighter's preload waits for an idle moment after the review page's code is in. */
const HIGHLIGHTER_IDLE_MS = 2000;

/** The review page's code, once its preload has started; a failed load is forgotten, so the next settle loads it again. */
let reviewCode: Promise<void> | null = null;

/**
 * Loads the review page's code with the Markdown parser its read asks for
 * (`prepare-brief`), then highlight.js's core, ahead of the first review
 * opened from this page: the router's prefetch brings a page's payload, not
 * its code, so without this the first open fetches and runs the review
 * page's scripts on the click and commits late. The code and the highlighter
 * each load in their own idle moment. While a route still waits for its page
 * it waits for the next settle, so a failed load never reads as that page's
 * lost code (`watchStuckRoute`).
 */
function preloadReviewCode(): void {
	if (routeWaits()) return;

	reviewCode ??= Promise.all([import('./review-route'), import('@/lib/review/prepare-brief')]).then(
		() => void whenIdle(() => void preloadHighlighter(), HIGHLIGHTER_IDLE_MS),
		() => {
			reviewCode = null;
		}
	);
}

/**
 * Prefetches the pages the top bar leads to once the page has painted and
 * gone idle, so a tab click paints from the router's cache instead of waiting
 * on the server, and off a review page loads the review page's code
 * ({@link preloadReviewCode}). It waits for the page to settle
 * (`whenSettled`) on purpose: started sooner, these fetches compete with the
 * first paint's own requests. A tab clicked before then keeps the page on
 * screen while the router gets the new one, as usual. It runs again after
 * each navigation and whenever a tab opens or closes; a page still fresh in
 * the cache, or code already in, costs nothing. It goes through the store, as
 * a queue row's prefetch does. The router skips every prefetch in dev, where
 * each page compiles on its first visit instead.
 */
function useBarPrefetch(pathname: string): void {
	const ids = useShell(tabIds);

	useEffect(
		() =>
			whenSettled(() => {
				barTargets(pathname, ids).forEach((href) => useShell.getState().prefetch(href));

				if (!reviewId(pathname)) preloadReviewCode();
			}),
		[pathname, ids]
	);
}

/**
 * The page of this app that a click leaves to the router: a link followed
 * in place whose default the router took (Next's links prevent it, then
 * navigate), and that no handler of the app's took over first. One that did
 * started a navigation in the store, which changed the page arriving
 * (`before` is the one as the click began), or swapped the page in place, so
 * the address already shows the link's page.
 */
function routerLinkPath(event: MouseEvent, before: unknown): string | null {
	const link = event.target instanceof Element ? event.target.closest('a[href]') : null;

	if (!event.defaultPrevented || !opensInPlace(event) || useShell.getState().arriving !== before) return null;
	if (!(link instanceof HTMLAnchorElement) || (link.target !== '' && link.target !== '_self')) return null;

	const url = new URL(link.href);
	const swapped = url.pathname === window.location.pathname && url.pathname !== useShell.getState().pathname;

	return url.origin === window.location.origin && !swapped ? url.pathname : null;
}

/**
 * Tells the store of the navigations the router makes by itself, so they
 * count as the app's own do: a link the app leaves to the router (a notice's
 * link), and Back and Forward, which also close the overlays, even when only
 * the address's query changes. Back or Forward to another page notes that
 * page in `historyPath`, for the focus it gets as it shows.
 */
function useFollowRouter(historyPath: RefObject<string | null>): void {
	useEffect(() => {
		let before: unknown = null;

		const onClickStart = () => {
			before = useShell.getState().arriving;
		};

		const onClick = (event: MouseEvent) => {
			const path = routerLinkPath(event, before);

			if (path) useShell.getState().follow(path);
		};

		const onHistory = () => {
			const { closeOverlays, follow, pathname } = useShell.getState();

			historyPath.current = window.location.pathname === pathname ? null : window.location.pathname;
			closeOverlays();
			follow(window.location.pathname);
		};

		window.addEventListener('click', onClickStart, true);
		window.addEventListener('click', onClick);
		window.addEventListener('popstate', onHistory);

		return () => {
			window.removeEventListener('click', onClickStart, true);
			window.removeEventListener('click', onClick);
			window.removeEventListener('popstate', onHistory);
		};
	}, [historyPath]);
}

/**
 * The shell's link to the router. It hands the path, `router.push`,
 * `router.replace` and a whole-page `router.prefetch` to the shell store, so
 * the bar and the
 * overlays read them there and never re-render for an address write that
 * keeps the page (a review's `?item=`, which j and k move), and tells the
 * store of the navigations the router makes by itself. It renders nothing,
 * so its own renders cost nothing. A new page closes the overlays, and a
 * skeleton that takes the old page's place shows at once. A page that Back
 * or Forward brings takes focus left in the top bar (`focusPageFromBar`).
 */
export function RouteBridge() {
	const router = useRouter();
	const pathname = usePathname();
	const shown = useRef(pathname);
	const historyPath = useRef<string | null>(null);

	useLayoutEffect(() => {
		useShell.getState().setRoute(pathname);

		if (shown.current === pathname) return;

		const fromHistory = historyPath.current === pathname;

		shown.current = pathname;
		historyPath.current = null;
		useShell.getState().closeOverlays();
		showSkeletonsAfterNavigation();

		if (fromHistory) focusPageFromBar();
	}, [pathname]);

	useEffect(
		() =>
			useShell.getState().setNavigate({
				push: (href) => router.push(href),
				replace: (href) => router.replace(href, { scroll: false }),
				prefetch: (href) => router.prefetch(href, FULL)
			}),
		[router]
	);

	useFollowRouter(historyPath);
	useBarPrefetch(pathname);

	return null;
}
