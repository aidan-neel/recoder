import { StaticMarkdown } from '@recoder/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { DocBar } from '~/components/docs/doc-bar';
import { DOC_CODE } from '~/components/docs/doc-code';
import { DocPager } from '~/components/docs/doc-pager';
import { splitSections } from '~/lib/doc-sections';
import { docBySlug, docEditUrl, docHref, docMarkdown, docs, docSummary } from '~/lib/docs';
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
		alternates: { canonical: `${SITE_URL}${docHref(doc)}` }
	};
}

/**
 * One docs page: the bar, the title and the intro, a section for each `##`
 * heading (its id is what the section list and the search link to, and the
 * heading links to it too), and links to the pages before and after it. The
 * page arrives top-down; sections further down rise in as they scroll into
 * view (`docs.css`).
 */
export default async function DocPage({ params }: PageProps<'/docs/[slug]'>) {
	const doc = docBySlug((await params).slug);

	if (!doc) notFound();

	const { intro, sections } = splitSections(doc.body);
	const index = docs.indexOf(doc);

	return (
		<>
			<DocBar
				title={doc.title}
				sections={sections.map(({ id, title }) => ({ id, title }))}
				markdown={docMarkdown(doc)}
				editUrl={docEditUrl(doc)}
			/>
			<article className="docs-column">
				<header className="docs-intro">
					<h1 className="docs-title">{doc.title}</h1>
					<StaticMarkdown className="docs-prose" code={DOC_CODE}>
						{intro}
					</StaticMarkdown>
				</header>
				{sections.map((section) => (
					<section key={section.id} id={section.id} className="docs-section">
						<h2 className="docs-heading">
							<a href={`#${section.id}`} className="docs-anchor">
								{section.title}
							</a>
						</h2>
						<StaticMarkdown className="docs-prose" code={DOC_CODE}>
							{section.body}
						</StaticMarkdown>
					</section>
				))}
				<DocPager previous={docs[index - 1]} next={docs[index + 1]} />
			</article>
		</>
	);
}
