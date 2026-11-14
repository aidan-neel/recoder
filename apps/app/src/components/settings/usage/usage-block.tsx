import { cn } from '@recoder/ui';
import { useId, type ReactNode } from 'react';

interface UsageBlockProps {
	title: string;
	/** At the right of the title: the block's own control, such as the Breakdown's grouping. */
	action?: ReactNode;
	/** A quiet line under the block: a limit on what its figures cover. */
	note?: ReactNode;
	className?: string;
	children: ReactNode;
}

/**
 * One titled part of the usage page. Unlike a settings group it has no card:
 * the page is figures and charts, so space, titles and hairlines group it.
 */
export function UsageBlock({ title, action, note, className, children }: UsageBlockProps) {
	const titleId = useId();

	return (
		<section className={cn('usage-block', className)} aria-labelledby={titleId}>
			<div className="usage-block-head">
				<h2 id={titleId} className="usage-block-title">
					{title}
				</h2>
				{action}
			</div>
			{children}
			{note ? <p className="usage-block-note">{note}</p> : null}
		</section>
	);
}
