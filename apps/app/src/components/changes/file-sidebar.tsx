'use client';

import { Icon, Input, Keycap, SkeletonRows, Tree } from '@recoder/ui';
import { useMemo, useState, type KeyboardEvent } from 'react';

import { foundLabel, foundTone } from '@/lib/bugs/tiers';
import { useFileTree, useSideRows } from '@/lib/changes/use-changes';
import type { FileChange, FileEntry } from '@/lib/changes/types';
import type { Chapter } from '@/lib/changes/chapters';
import { usePullDiffView } from '@/lib/pull/pull-session';

import { PanelResizer } from '@/components/common/panel-resizer';

import { ChapterOutline, outlineMatches } from './chapters';

/** How many rows of bars stand in while the diff loads. */
const LOADING_ROWS = 8;

/** A tree row's height in px, so the bars stand on the rows' lines. */
const ROW_HEIGHT = 28;

/** The letter a file's row ends in, as git names the change. */
const LETTERS: Record<FileChange, { letter: string; label: string }> = {
	added: { letter: 'A', label: 'Added' },
	modified: { letter: 'M', label: 'Modified' },
	deleted: { letter: 'D', label: 'Deleted' }
};

/** The end of a file's row: a dot while it has open findings, then the letter of its change. */
function TreeEnd({ entry }: { entry: FileEntry }) {
	const { letter, label } = LETTERS[entry.change];

	return (
		<span className="tree-end">
			{entry.found ? (
				<span className="tree-bug" data-tone={foundTone(entry.found)} role="img" aria-label={foundLabel(entry.found)} />
			) : null}
			<span className="tree-change" data-change={entry.change} title={label}>
				<span aria-hidden>{letter}</span>
				<span className="sr-only">{label}</span>
			</span>
		</span>
	);
}

/** The guide's outline in place of the tree, when the diff reads in the guide's order. */
interface Outline {
	chapters: Chapter[];
	/** The id of the hunk being read. */
	current: string | null;
	onOpen: (hunkId: string) => void;
}

interface FileSidebarProps {
	/** The file in view, marked as the diff scrolls. */
	current: string | null;
	onOpen: (path: string) => void;
	outline: Outline | null;
}

/**
 * The changed files as a tree beside the diff, in the diff's order, under a filter (`t` focuses it): each file with
 * its finding dot and the letter of its change, muted once viewed. The file in view is marked as the diff scrolls;
 * pressing a file brings it to the top. In the filter, Enter opens the first match, the down arrow moves into the
 * tree and Escape clears it. Bars stand in while the diff loads, and a diff with no files has no sidebar.
 */
export function FileSidebar({ current, onOpen, outline }: FileSidebarProps) {
	const diff = usePullDiffView();
	const tree = useFileTree();
	const [query, setQuery] = useState('');
	const { rows, toggleFolder } = useSideRows(query);

	const entries = useMemo(
		() => new Map(tree.groups.flatMap((group) => group.files).map((entry) => [entry.path, entry])),
		[tree.groups]
	);

	/** The filter's keys: Enter opens the first match, the down arrow enters the tree, Escape clears or leaves. */
	function onFilterKey(event: KeyboardEvent<HTMLInputElement>): void {
		const host = event.currentTarget.closest('.changes-side');

		if (event.key === 'Enter' && outline) {
			const first = outlineMatches(outline.chapters, query)[0]?.hunks[0];

			if (first) outline.onOpen(first.id);
		} else if (event.key === 'Enter') {
			const first = rows.find((row) => row.kind === 'file');

			if (first) onOpen(first.id);
		} else if (event.key === 'ArrowDown') {
			event.preventDefault();
			host?.querySelector<HTMLElement>(outline ? '[data-outline-row]' : '[role="treeitem"][tabindex="0"]')?.focus();
		} else if (event.key === 'Escape') {
			if (query) setQuery('');
			else event.currentTarget.blur();
		}
	}

	if (diff.phase === 'failed' || (diff.phase === 'ready' && tree.order.length === 0)) return null;

	return (
		<aside className="changes-side" aria-label={outline ? 'Chapters' : 'Changed files'}>
			<div className="changes-filter">
				<Input
					aria-label="Filter the changed files"
					aria-keyshortcuts="t"
					placeholder="Filter"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={onFilterKey}
					leading={<Icon name="search" />}
					trailing={query ? null : <Keycap k="t" />}
				/>
			</div>
			{diff.phase !== 'ready' ? (
				<SkeletonRows count={LOADING_ROWS} height={ROW_HEIGHT} lines={1} className="changes-tree" />
			) : null}
			{diff.phase === 'ready' && outline ? (
				<ChapterOutline chapters={outline.chapters} query={query} current={outline.current} onOpen={outline.onOpen} />
			) : null}
			{diff.phase === 'ready' && !outline && rows.length > 0 ? (
				<Tree
					aria-label="Changed files"
					className="changes-tree"
					rows={rows}
					selectedId={current}
					onToggle={toggleFolder}
					onSelect={onOpen}
					end={(row) => {
						const entry = row.kind === 'file' ? entries.get(row.id) : undefined;

						return entry ? <TreeEnd entry={entry} /> : null;
					}}
				/>
			) : null}
			{diff.phase === 'ready' && !outline && rows.length === 0 ? (
				<p className="changes-filter-empty">No file matches.</p>
			) : null}
			<PanelResizer panel="changes" label="Resize the file sidebar" />
		</aside>
	);
}
