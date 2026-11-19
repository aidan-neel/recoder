'use client';

import type { PullCommit } from '@recoder/shared';
import { FileIcon, InlineCode, Markdown } from '@recoder/ui';
import { GitCommitIcon } from '@phosphor-icons/react';
import { createContext, use } from 'react';

import { shortSha } from '@/lib/files/ref-label';
import { readProseRef, type ProseSources } from '@/lib/summary/prose-refs';

import { RefChip } from '@/components/common/ref-chip';

/** What the Summary's prose may name, and how a file it names opens. */
interface ProseRefs {
	sources: ProseSources;
	openFile: (path: string) => void;
}

/** Null outside the Summary, where inline code stays code. */
export const ProseRefsContext = createContext<ProseRefs | null>(null);

/** A commit as a badge: its short hash, its title on hover, and its page on the forge when it has one. */
function CommitChip({ commit }: { commit: PullCommit }) {
	const mark = (
		<>
			<GitCommitIcon aria-hidden />
			{shortSha(commit.sha)}
		</>
	);

	if (!commit.url) {
		return (
			<span className="ref-chip" title={commit.title}>
				{mark}
			</span>
		);
	}

	return (
		<a className="ref-chip" href={commit.url} target="_blank" rel="noreferrer" title={commit.title}>
			{mark}
		</a>
	);
}

/**
 * Inline code in the Summary: a file the pull request changes becomes a badge that opens it on the Changes tab,
 * one of its commits a badge with its hash, and anything else stays code.
 */
function ProseCode({ code }: { code: string }) {
	const refs = use(ProseRefsContext);
	const named = refs ? readProseRef(code, refs.sources) : null;

	if (!refs || !named) return <InlineCode>{code}</InlineCode>;
	if (named.kind === 'commit') return <CommitChip commit={named.commit} />;

	return (
		<RefChip
			icon={<FileIcon path={named.path} />}
			title={named.path}
			data-openable=""
			onClick={() => refs.openFile(named.path)}
		>
			{named.label}
		</RefChip>
	);
}

/** The Summary's Markdown: the review's account, the author's description and the conversation, with their badges. */
export function SummaryProse({ children }: { children: string }) {
	return <Markdown inlineCode={ProseCode}>{children}</Markdown>;
}
