'use client';

import { Toaster, TooltipProvider } from '@recoder/ui';
import { MotionConfig } from 'motion/react';
import { usePathname, useRouter } from 'next/navigation';
import { Suspense, useEffect, type ReactNode } from 'react';

import { useQueue } from '@/lib/queue/queue-store';
import { useReview } from '@/lib/review/review-store';
import { openSettings } from '@/lib/settings/settings-url';
import { inSample, paletteScope } from '@/lib/shell/routes';
import { useShell } from '@/lib/shell/shell-store';
import { followSystemTheme } from '@/lib/shell/theme';
import { useKeys } from '@/lib/shell/use-keys';

import { SettingsModal } from '@/components/settings/settings-modal';

import { CommandPalette } from './command-palette';
import { ShellFrame } from './shell-frame';
import { ShortcutsModal } from './shortcuts-modal';
import { TopBar } from './top-bar';

/** Dialogs that give way to the palette and settings instead of keeping them shut. */
const YIELDING = ['command-dialog', 'command-bar-dialog'];

/**
 * True while a dialog other than the palette, the review bar and the
 * shortcuts sheet is open (a confirm, the handoff, a settings modal):
 * app-wide keys wait for it, so nothing runs behind it.
 */
function dialogOpen(): boolean {
	return [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some(
		(dialog) =>
			!YIELDING.includes(dialog.getAttribute('data-ui') ?? '') && !dialog.querySelector('[data-ui="shortcuts"]')
	);
}

/** Closes the overlays the palette and settings replace: the shortcuts sheet and the review bar. */
function closeLightOverlays(): void {
	useShell.getState().setShortcutsOpen(false);
	useShell.getState().setReviewBarOpen(false);
}

/** ⌘K opens the palette, closing the shortcuts and the review bar first; pressed again it closes. Another open dialog keeps it shut. */
function togglePalette(): void {
	const { paletteOpen, setPaletteOpen } = useShell.getState();

	if (dialogOpen()) return;

	closeLightOverlays();
	setPaletteOpen(!paletteOpen);
}

/** Toasts rise above the floating decision bar (54px tall, 20px over the canvas edge, 8px under the card) while it shows. */
const OVER_DECISION_BAR = { bottom: '5.625rem', right: '1rem' };

/** True while a review page shows a decision, so its floating bar holds the bottom of the reading pane. */
function useDecisionBar(): boolean {
	const review = paletteScope(usePathname()) === 'review';
	const deciding = useReview((state) => state.status === 'ready' && state.selection.kind === 'decision');

	return review && deciding;
}

/**
 * The frame every page sits in: the top bar, one canvas card, and the
 * overlays. Pages swap inside the card at once; the tab pill is the motion.
 * It keeps the queue watched from every page, for the Queue tab's count.
 */
export function AppShell({ children }: { children: ReactNode }) {
	const router = useRouter();
	const sample = inSample(usePathname());
	const decisionBar = useDecisionBar();

	useEffect(() => useShell.getState().setNavigate((href) => router.push(href)), [router]);
	useEffect(() => followSystemTheme(), []);
	useEffect(() => useQueue.getState().watch(sample), [sample]);

	useKeys({
		'mod+k': togglePalette,
		'?': () => useShell.getState().setShortcutsOpen(true),
		'mod+,': () => {
			if (dialogOpen()) return;

			useShell.getState().setPaletteOpen(false);
			closeLightOverlays();
			openSettings();
		}
	});

	return (
		<MotionConfig reducedMotion="user">
			<TooltipProvider>
				<div className="flex h-dvh flex-col overflow-hidden bg-chrome text-fg">
					<ShellFrame bar={<TopBar />}>{children}</ShellFrame>
					<CommandPalette />
					<ShortcutsModal />
					<Suspense fallback={null}>
						<SettingsModal />
					</Suspense>
					<Toaster offset={decisionBar ? OVER_DECISION_BAR : undefined} />
				</div>
			</TooltipProvider>
		</MotionConfig>
	);
}
