import type { ReactNode } from 'react';

import { ShellFrame } from '@/components/shell/shell-frame';

interface DemoFrameProps {
	/** The top bar's tabs, search and settings. */
	bar?: ReactNode;
	/** The page inside the canvas card. */
	children?: ReactNode;
	/** What floats over the whole window: the handoff. */
	overlay?: ReactNode;
	/** False while the loop fades the content out; the frame itself stays. */
	shown?: boolean;
}

/**
 * The app's own frame with the page in it, a layer over both, and an empty
 * frame on top that hides the rest until `shown`. The server paints the
 * empty frame; the review surface fills the one beneath after mount. Both
 * are pictures of the app, so the site keeps its own landmarks.
 */
export function DemoFrame({ bar, children, overlay, shown = false }: DemoFrameProps) {
	return (
		<>
			<ShellFrame picture bar={bar}>
				{children}
			</ShellFrame>
			<div className="demo-layer">{overlay}</div>
			<div data-shown={shown} className="demo-cover" aria-hidden>
				<ShellFrame picture />
			</div>
		</>
	);
}
