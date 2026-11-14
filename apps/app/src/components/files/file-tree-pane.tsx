'use client';

import { Button, SkeletonRows, Tree } from '@recoder/ui';
import { RotateCcw } from 'lucide-react';

import type { RepoTreeView } from '@/lib/files/use-repo-tree';

interface FileTreePaneProps {
	tree: RepoTreeView;
	/** The path of the file being read. */
	selected: string;
	/** A folder to scroll to and focus, named by a breadcrumb. */
	revealId: string | null;
	onOpenFile: (path: string) => void;
}

const SKELETON_ROWS = 9;

const ROW_HEIGHT = 28;

/** The repository's folders and files beside the code: bars while the root loads, one line with Retry if it fails. */
export function FileTreePane({ tree, selected, revealId, onOpenFile }: FileTreePaneProps) {
	if (tree.phase === 'loading') {
		return (
			<nav className="file-tree" aria-label="Files">
				<SkeletonRows count={SKELETON_ROWS} height={ROW_HEIGHT} lines={1} rowClassName="file-tree-skeleton-row" />
			</nav>
		);
	}

	if (tree.phase === 'failed') {
		return (
			<nav className="file-tree file-state" aria-label="Files">
				<p>{tree.error}</p>
				<Button variant="outline" onClick={tree.retry}>
					<RotateCcw aria-hidden />
					Retry
				</Button>
			</nav>
		);
	}

	return (
		<nav className="file-tree" aria-label="Files">
			<Tree
				aria-label="Repository files"
				rows={tree.rows}
				selectedId={selected}
				revealId={revealId}
				onToggle={tree.toggle}
				onSelect={onOpenFile}
			/>
		</nav>
	);
}
