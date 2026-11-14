'use client';

import { ChevronRight, File, Folder, FolderOpen } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent } from 'react';

import { cn } from '../../lib/cn';
import { Spinner } from '../spinner';
import { HoverList } from './hover-list';
import { treeKeyAction, type TreeRow } from './tree-keys';

export type { TreeRow };

interface TreeProps {
	/** The rows to show, top to bottom; the caller decides which folders are open. */
	rows: readonly TreeRow[];
	/** The chosen file. It is scrolled into view when it appears. */
	selectedId: string | null;
	/** A row to scroll to and focus, such as a folder named in a breadcrumb. */
	revealId?: string | null;
	onToggle: (id: string) => void;
	onSelect: (id: string) => void;
	'aria-label': string;
	className?: string;
}

/** The row element for an id, found by its data attribute. */
function rowElement(host: HTMLElement, id: string): HTMLElement | null {
	return host.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(id)}"]`);
}

/** A row's indent, as the CSS variable its padding reads. */
function depthStyle(depth: number): CSSProperties {
	return { '--depth': depth } as CSSProperties;
}

interface TreeItemProps {
	row: TreeRow;
	selected: boolean;
	tabbable: boolean;
	onPress: () => void;
}

/** A folder with its chevron and icon, or a file with its icon; a folder reading its contents shows a spinner. */
function TreeItem({ row, selected, tabbable, onPress }: TreeItemProps) {
	const folder = row.kind === 'folder';
	const FolderIcon = row.open ? FolderOpen : Folder;

	return (
		<button
			type="button"
			role="treeitem"
			data-tree-row
			data-tree-id={row.id}
			data-kind={row.kind}
			data-open={row.open || undefined}
			aria-level={row.depth + 1}
			aria-expanded={folder ? Boolean(row.open) : undefined}
			aria-selected={folder ? undefined : selected}
			aria-busy={row.loading || undefined}
			tabIndex={tabbable ? 0 : -1}
			style={depthStyle(row.depth)}
			onClick={onPress}
		>
			{folder ? <ChevronRight aria-hidden data-ui="tree-chevron" /> : <span data-ui="tree-gap" aria-hidden />}
			{folder ? <FolderIcon aria-hidden /> : <File aria-hidden />}
			<span data-ui="tree-label">{row.label}</span>
			{row.loading ? <Spinner size={12} /> : null}
		</button>
	);
}

/**
 * A tree of folders and files for browsing, such as a repository's. The
 * caller owns what is open and loaded and gives the visible rows; the tree
 * draws them and handles the keys of the tree pattern: arrows move between
 * rows, Right and Left open and shut folders, Home and End jump, Enter and
 * Space open a folder or choose a file. One row is a tab stop, the chosen
 * file's or the one last focused.
 */
export function Tree({ rows, selectedId, revealId = null, onToggle, onSelect, className, ...props }: TreeProps) {
	const host = useRef<HTMLDivElement | null>(null);
	const [focusId, setFocusId] = useState<string | null>(null);
	const hasSelected = rows.some((row) => row.id === selectedId);
	const hasReveal = rows.some((row) => row.id === revealId);
	const tabId = [focusId, selectedId].find((id) => rows.some((row) => row.id === id)) ?? rows[0]?.id;

	useEffect(() => {
		if (selectedId && host.current) rowElement(host.current, selectedId)?.scrollIntoView({ block: 'nearest' });
	}, [selectedId, hasSelected]);

	useEffect(() => {
		if (revealId && host.current) rowElement(host.current, revealId)?.focus();
	}, [revealId, hasReveal]);

	/** Remembers which row has focus, so the tab stop follows it. */
	function trackFocus(event: FocusEvent<HTMLElement>): void {
		if (event.target instanceof HTMLElement && event.target.dataset.treeId) setFocusId(event.target.dataset.treeId);
	}

	function handleKey(event: KeyboardEvent<HTMLElement>): void {
		if (!(event.target instanceof HTMLElement) || !event.target.dataset.treeId) return;

		const action = treeKeyAction(rows, event.target.dataset.treeId, event.key);

		if (!action) return;

		event.preventDefault();

		if (action.type === 'toggle') onToggle(action.id);
		else if (action.type === 'select') onSelect(action.id);
		else if (host.current) rowElement(host.current, action.id)?.focus();
	}

	return (
		<div ref={host} data-ui="tree" className={cn(className)}>
			<HoverList
				role="tree"
				itemSelector="[data-tree-row]"
				selectedSelector="[aria-selected='true']"
				onFocus={trackFocus}
				onKeyDown={handleKey}
				{...props}
			>
				{rows.map((row) => (
					<TreeItem
						key={row.id}
						row={row}
						selected={row.id === selectedId}
						tabbable={row.id === tabId}
						onPress={() => (row.kind === 'folder' ? onToggle(row.id) : onSelect(row.id))}
					/>
				))}
			</HoverList>
		</div>
	);
}
