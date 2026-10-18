import type { ReactNode } from 'react';

interface ShellFrameProps {
	/** What the 46px top bar holds: the tabs and search, then settings. */
	bar?: ReactNode;
	/** The page inside the canvas card. */
	children?: ReactNode;
	/**
	 * A picture of the app, such as the site's hero demo: plain boxes with no
	 * header or main landmark and no ids, so the page around it keeps its own.
	 */
	picture?: boolean;
}

/** The top bar over one canvas card, the frame every page sits in. */
export function ShellFrame({ bar, children, picture = false }: ShellFrameProps) {
	const Bar = picture ? 'div' : 'header';
	const Main = picture ? 'div' : 'main';

	return (
		<>
			<Bar data-ui="top-bar" className="flex h-[46px] shrink-0 items-center gap-1 bg-chrome pr-[10px] pl-2 select-none">
				{bar}
			</Bar>
			<Main id={picture ? undefined : 'app-canvas'} className="flex min-h-0 flex-1 px-2 pb-2">
				<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-line-canvas bg-canvas">
					{children}
				</div>
			</Main>
		</>
	);
}
