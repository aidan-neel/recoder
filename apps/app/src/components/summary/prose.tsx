'use client';

import { GitHubMarkdown, Markdown } from '@recoder/ui';
import { use } from 'react';

import { ProseCode, ProseRefsContext } from '@/components/common/prose-code';

/** The Summary's model-written Markdown (overview, groups and notes), with file and commit badges. */
export function SummaryProse({ children }: { children: string }) {
	return <Markdown inlineCode={ProseCode}>{children}</Markdown>;
}

/** Forge-authored Markdown (the pull request's description and conversation), with sanitized GitHub HTML and badges. */
export function ForgeProse({ children }: { children: string }) {
	const refs = use(ProseRefsContext);

	return (
		<GitHubMarkdown inlineCode={ProseCode} forgeOrigin={refs ? refs.forgeOrigin : undefined}>
			{children}
		</GitHubMarkdown>
	);
}
