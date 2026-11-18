import { ArrowLeft, ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { docHref, type DocPage } from '~/lib/docs';

interface DocPagerProps {
	previous?: DocPage;
	next?: DocPage;
}

/** The links at the foot of a docs page to the pages before and after it, each under a quiet "Previous" or "Next". */
export function DocPager({ previous, next }: DocPagerProps) {
	return (
		<nav className="docs-pager" aria-label="Docs pages">
			{previous ? (
				<Link href={docHref(previous)} className="docs-pager-link">
					<span className="docs-pager-label">Previous</span>
					<span className="docs-pager-title">
						<ArrowLeft aria-hidden />
						{previous.title}
					</span>
				</Link>
			) : null}
			{next ? (
				<Link href={docHref(next)} className="docs-pager-link" data-side="next">
					<span className="docs-pager-label">Next</span>
					<span className="docs-pager-title">
						{next.title}
						<ArrowRight aria-hidden />
					</span>
				</Link>
			) : null}
		</nav>
	);
}
