'use client';

import { HoverList, Input } from '@recoder/ui';
import { Check, ChevronRight, Search } from 'lucide-react';
import { useRef, type CSSProperties } from 'react';

import type { FileTreeView, TreeRow } from '@/lib/changes/types';
import { useKeys } from '@/lib/shell/use-keys';

interface FileTreeProps {
	tree: FileTreeView;
	/** The file being read in the diff. */
	current: string | null;
	onOpenFile: (path: string) => void;
}

/** A row's indent, as the CSS variable the row's padding reads. */
function depthStyle(depth: number): CSSProperties {
	return { '--depth': depth } as CSSProperties;
}

/** A folder: it opens and shuts, and says how many files are under it. */
function FolderRow({ row, onToggle }: { row: Extract<TreeRow, { kind: 'folder' }>; onToggle: () => void }) {
	return (
		<button
			type="button"
			data-tree-row
			data-kind="folder"
			data-open={row.open || undefined}
			className="tree-row"
			style={depthStyle(row.depth)}
			aria-expanded={row.open}
			onClick={onToggle}
		>
			<ChevronRight aria-hidden className="tree-chevron" />
			<span className="tree-name">{row.label}</span>
			<span className="tree-end">{row.files}</span>
		</button>
	);
}

interface FileRowProps {
	row: Extract<TreeRow, { kind: 'file' }>;
	current: boolean;
	onOpen: () => void;
}

/** A file: its name, then a check once viewed, else its size; a dot when it has open bugs. */
function FileRow({ row, current, onOpen }: FileRowProps) {
	return (
		<button
			type="button"
			data-tree-row
			data-kind="file"
			data-change={row.change}
			data-viewed={row.viewed || undefined}
			data-current={current || undefined}
			className="tree-row"
			style={depthStyle(row.depth)}
			aria-current={current ? 'true' : undefined}
			title={row.id}
			onClick={onOpen}
		>
			<span className="tree-name">{row.name}</span>
			<span className="tree-end">
				{row.bugs > 0 ? <span className="tree-bug" role="img" aria-label={`${row.bugs} open bugs`} /> : null}
				{row.viewed ? <Check aria-label="Viewed" /> : null}
				{!row.viewed && row.additions > 0 ? <span data-sign="add">+{row.additions}</span> : null}
				{!row.viewed && row.deletions > 0 ? <span data-sign="del">−{row.deletions}</span> : null}
			</span>
		</button>
	);
}

/**
 * The changed files as a tree beside the diff. A click scrolls the diff to
 * the file; the row of the file being read is marked as the diff scrolls.
 * The field narrows the tree to matching paths; `t` focuses it.
 */
export function FileTree({ tree, current, onOpenFile }: FileTreeProps) {
	const field = useRef<HTMLInputElement | null>(null);

	useKeys({ t: () => field.current?.focus() });

	return (
		<>
			<Input
				ref={field}
				type="search"
				aria-label="Filter files"
				placeholder="Filter files"
				autoComplete="off"
				spellCheck={false}
				leading={<Search aria-hidden />}
				value={tree.filter}
				onChange={(event) => tree.setFilter(event.target.value)}
			/>
			<HoverList className="tree" itemSelector="[data-tree-row]" selectedSelector="[data-current]">
				{tree.rows.map((row) =>
					row.kind === 'folder' ? (
						<FolderRow key={`folder:${row.id}`} row={row} onToggle={() => tree.toggleFolder(row.id)} />
					) : (
						<FileRow key={`file:${row.id}`} row={row} current={row.id === current} onOpen={() => onOpenFile(row.id)} />
					)
				)}
				{tree.rows.length === 0 ? <p className="tree-empty">No file matches.</p> : null}
			</HoverList>
		</>
	);
}
