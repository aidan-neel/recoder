import type { ReactNode } from 'react';

import { Page } from './page';

interface ColumnPageProps {
	/** The page's name, shown in the bar. */
	title: string;
	/** The right of the bar: the page's own actions. */
	end?: ReactNode;
	children: ReactNode;
}

/** A page that is one reading column: its name in the bar, then groups that scroll. */
export function ColumnPage({ title, end, children }: ColumnPageProps) {
	return (
		<Page start={<h1 className="page-bar-title">{title}</h1>} end={end}>
			<div className="page-scroll">
				<div className="page-column" data-width="reading">
					{children}
				</div>
			</div>
		</Page>
	);
}
