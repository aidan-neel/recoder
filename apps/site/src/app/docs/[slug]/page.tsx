import { Button, StaticMarkdown } from '@recoder/ui';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { docBySlug, docs, docSummary } from '~/lib/docs';
import { SITE_URL } from '~/lib/site';

/** Only the pages in `docs` exist; any other slug is a 404. */
export const dynamicParams = false;

export function generateStaticParams() {
	return docs.map((doc) => ({ slug: doc.slug }));
}

export async function generateMetadata({ params }: PageProps<'/docs/[slug]'>): Promise<Metadata> {
	const doc = docBySlug((await params).slug);

	if (!doc) return {};

	return {
		title: `${doc.title} · Recoder docs`,
		description: docSummary(doc),
		alternates: { canonical: `${SITE_URL}/docs/${doc.slug}` }
	};
}

/** One docs page: the title, the Markdown body and links to the pages before and after it. */
export default async function DocPage({ params }: PageProps<'/docs/[slug]'>) {
	const doc = docBySlug((await params).slug);

	if (!doc) notFound();

	const index = docs.indexOf(doc);
	const previous = docs[index - 1];
	const next = docs[index + 1];

	return (
		<article className="docs-column">
			<h1 className="docs-title">{doc.title}</h1>
			<StaticMarkdown className="docs-prose">{doc.body}</StaticMarkdown>
			<nav className="docs-pager" aria-label="Docs pages">
				{previous ? (
					<Button asChild variant="ghost">
						<Link href={`/docs/${previous.slug}`}>
							<ArrowLeft aria-hidden />
							{previous.title}
						</Link>
					</Button>
				) : null}
				{next ? (
					<Button asChild variant="ghost" className="ml-auto">
						<Link href={`/docs/${next.slug}`}>
							{next.title}
							<ArrowRight aria-hidden />
						</Link>
					</Button>
				) : null}
			</nav>
		</article>
	);
}
