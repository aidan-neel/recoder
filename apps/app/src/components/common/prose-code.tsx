'use client';

import type { PullCommit } from '@recoder/shared';
import { FileChip, Icon, InlineCode, Markdown } from '@recoder/ui';
import { createContext, use, useMemo } from 'react';

import { shortSha } from '@/lib/files/ref-label';
import { markFileRefs, readProseRef, type FileRef, type ProseSources } from '@/lib/summary/prose-refs';

/** What a pull request's prose may name, how a file it names opens, and which forge its `@mentions` link to. */
export interface ProseRefs {
	sources: ProseSources;
	/** Opens the Changes tab at the file, at the line when the prose gave one. */
	openFile: (path: string, line: number | null) => void;
	/** The forge origin (`https://github.com`, a self-hosted GitLab host), or null on a local repository. */
	forgeOrigin: string | null;
}

/** Null outside a pull request's page, where inline code stays code. */
export const ProseRefsContext = createContext<ProseRefs | null>(null);

const NO_PATHS: readonly string[] = [];

/** A commit as a badge: its short hash, its title on hover, and its page on the forge when it has one. */
function CommitChip({ commit }: { commit: PullCommit }) {
	const mark = (
		<>
			<Icon name="commit" />
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

/** A changed file the prose names, as the kit's file chip: its mark, its name and lines, opening Changes there. */
export function FileRefChip({ file }: { file: FileRef }) {
	const refs = use(ProseRefsContext);

	return (
		<FileChip
			path={file.path}
			line={file.lines}
			framed
			onClick={refs ? () => refs.openFile(file.path, file.line) : undefined}
		/>
	);
}

/**
 * Inline code in a pull request's prose: a file the pull request changes becomes its chip, one of its commits a badge
 * with its hash, and anything else stays code.
 */
export function ProseCode({ code }: { code: string }) {
	const refs = use(ProseRefsContext);
	const named = refs ? readProseRef(code, refs.sources) : null;

	if (!named) return <InlineCode>{code}</InlineCode>;
	if (named.kind === 'commit') return <CommitChip commit={named.commit} />;

	return <FileRefChip file={named} />;
}

/** The changed paths the page's prose may name; none outside a pull request's page. */
export function useChangedPaths(): readonly string[] {
	return use(ProseRefsContext)?.sources.paths ?? NO_PATHS;
}

/**
 * Model-written Markdown that names files in its running text as well as in code (a finding's explanation, its fix):
 * every changed file it names, written either way, draws as that file's chip.
 */
export function FileRefProse({ children, className }: { children: string; className?: string }) {
	const paths = useChangedPaths();
	const marked = useMemo(() => markFileRefs(children, paths), [children, paths]);

	return (
		<Markdown inlineCode={ProseCode} className={className}>
			{marked}
		</Markdown>
	);
}
