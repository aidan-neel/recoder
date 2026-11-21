'use client';

import { githubClientParts } from './github-markdown-parts';
import { githubRehype, normalizeForgeOrigin } from './github-markdown-plugins';
import { MarkdownProse, type MarkdownProps } from './markdown-render';

/** Props for GitHub/forge Markdown: complete text from a PR description, comment or release notes. */
export interface GitHubMarkdownProps extends Omit<MarkdownProps, 'streaming'> {
	/**
	 * The forge origin for `@mention` links (defaults to `https://github.com`).
	 * Pass `null` when there is no forge host, such as a local repository.
	 */
	forgeOrigin?: string | null;
}

/**
 * GitHub Flavored Markdown with sanitized embedded HTML for forge content (pull request
 * descriptions, comments and release notes). Strips HTML comments and unsafe tags/attributes,
 * links `@mentions` to the forge, renders `<details>` through the kit's `Collapsible`, renders
 * theme-aware `<picture>` images and supports GitHub alert callouts.
 */
export function GitHubMarkdown({ children, linkOverride, inlineCode, forgeOrigin, ...props }: GitHubMarkdownProps) {
	const origin = normalizeForgeOrigin(forgeOrigin);

	return (
		<MarkdownProse
			{...props}
			parts={githubClientParts(linkOverride, inlineCode, origin)}
			rehypePlugins={githubRehype(origin)}
		>
			{children}
		</MarkdownProse>
	);
}
