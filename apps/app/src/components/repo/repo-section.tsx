import { StatusNotice } from '@recoder/ui';
import type { ReactNode } from 'react';

interface RepoSectionProps {
	title: string;
	/** At the end of the title's line: a link onward or a quiet fact. */
	aside?: ReactNode;
	className?: string;
	children: ReactNode;
}

/** A titled part of the page: the title on its own line, the rows under a hairline. */
export function RepoSection({ title, aside, className, children }: RepoSectionProps) {
	return (
		<section className={className ? `repo-section ${className}` : 'repo-section'}>
			<div className="repo-section-head">
				<h2 className="repo-section-title">{title}</h2>
				{aside}
			</div>
			{children}
		</section>
	);
}

/** A part with nothing to list: one quiet line where the rows would be. */
export function RepoEmpty({ children }: { children: string }) {
	return <StatusNotice variant="inline" glyph={null} title={children} className="repo-empty" />;
}
