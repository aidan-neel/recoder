'use client';

import { Button, CopyButton, Tooltip } from '@recoder/ui';
import { ArrowUpRight, ChevronRight, PanelLeft, X } from 'lucide-react';
import { Fragment } from 'react';

interface FilePanelHeaderProps {
	path: string;
	/** The file's address on its forge, or null when the repository has no forge to link to. */
	forgeUrl: string | null;
	forgeName: string | null;
	treeOpen: boolean;
	onToggleTree: () => void;
	/** Reveals a folder of the path in the tree. */
	onRevealFolder: (folder: string) => void;
	onClose: () => void;
}

/** The folders of a path, each with the path up to and including it. */
function folderCrumbs(path: string): { name: string; path: string }[] {
	const names = path.split('/').slice(0, -1);

	return names.map((name, index) => ({ name, path: names.slice(0, index + 1).join('/') }));
}

/** The 44px bar of the panel: the path as breadcrumbs, whose folders reveal themselves in the tree, then copy, open on the forge and close. */
export function FilePanelHeader({
	path,
	forgeUrl,
	forgeName,
	treeOpen,
	onToggleTree,
	onRevealFolder,
	onClose
}: FilePanelHeaderProps) {
	const fileName = path.slice(path.lastIndexOf('/') + 1);

	return (
		<header className="file-panel-head">
			<Tooltip content={treeOpen ? 'Hide files' : 'Show files'}>
				<Button
					variant="ghost"
					size="icon"
					aria-label={treeOpen ? 'Hide files' : 'Show files'}
					aria-expanded={treeOpen}
					onClick={onToggleTree}
				>
					<PanelLeft />
				</Button>
			</Tooltip>
			<nav aria-label="File path" className="file-crumbs">
				{folderCrumbs(path).map((folder) => (
					<Fragment key={folder.path}>
						<Button variant="ghost" className="file-crumb" onClick={() => onRevealFolder(folder.path)}>
							{folder.name}
						</Button>
						<ChevronRight aria-hidden />
					</Fragment>
				))}
				<span className="file-crumb-current" aria-current="page">
					{fileName}
				</span>
			</nav>
			<div className="file-panel-actions">
				<CopyButton value={path} label="Copy path" iconOnly />
				{forgeUrl ? (
					<Tooltip content={`Open on ${forgeName}`}>
						<Button asChild variant="ghost" size="icon">
							<a href={forgeUrl} target="_blank" rel="noreferrer" aria-label={`Open on ${forgeName}`}>
								<ArrowUpRight />
							</a>
						</Button>
					</Tooltip>
				) : null}
				<Tooltip content="Close" shortcut="Esc">
					<Button variant="ghost" size="icon" aria-label="Close file" onClick={onClose}>
						<X />
					</Button>
				</Tooltip>
			</div>
		</header>
	);
}
