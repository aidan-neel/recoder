import { autoReview } from './docs-pages/auto-review';
import { configuration } from './docs-pages/configuration';
import { gettingStarted } from './docs-pages/getting-started';
import { gitHosts } from './docs-pages/git-hosts';
import { guidelines } from './docs-pages/guidelines';
import { howReviewsWork } from './docs-pages/how-reviews-work';
import { models } from './docs-pages/models';
import { prComments } from './docs-pages/pr-comments';
import { reviewing } from './docs-pages/reviewing';
import { settings } from './docs-pages/settings';
import { troubleshooting } from './docs-pages/troubleshooting';
import { webhooks } from './docs-pages/webhooks';

export interface DocPage {
	slug: string;
	title: string;
	body: string;
}

/** Docs pages in nav order, one module each under `docs-pages/`. Bodies are GFM Markdown rendered by the kit's Markdown. */
export const docs: DocPage[] = [
	gettingStarted,
	gitHosts,
	models,
	reviewing,
	howReviewsWork,
	guidelines,
	autoReview,
	webhooks,
	prComments,
	settings,
	configuration,
	troubleshooting
];

export function docBySlug(slug: string): DocPage | undefined {
	return docs.find((doc) => doc.slug === slug);
}

/** A page's first paragraph as plain text, for its meta description: links keep their text, code and bold marks go. */
export function docSummary(doc: DocPage): string {
	const [first = ''] = doc.body.split('\n');

	return first
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/`([^`]*)`/g, '$1')
		.replace(/\*\*([^*]+)\*\*/g, '$1');
}
