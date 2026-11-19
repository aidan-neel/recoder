import type { ReactNode } from 'react';

interface ComposeGroupProps {
	title: string;
	/** How many rows the group holds, beside its title. */
	count?: number;
	children: ReactNode;
}

/** One titled group of the rows over New's composer. */
export function ComposeGroup({ title, count, children }: ComposeGroupProps) {
	return (
		<section className="compose-group" aria-label={title}>
			<h2 className="section-label">
				{title}
				{count === undefined ? null : <span className="compose-group-count">{count}</span>}
			</h2>
			{children}
		</section>
	);
}

/** The one quiet line a list shows in place of rows. */
export function ComposeEmpty({ children }: { children: ReactNode }) {
	return <p className="compose-empty">{children}</p>;
}
