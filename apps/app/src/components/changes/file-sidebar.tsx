'use client';

import { SkeletonRows, Tree } from '@recoder/ui';
import { useMemo } from 'react';

import { useFileTree, useSideRows } from '@/lib/changes/use-changes';
import { usePullDiffView } from '@/lib/pull/pull-session';

import { PanelResizer } from '@/components/common/panel-resizer';

import { FileEnd } from './files-menu';

/** How many rows of bars stand in while the diff loads. */
const LOADING_ROWS = 8;

/** A tree row's height in px, so the bars stand on the rows' lines. */
const ROW_HEIGHT = 28;

interface FileSidebarProps {
	/** The file in view, marked as the diff scrolls. */
	current: string | null;
	onOpen: (path: string) => void;
}

/**
 * The changed files as a tree beside the diff, in the diff's order: each file with its finding dot and its size, or a
 * check once viewed. The file in view is marked as the diff scrolls; pressing a file brings it to the top. Bars stand
 * in while the diff loads, and a diff with no files has no sidebar.
 */
export function FileSidebar({ current, onOpen }: FileSidebarProps) {
	const diff = usePullDiffView();
	const tree = useFileTree();
	const { rows, toggleFolder } = useSideRows();

	const entries = useMemo(
		() => new Map(tree.groups.flatMap((group) => group.files).map((entry) => [entry.path, entry])),
		[tree.groups]
	);

	if (diff.phase === 'failed' || (diff.phase === 'ready' && rows.length === 0)) return null;

	return (
		<aside className="changes-side" aria-label="Changed files">
			{diff.phase === 'ready' ? (
				<Tree
					aria-label="Changed files"
					className="changes-tree"
					rows={rows}
					selectedId={current}
					onToggle={toggleFolder}
					onSelect={onOpen}
					end={(row) => {
						const entry = row.kind === 'file' ? entries.get(row.id) : undefined;

						return entry ? <FileEnd entry={entry} /> : null;
					}}
				/>
			) : (
				<SkeletonRows count={LOADING_ROWS} height={ROW_HEIGHT} lines={1} className="changes-tree" />
			)}
			<PanelResizer panel="changes" label="Resize the file sidebar" />
		</aside>
	);
}
