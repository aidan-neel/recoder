'use client';

import {
	CommandDialog,
	CommandEmpty,
	CommandFooter,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	DiffStat,
	FileIcon,
	type CommandHint
} from '@recoder/ui';
import { CheckIcon } from '@phosphor-icons/react';

import type { FileEntry, FileGroup, GuidePart } from '@/lib/changes/types';

const HINTS: CommandHint[] = [
	{ keys: ['ArrowUp', 'ArrowDown'], label: 'move' },
	{ keys: ['Enter'], label: 'go to it' },
	{ keys: ['Escape'], label: 'close' }
];

interface Section {
	heading: string;
	files: FileEntry[];
}

/** The menu's sections: the files by folder, or in the guide's parts with each file listed once, in its first part. */
function sections(groups: FileGroup[], parts: GuidePart[] | null): Section[] {
	if (!parts) return groups.map((group) => ({ heading: group.folder || 'Top level', files: group.files }));

	const entries = new Map(groups.flatMap((group) => group.files).map((entry) => [entry.path, entry]));
	const listed = new Set<string>();

	return parts.map((part, index) => ({
		heading: `${index + 1}. ${part.title}`,
		files: part.paths.flatMap((path) => {
			const entry = entries.get(path);

			if (!entry || listed.has(path)) return [];

			listed.add(path);

			return [entry];
		})
	}));
}

/** The end of a file's row: a dot while it has open findings, then a check once viewed, else its size. */
function FileEnd({ entry }: { entry: FileEntry }) {
	return (
		<span className="file-end">
			{entry.bugs > 0 ? <span className="tree-bug" role="img" aria-label={`${entry.bugs} open findings`} /> : null}
			{entry.viewed ? (
				<CheckIcon aria-label="Viewed" />
			) : (
				<DiffStat additions={entry.additions} deletions={entry.deletions} />
			)}
		</span>
	);
}

interface FilesMenuProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	groups: FileGroup[];
	/** The guide's parts when the diff reads in the guide's order; null for the tree's. */
	parts: GuidePart[] | null;
	/** The file being read, selected when the menu opens. */
	current: string | null;
	onOpen: (path: string) => void;
}

/**
 * Every changed file in a search dialog, the way the diff reads: by folder,
 * or by the guide's parts. Typing narrows it by name or path, the arrows
 * move, Enter brings the file to the top of the diff.
 */
export function FilesMenu({ open, onOpenChange, groups, parts, current, onOpen }: FilesMenuProps) {
	return (
		<CommandDialog open={open} onOpenChange={onOpenChange} label="Go to a file" defaultValue={current ?? undefined}>
			<CommandInput placeholder="Go to a file" />
			<CommandList>
				<CommandEmpty>No file matches.</CommandEmpty>
				{sections(groups, parts).map((section) => (
					<CommandGroup key={section.heading} heading={section.heading}>
						{section.files.map((entry) => (
							<CommandItem
								key={entry.path}
								value={entry.path}
								keywords={[entry.name]}
								leading={<FileIcon path={entry.path} />}
								description={parts ? entry.path.slice(0, entry.path.lastIndexOf('/')) || undefined : undefined}
								detail={<FileEnd entry={entry} />}
								className={entry.change === 'deleted' ? 'files-menu-deleted' : undefined}
								onSelect={() => {
									onOpen(entry.path);
									onOpenChange(false);
								}}
							>
								{entry.name}
							</CommandItem>
						))}
					</CommandGroup>
				))}
			</CommandList>
			<CommandFooter hints={HINTS} />
		</CommandDialog>
	);
}
