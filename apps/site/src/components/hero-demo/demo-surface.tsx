'use client';

import { preloadHighlighter, TooltipProvider } from '@recoder/ui';
import { MotionConfig, useReducedMotion } from 'motion/react';
import { useCallback, useLayoutEffect, useState } from 'react';

import { PullOnTab } from '@/components/pull/pull-screen';
import { PullsScreen } from '@/components/pulls/pulls-screen';
import { ModelChip } from '@/components/shell/model-chip';
import { Sidebar } from '@/components/shell/sidebar';
import { ApiProvider } from '@/lib/api/client';

import { DemoFrame } from './demo-frame';
import { createDemo, DEMO_PULL, type DemoView } from './demo-script';
import { createPlayer, playWhileSeen } from './timeline';

interface DemoSurfaceProps {
	/** How far the stage scales the window down; motion measures layout moves through it. */
	scale: number;
	/**
	 * The window, which decides whether the run plays. It is the element, not
	 * a ref: on a return visit the cached chunk mounts this in the same commit
	 * as the window, before the window's ref is set.
	 */
	frame: HTMLDivElement | null;
}

/**
 * The app playing in the window: apps/app's sidebar, pull request list and
 * pull request page on a sample that lives in memory, run by the demo script
 * while the window is on screen. Reduced motion shows one still frame, the
 * pull request's bugs. The app renders in the browser only, so the server
 * paints the empty frame and this fills it after mount, fading in once. The
 * code highlighter and the TypeScript grammar the sample's code is in start
 * loading on mount, so the diff paints in color from its first frame.
 */
export function DemoSurface({ scale, frame }: DemoSurfaceProps) {
	const reduced = useReducedMotion() ?? false;
	const [view, setView] = useState<DemoView | null>(null);

	/** Layout moves (the sidebar's pill, a tab's line) measure in the window's own pixels, not the scaled page's. */
	const pagePoint = useCallback(
		(point: { x: number; y: number }) => ({ x: point.x / scale, y: point.y / scale }),
		[scale]
	);

	useLayoutEffect(() => {
		preloadHighlighter(['typescript']);

		const demo = createDemo(setView);

		if (reduced) return demo.settle();

		demo.reset();

		if (!frame) return;

		return playWhileSeen(createPlayer(demo.beats, demo.length), frame);
	}, [reduced, frame]);

	if (!view) return <DemoFrame />;

	return (
		<MotionConfig transformPagePoint={pagePoint}>
			<TooltipProvider>
				<DemoFrame shown={view.shown}>
					<ApiProvider key={view.loop} client={view.api}>
						<div className="app-frame">
							<Sidebar model={<ModelChip label="Sample model" state="ready" />} />
							{view.screen === 'list' ? <PullsScreen /> : <PullOnTab {...DEMO_PULL} tab={view.screen} />}
						</div>
					</ApiProvider>
				</DemoFrame>
			</TooltipProvider>
		</MotionConfig>
	);
}
