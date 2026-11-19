import { cli } from './docs-pages/cli';
import { gettingStarted } from './docs-pages/getting-started';
import { mcp } from './docs-pages/mcp';
import { server } from './docs-pages/server';
import { splitSections } from './doc-sections';
import { REPO_URL } from './site';

export interface DocPage {
	slug: string;
	title: string;
	body: string;
}

/** A place the nav and the search lead to: a page, with the sections it has. */
export interface NavPage {
	href: string;
	title: string;
	sections: { id: string; title: string }[];
}

/** Docs pages in nav order, one module each under `docs-pages/`. Bodies are GFM Markdown rendered by the kit's Markdown. */
export const docs: DocPage[] = [gettingStarted, server, cli, mcp];

export function docBySlug(slug: string): DocPage | undefined {
	return docs.find((doc) => doc.slug === slug);
}

export function docHref(doc: DocPage): string {
	return `/docs/${doc.slug}`;
}

/**
 * The docs pages as the nav and the search list them: titles and section
 * headings only, so the client never loads a page's body to draw its nav.
 */
export const DOC_NAV: NavPage[] = docs.map((doc) => ({
	href: docHref(doc),
	title: doc.title,
	sections: splitSections(doc.body).sections.map(({ id, title }) => ({ id, title }))
}));

/** Where a page's Markdown is edited on GitHub: its module under `docs-pages/`, named after its slug. */
export function docEditUrl(doc: DocPage): string {
	return `${REPO_URL}/edit/main/apps/site/src/lib/docs-pages/${doc.slug}.ts`;
}

/** A page as one Markdown document, for Copy page: its title as the heading, then its body. */
export function docMarkdown(doc: DocPage): string {
	return `# ${doc.title}\n\n${doc.body}\n`;
}

/** A page's first paragraph as plain text, for its meta description: links keep their text, code and bold marks go. */
export function docSummary(doc: DocPage): string {
	const [first = ''] = doc.body.split('\n');

	return first
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/`([^`]*)`/g, '$1')
		.replace(/\*\*([^*]+)\*\*/g, '$1');
}
