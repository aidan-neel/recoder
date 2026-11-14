'use client';

import {
	CommandDialog,
	CommandEmpty,
	CommandFooter,
	CommandInput,
	CommandItem,
	CommandList,
	ComposerTool,
	focusComposerField,
	type CommandHint
} from '@recoder/ui';
import { FileDiff, Plus } from 'lucide-react';
import { useRef, useState } from 'react';

import { useSessionData } from '@/lib/pull/pull-session';

const HINTS: CommandHint[] = [
	{ keys: ['ArrowUp', 'ArrowDown'], label: 'navigate' },
	{ keys: ['Enter'], label: 'add' },
	{ keys: ['Escape'], label: 'close' }
];

/**
 * The composer's "+": names one of the pull request's changed files in the
 * message. The chat takes text only, so a pick adds the file's path to what
 * is written; Recoder reads the file from the diff it already has. It waits
 * for the diff, and a pull request with no changed files offers nothing.
 */
export function AttachFile({ onAttach }: { onAttach: (path: string) => void }) {
	const [open, setOpen] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	const files = useSessionData((data) => (data.diff.phase === 'ready' ? data.diff.value.files : null));

	/** Adds the path and closes the dialog; focus goes back to the field with the caret at the end. */
	function attach(path: string): void {
		onAttach(path);
		setOpen(false);
	}

	return (
		<>
			<ComposerTool
				ref={trigger}
				label="Add a changed file"
				aria-haspopup="dialog"
				aria-expanded={open}
				disabled={!files || files.length === 0}
				onClick={() => setOpen(true)}
			>
				<Plus />
			</ComposerTool>
			<CommandDialog
				open={open}
				onOpenChange={setOpen}
				label="Add a changed file"
				className="attach-dialog"
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					focusComposerField(trigger.current);
				}}
			>
				<CommandInput placeholder="Search changed files" />
				<CommandList>
					{(files ?? []).map((file) => (
						<CommandItem
							key={file.path}
							value={file.path}
							icon={FileDiff}
							detail={<FileCounts additions={file.additions} deletions={file.deletions} />}
							onSelect={() => attach(file.path)}
						>
							{file.path}
						</CommandItem>
					))}
					<CommandEmpty>No changed file matches</CommandEmpty>
				</CommandList>
				<CommandFooter hints={HINTS} />
			</CommandDialog>
		</>
	);
}

/** Lines added and removed, in the diff's colours. */
function FileCounts({ additions, deletions }: { additions: number; deletions: number }) {
	return (
		<span className="attach-counts">
			<span className="text-ok">+{additions}</span> <span className="text-danger">−{deletions}</span>
		</span>
	);
}
