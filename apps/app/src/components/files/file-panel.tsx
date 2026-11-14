'use client';

import type { ChatTrailFile } from '@recoder/shared';
import { useState } from 'react';

import { forgeLabel } from '@/lib/connections/forges';
import { forgeFileUrl } from '@/lib/files/forge-file-url';
import { refLabel } from '@/lib/files/ref-label';
import { useRepo } from '@/lib/files/use-repo';
import { useRepoFile } from '@/lib/files/use-repo-file';
import { useRepoTree } from '@/lib/files/use-repo-tree';

import { FilePanelHeader } from './file-panel-header';
import { FileTreePane } from './file-tree-pane';
import { FileView } from './file-view';

interface FilePanelProps {
	repoId: string;
	/** The commit-ish the files are read at; the repository's default branch when omitted. */
	gitRef: string | undefined;
	/** The file being read, and the lines to point at. */
	reference: ChatTrailFile;
	onOpenFile: (file: ChatTrailFile) => void;
	onClose: () => void;
}

/**
 * A file beside the chat, as a small file explorer: the path on top (its folders reveal themselves in the tree),
 * the repository's tree on the left, which opens on the file's own folder and can be hidden, and the file's code on
 * the right with the cited lines marked. Another file in the tree, or another reference in the chat, swaps it.
 */
export function FilePanel({ repoId, gitRef, reference, onOpenFile, onClose }: FilePanelProps) {
	const repo = useRepo(repoId);
	const tree = useRepoTree(repoId, gitRef, reference.path);
	const file = useRepoFile(repoId, gitRef, reference.path);
	const [treeOpen, setTreeOpen] = useState(true);
	const [revealId, setRevealId] = useState<string | null>(null);
	const forgeUrl = repo ? forgeFileUrl({ repo, ref: gitRef, file: reference }) : null;
	const forgeName = repo && repo.provider !== 'local' ? forgeLabel(repo.provider) : null;
	const refName = refLabel(gitRef ?? repo?.defaultBranch ?? 'the default branch');

	/** Shows a folder of the path in the tree, which opens it if it was hidden. */
	function revealFolder(folder: string): void {
		tree.reveal(folder);
		setRevealId(folder);
		setTreeOpen(true);
	}

	return (
		<aside className="file-panel" aria-label="File">
			<FilePanelHeader
				path={reference.path}
				forgeUrl={forgeUrl}
				forgeName={forgeName}
				treeOpen={treeOpen}
				onToggleTree={() => setTreeOpen((current) => !current)}
				onRevealFolder={revealFolder}
				onClose={onClose}
			/>
			<div className="file-panel-body">
				{treeOpen ? (
					<FileTreePane
						tree={tree}
						selected={reference.path}
						revealId={revealId}
						onOpenFile={(path) => onOpenFile({ path })}
					/>
				) : null}
				<FileView reference={reference} file={file} refName={refName} onClose={onClose} />
			</div>
		</aside>
	);
}
