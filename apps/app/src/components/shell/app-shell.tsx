'use client';

import { Keycap, toast, Toaster, TooltipProvider, useOpened } from '@recoder/ui';
import { MotionConfig } from 'motion/react';
import { usePathname } from 'next/navigation';
import {
	Activity,
	Suspense,
	useDeferredValue,
	useEffect,
	useLayoutEffect,
	useRef,
	useSyncExternalStore,
	type ComponentType,
	type ReactNode
} from 'react';

import { useReview } from '@/lib/review/review-store';
import { whenSettled } from '@/lib/shell/idle';
import { paletteScope, SETTINGS_HREF } from '@/lib/shell/routes';
import { parkFocusInBar, returnParkedFocus, type ParkedFocus } from '@/lib/shell/selected-focus';
import { lateArrival, useShell } from '@/lib/shell/shell-store';
import { showSkeletonsAfterNavigation } from '@/lib/shell/skeleton-handoff';
import { clearBootNotice, routeWaits, routeWaitsOnLostScript } from '@/lib/shell/stuck-route';
import { followSystemTheme } from '@/lib/shell/theme';
import { useKeys } from '@/lib/shell/use-keys';

import { BootBar } from './boot-bar';
import { LostPage } from './lost-page';
import { PageSkeleton } from './page-skeleton';
import { RouteBridge } from './route-bridge';
import { ShellFrame } from './shell-frame';
import { TopBar } from './top-bar';

/**
 * An overlay's code, fetched on first use or by the idle preload, which share
 * one fetch. It keeps the component once it is in and tells its subscribers.
 * A failed fetch (a lost chunk) is forgotten, so the next press fetches again
 * rather than failing on the same rejected promise.
 */
function overlayCode(load: () => Promise<ComponentType>) {
	let component: ComponentType | null = null;
	let pending: Promise<ComponentType> | null = null;
	let missed = 0;
	const listeners = new Set<() => void>();

	return {
		loaded: () => component,
		/** Counts a press whose load failed, and returns how many have. */
		missed: () => ++missed,
		subscribe: (listener: () => void) => {
			listeners.add(listener);

			return () => void listeners.delete(listener);
		},
		load: () => {
			pending ??= load().then(
				(loaded) => {
					component = loaded;
					listeners.forEach((listener) => listener());

					return loaded;
				},
				(error: unknown) => {
					pending = null;

					throw error;
				}
			);

			return pending;
		}
	};
}

type OverlayCode = ReturnType<typeof overlayCode>;

/** The palette and the shortcuts sheet load on first use, so no page pays for them before. */
const PALETTE = overlayCode(() => import('./command-palette').then((module) => module.CommandPalette));

const SHORTCUTS = overlayCode(() => import('./shortcuts-modal').then((module) => module.ShortcutsModal));

/** How long a failure toast with a button stays, long enough to reach it; one without stays 6 seconds. */
const RELOAD_TOAST_MS = 10_000;

const PLAIN_TOAST_MS = 6000;

function reloadPage(): void {
	window.location.reload();
}

/** The toast that says the overlay opened by `key` did not load, one per overlay. */
function failureToast(key: string): string {
	return `overlay-failed-${key}`;
}

/**
 * Says an overlay's code did not load. The next press of its key loads it
 * again, so the first failure says to press it again; once a second press
 * has failed too, it offers Reload, in the same toast rather than a second
 * one stacked on it.
 */
function overlayFailed(title: string, key: string, presses: number): void {
	const id = failureToast(key);

	if (presses > 1) {
		toast.error(title, {
			id,
			duration: RELOAD_TOAST_MS,
			description: undefined,
			action: { label: 'Reload', onClick: reloadPage }
		});

		return;
	}

	toast.error(title, {
		id,
		duration: PLAIN_TOAST_MS,
		description: (
			<>
				Press <Keycap k={key} aria-hidden={false} /> again.
			</>
		)
	});
}

function closePalette(): void {
	useShell.getState().setPaletteOpen(false);
}

function closeShortcuts(): void {
	useShell.getState().setShortcutsOpen(false);
}

/**
 * True while a dialog other than the palette and the shortcuts sheet is open
 * (a confirm, the handoff, a settings modal): app-wide keys wait for it, so
 * nothing runs behind it.
 */
function dialogOpen(): boolean {
	return [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some(
		(dialog) => dialog.getAttribute('data-ui') !== 'command-dialog' && !dialog.querySelector('[data-ui="shortcuts"]')
	);
}

/**
 * Escape pressed after ⌘K or ? but before the overlay is in the page (its
 * code and its deferred render take a frame or more) takes the request back,
 * so the overlay never mounts open after the key that should have closed it.
 * It runs ahead of the page's keys, so the review's own Escape does not run
 * too. Once the overlay is in the page, its dialog owns Escape, and so does
 * any other open dialog.
 */
function takeBackOverlay(event: KeyboardEvent): void {
	const { paletteOpen, shortcutsOpen, closeOverlays } = useShell.getState();

	if (event.key !== 'Escape' || event.defaultPrevented || (!paletteOpen && !shortcutsOpen)) return;
	if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;

	event.preventDefault();
	closeOverlays();
}

/** ⌘K opens the palette, closing the shortcuts first; pressed again it closes. Another open dialog keeps it shut. */
function togglePalette(): void {
	const { paletteOpen, setPaletteOpen, setShortcutsOpen } = useShell.getState();

	if (dialogOpen()) return;

	setShortcutsOpen(false);
	setPaletteOpen(!paletteOpen);
}

/** Toasts rise above the floating decision bar (54px tall, 20px over the canvas edge, 8px under the card) while it shows. */
const OVER_DECISION_BAR = { bottom: '5.625rem', right: '1rem' };

/**
 * The toasts, which rise above a review's floating decision bar while it
 * shows. Only this re-renders as the selection moves between a decision and
 * anything else.
 */
function ShellToaster() {
	const review = useShell((state) => paletteScope(state.pathname) === 'review');
	const deciding = useReview((state) => state.status === 'ready' && state.selection.kind === 'decision');

	return <Toaster offset={review && deciding ? OVER_DECISION_BAR : undefined} />;
}

/** Nothing to subscribe to: whether the app has taken over never changes after it has. */
function subscribe(): () => void {
	return () => {};
}

/**
 * False in the server's render and while the page hydrates, true from the
 * render right after: the app reads tabs, counts and decisions from local
 * storage, which the server cannot see, so until then the frame shows its
 * boot bar and the page's skeleton.
 */
function useBooted(): boolean {
	return useSyncExternalStore(
		subscribe,
		() => true,
		() => false
	);
}

/**
 * Fetches the overlays' code once the page has painted and gone idle, so the
 * first ⌘K or ? opens at once while no page's first paint carries it. One
 * pressed sooner fetches it then. While a route still waits for its page, it
 * waits for the next settled moment, so a failed preload never reads as that
 * page's lost code (`watchStuckRoute`). Returns the cleanup.
 */
function preloadOverlays(): () => void {
	let cancel = () => {};

	const load = () => {
		if (routeWaits()) {
			cancel = whenSettled(load);

			return;
		}

		PALETTE.load().catch(() => {});
		SHORTCUTS.load().catch(() => {});
	};

	cancel = whenSettled(load);

	return () => cancel();
}

/**
 * The app has taken over: the boot watchdog stands down and its notice, if a
 * slow boot showed one, goes. A notice for a lost script stays while the
 * route still waits for its page, until `LostPage` settles it.
 */
function markMounted(): void {
	document.documentElement.setAttribute('data-mounted', '');

	if (!routeWaitsOnLostScript()) clearBootNotice();
}

interface OverlayProps {
	/** Asked for; it mounts the first time and stays mounted after, so it can animate out. */
	open: boolean;
	code: OverlayCode;
	/** The toast's title when its code does not load. */
	failure: string;
	/** The key that opens it, which the toast names. */
	shortcut: string;
	/** Takes the request back after a failed load, so the next press asks again. */
	close: () => void;
}

/** No overlay code in the server's render; overlays mount only once the app has taken over. */
function noCode(): null {
	return null;
}

/**
 * One overlay. Its code is usually in already (the idle preload); when it is
 * not, the overlay renders the moment it arrives. A load that fails says so
 * in a toast and closes the overlay, and the next press loads it again; the
 * toast goes once a press has loaded it.
 */
function Overlay({ open, code, failure, shortcut, close }: OverlayProps) {
	const opened = useOpened(open);
	const Component = useSyncExternalStore(code.subscribe, code.loaded, noCode);

	useEffect(() => {
		if (!open || Component) return;

		let live = true;

		code.load().then(
			() => toast.dismiss(failureToast(shortcut)),
			() => {
				if (!live) return;

				overlayFailed(failure, shortcut, code.missed());
				close();
			}
		);

		return () => {
			live = false;
		};
	}, [open, Component, code, failure, shortcut, close]);

	/* eslint-disable-next-line react-hooks/static-components -- the overlay's module, loaded once and kept, so its identity never changes */
	return opened && Component ? <Component /> : null;
}

/**
 * The palette, the shortcuts sheet and the toasts. The first two mount when
 * first opened, through a deferred value, so the key press itself renders
 * nothing heavy and the overlay mounts in the render right after. The toasts
 * cost nothing until one shows.
 */
function Overlays() {
	const palette = useDeferredValue(useShell((state) => state.paletteOpen));
	const shortcuts = useDeferredValue(useShell((state) => state.shortcutsOpen));

	return (
		<>
			<Overlay open={palette} code={PALETTE} failure="Couldn’t open search." shortcut="mod+k" close={closePalette} />
			<Overlay
				open={shortcuts}
				code={SHORTCUTS}
				failure="Couldn’t open the shortcuts."
				shortcut="?"
				close={closeShortcuts}
			/>
			<ShellToaster />
		</>
	);
}

/**
 * The page in the canvas. With no loading files, the router keeps the page
 * a navigation leaves on screen until the new one can show whole; once that
 * has taken longer than the store's wait (`arriving`), the new page's
 * skeleton takes the old page's place, at full opacity at once since it
 * replaces a page the person was looking at, and inert, so its settings nav
 * never swaps a section in under a navigation still under way. The old page
 * stays mounted but hidden, keeping its state, and shows again if the
 * navigation is dropped. Focus it held waits in the top bar meanwhile, and
 * goes back to it or on to the new page after (`parkFocusInBar`,
 * `returnParkedFocus`). The router's own path decides when the skeleton
 * goes, so the render that brings the new page also shows it; only the path
 * is read, which an address write that keeps the page (`?item=`) leaves
 * alone. A page whose code is still on its way when the app takes over a
 * full load shows its skeleton meanwhile (the fallback). A navigation shows
 * it only after the shell's skeleton, which it matches: React counts a
 * boundary that was hidden as new, so the commit can bring the fallback
 * first. Otherwise the router renders a navigation as a transition, which
 * keeps what is on screen.
 */
function ShellPage({ children }: { children: ReactNode }) {
	const pathname = usePathname();
	const late = useShell(lateArrival);
	const waiting = late !== null && late !== pathname;
	const parked = useRef<ParkedFocus | null>(null);

	useLayoutEffect(() => {
		if (!waiting) {
			returnParkedFocus(parked.current);
			parked.current = null;

			return;
		}

		showSkeletonsAfterNavigation();
		parked.current = parkFocusInBar();
	}, [waiting]);

	return (
		<>
			<Activity mode={waiting ? 'hidden' : 'visible'}>
				<Suspense fallback={<PageSkeleton />}>{children}</Suspense>
			</Activity>
			{waiting ? (
				<div inert className="contents">
					<PageSkeleton path={late} />
				</div>
			) : null}
		</>
	);
}

/**
 * The frame every page sits in: the top bar, one canvas card, and the
 * overlays. The server paints the frame with a boot bar and the page's
 * skeleton, so the first frame is already the app; once hydrated, the
 * interactive bar and the page take their places on the same pixels and
 * `<html>` gets `data-mounted`, which stands the boot watchdog down. The
 * page's own skeleton keeps the boot skeleton's clock (`handOffOnLeave`), so
 * it never waits out a second hold. Pages swap inside the card at once; the
 * tab pill is the motion. Only `RouteBridge` and `ShellPage` read the
 * router, and the page only its path, so nothing here renders on an address
 * write that keeps the page.
 */
export function AppShell({ children }: { children: ReactNode }) {
	const booted = useBooted();

	useEffect(() => followSystemTheme(), []);

	useEffect(() => {
		window.addEventListener('keydown', takeBackOverlay, true);

		return () => window.removeEventListener('keydown', takeBackOverlay, true);
	}, []);

	useEffect(() => {
		if (!booted) return;

		markMounted();

		return preloadOverlays();
	}, [booted]);

	useKeys({
		'mod+k': togglePalette,
		'?': () => useShell.getState().setShortcutsOpen(true),
		'mod+,': () => {
			if (dialogOpen()) return;

			const { closeOverlays, navigate } = useShell.getState();

			closeOverlays();
			navigate(SETTINGS_HREF);
		}
	});

	return (
		<MotionConfig reducedMotion="user">
			<TooltipProvider>
				<div className="flex h-dvh flex-col overflow-hidden bg-chrome text-fg">
					<RouteBridge />
					<ShellFrame bar={booted ? <TopBar /> : <BootBar />}>
						{booted ? (
							<LostPage>
								<ShellPage>{children}</ShellPage>
							</LostPage>
						) : (
							<PageSkeleton page={children} />
						)}
					</ShellFrame>
					{booted ? <Overlays /> : null}
				</div>
			</TooltipProvider>
		</MotionConfig>
	);
}
