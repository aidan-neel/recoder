'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';

import { DemoFrame } from './demo-frame';

/** The stage's width and the window's laid-out size (desktop, tablet or phone, set in CSS), in CSS px. */
interface Fit {
	stage: number;
	width: number;
	height: number;
}

/** Fits differ only after a resize; an equal one keeps the old object, so React skips the render. */
function sameFit(a: Fit | null, b: Fit): boolean {
	return a !== null && a.stage === b.stage && a.width === b.width && a.height === b.height;
}

/**
 * The review surface, in its own chunk: it renders in the browser only, so
 * the page's first load never waits on it. Until it arrives the window shows
 * its empty frame, which is also what the server paints.
 */
const DemoSurface = dynamic(() => import('./demo-surface').then((module) => module.DemoSurface), {
	ssr: false,
	loading: () => <DemoFrame />
});

/**
 * The window the home page's demo plays in. It is laid out at desktop size
 * and scaled down to fit the stage; a stage under 900px lays it out at
 * tablet size and one under 600px at phone size (container queries), each
 * at least as wide as the stage, so it shrinks less and never leaves a gap.
 * The window is inert: it shows the product, it does not take input.
 */
export function HeroDemo() {
	const stageRef = useRef<HTMLDivElement>(null);
	const windowRef = useRef<HTMLDivElement>(null);
	const [fit, setFit] = useState<Fit | null>(null);

	useEffect(() => {
		const stage = stageRef.current;
		const frame = windowRef.current;

		if (!stage || !frame) return;

		const observer = new ResizeObserver(() => {
			const next = { stage: stage.clientWidth, width: frame.offsetWidth, height: frame.offsetHeight };

			setFit((previous) => (sameFit(previous, next) ? previous : next));
		});

		observer.observe(stage);
		observer.observe(frame);

		return () => observer.disconnect();
	}, []);

	const scale = fit ? Math.min(1, fit.stage / fit.width) : 1;

	return (
		<div ref={stageRef} className="demo-stage" style={fit ? { height: fit.height * scale } : undefined}>
			<div ref={windowRef} className="demo-window" style={scale < 1 ? { scale } : undefined} inert>
				<DemoSurface scale={scale} frame={windowRef} />
			</div>
		</div>
	);
}
