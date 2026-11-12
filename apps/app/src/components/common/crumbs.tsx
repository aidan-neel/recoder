import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Fragment } from 'react';

/** One part of a breadcrumb. A part with no `href` is plain text; the last part names the page. */
export interface Crumb {
	label: string;
	href?: string;
}

/** Where the page sits: links up the way, then the page itself in full ink. */
export function Crumbs({ parts }: { parts: Crumb[] }) {
	return (
		<nav aria-label="Breadcrumb" className="crumbs">
			{parts.map((part, index) => (
				<Fragment key={part.label}>
					{index > 0 ? <ChevronRight aria-hidden /> : null}
					{part.href ? <Link href={part.href}>{part.label}</Link> : null}
					{!part.href && index < parts.length - 1 ? <span>{part.label}</span> : null}
					{!part.href && index === parts.length - 1 ? <span aria-current="page">{part.label}</span> : null}
				</Fragment>
			))}
		</nav>
	);
}
