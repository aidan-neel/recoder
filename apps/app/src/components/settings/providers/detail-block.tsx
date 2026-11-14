import { useId, type ReactNode } from 'react';

interface DetailBlockProps {
	title: string;
	/** At the right of the title: a plan, a count. */
	aside?: ReactNode;
	children: ReactNode;
}

/** One titled block of the provider detail panel, set off from the next by a hairline. */
export function DetailBlock({ title, aside, children }: DetailBlockProps) {
	const titleId = useId();

	return (
		<section className="detail-block" aria-labelledby={titleId}>
			<div className="detail-block-head">
				<h3 id={titleId} className="detail-block-title">
					{title}
				</h3>
				{aside}
			</div>
			{children}
		</section>
	);
}
