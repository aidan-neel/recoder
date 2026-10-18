'use client';

import { TooltipProvider } from '@recoder/ui';
import { MotionConfig, useReducedMotion } from 'motion/react';
import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';

import { useQueue } from '@/lib/queue/queue-store';
import { useReview } from '@/lib/review/review-store';

import { DemoFrame } from './demo-frame';
import { DemoHandoff } from './demo-handoff';
import { DemoQueue } from './demo-queue';
import { DemoReview } from './demo-review';
import { createDemo, type DemoView } from './demo-script';
import { DemoTopBar } from './demo-top-bar';
import { createPlayer, playWhileSeen } from './timeline';

interface DemoSurfaceProps {
	/** How far the stage scales the window down; motion measures layout moves through it. */
	scale: number;
	/** The window, which decides whether the run plays. */
	frame: RefObject<HTMLDivElement | null>;
}

/**
 * The review surface playing in the window: apps/app's queue, review page
 * and handoff on the app's own stores, run by the demo script while the
 * window is on screen. Reduced motion shows one still frame, the overview
 * with the verdict. The stores only answer in the browser, so the server
 * paints the empty frame and this fills it after mount, fading in once.
 */
export function DemoSurface({ scale, frame }: DemoSurfaceProps) {
	const reduced = useReducedMotion() ?? false;
	const [view, setView] = useState<DemoView>({ copied: false, shown: false });
	const seeded = useQueue((state) => state.sample && state.status === 'ready');
	const reviewOpen = useReview((state) => state.status === 'ready');

	/** Layout moves (the rail highlight, the tab pill) measure in the window's own pixels, not the scaled page's. */
	const pagePoint = useCallback(
		(point: { x: number; y: number }) => ({ x: point.x / scale, y: point.y / scale }),
		[scale]
	);

	useLayoutEffect(() => {
		const demo = createDemo((patch) => setView((current) => ({ ...current, ...patch })));

		if (reduced) {
			demo.settle();

			return demo.dispose;
		}

		demo.reset();

		const element = frame.current;
		const stop = element ? playWhileSeen(createPlayer(demo.beats, demo.length), element) : null;

		return () => {
			stop?.();
			demo.dispose();
		};
	}, [reduced, frame]);

	if (!seeded) return <DemoFrame />;

	return (
		<MotionConfig transformPagePoint={pagePoint}>
			<TooltipProvider>
				<DemoFrame
					shown={reduced || view.shown}
					bar={<DemoTopBar reviewOpen={reviewOpen} />}
					overlay={<DemoHandoff copied={view.copied} />}
				>
					{reviewOpen ? <DemoReview /> : <DemoQueue />}
				</DemoFrame>
			</TooltipProvider>
		</MotionConfig>
	);
}
