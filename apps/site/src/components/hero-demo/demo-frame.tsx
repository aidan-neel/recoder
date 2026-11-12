import type { ReactNode } from 'react';

interface DemoFrameProps {
	/** The app, once it has loaded. */
	children?: ReactNode;
	/** False while the loop fades the app out; the frame itself stays. */
	shown?: boolean;
}

/**
 * The app in the window's skin, under an empty frame that hides it until
 * `shown`. The server paints the empty frame; the app fills in beneath it
 * after mount. Both are pictures of the app, so the site keeps its own landmarks.
 */
export function DemoFrame({ children, shown = false }: DemoFrameProps) {
	return (
		<div className="app-skin demo-app">
			{children}
			<div data-shown={shown} className="demo-cover" aria-hidden>
				<div className="app-frame">
					<div className="sidebar" />
					<div className="page">
						<div className="page-bar" />
					</div>
				</div>
			</div>
		</div>
	);
}
