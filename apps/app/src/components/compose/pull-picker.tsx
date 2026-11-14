'use client';

import {
	Button,
	CommandDialog,
	CommandEmpty,
	CommandFooter,
	CommandInput,
	CommandItem,
	CommandList,
	focusComposerField,
	type CommandHint
} from '@recoder/ui';
import { Check, ChevronDown } from 'lucide-react';
import { useRef, useState } from 'react';

import { pickLabel } from '@/lib/compose/compose-pick';
import type { ComposePick } from '@/lib/compose/types';
import type { PullRow } from '@/lib/pulls/types';

import { PullMark } from '@/components/common/pull-mark';

const HINTS: CommandHint[] = [
	{ keys: ['ArrowUp', 'ArrowDown'], label: 'navigate' },
	{ keys: ['Enter'], label: 'choose' },
	{ keys: ['Escape'], label: 'close' }
];

interface PullPickerProps {
	/** The open pull requests the dialog searches. */
	rows: PullRow[];
	pick: ComposePick | null;
	onPick: (row: PullRow) => void;
}

/**
 * The pull request a review starts on, in the composer's bar beside the
 * repository: a quiet trigger with the pull mark and the pick, or "Choose a
 * pull request", opening a searchable dialog of the repository's open pull
 * requests with the current one checked. A pick puts the caret in the field,
 * where the brief goes next.
 */
export function PullPicker({ rows, pick, onPick }: PullPickerProps) {
	const [open, setOpen] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	const label = pick ? pickLabel(pick) : 'Choose a pull request';
	const pickedNumber = pick?.target.kind === 'pull' ? pick.target.number : null;

	/** Picks the pull request and closes the dialog. */
	function choose(row: PullRow): void {
		onPick(row);
		setOpen(false);
	}

	return (
		<>
			<Button
				ref={trigger}
				variant="quiet"
				className="bar-trigger pull-trigger"
				aria-haspopup="dialog"
				aria-expanded={open}
				aria-label={pick ? `Pull request: ${label}` : label}
				title={label}
				data-empty={pick ? undefined : ''}
				onClick={() => setOpen(true)}
			>
				<PullMark />
				<span className="bar-trigger-name">{label}</span>
				<ChevronDown aria-hidden className="bar-trigger-chevron" />
			</Button>
			<CommandDialog
				open={open}
				onOpenChange={setOpen}
				label="Pull request"
				className="pull-dialog"
				defaultValue={pickedNumber === null ? undefined : rowValue(rows, pickedNumber)}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					focusComposerField(trigger.current);
				}}
			>
				<CommandInput placeholder="Search pull requests" />
				<CommandList>
					{rows.map((row) => (
						<CommandItem
							key={row.key}
							value={itemValue(row)}
							keywords={[row.author]}
							onSelect={() => choose(row)}
							leading={<PullMark />}
							detail={row.number === pickedNumber ? <PickedMark number={row.number} /> : `#${row.number}`}
							className="pick-row"
						>
							{row.title}
						</CommandItem>
					))}
					<CommandEmpty>No pull request matches</CommandEmpty>
				</CommandList>
				<CommandFooter hints={HINTS} />
			</CommandDialog>
		</>
	);
}

/** What the dialog's search reads in a row: the number, then the title. */
function itemValue(row: PullRow): string {
	return `#${row.number} ${row.title}`;
}

/** The value of the row with `number`, so the dialog opens on it. */
function rowValue(rows: PullRow[], number: number): string | undefined {
	const row = rows.find((candidate) => candidate.number === number);

	return row ? itemValue(row) : undefined;
}

/** The chosen pull request's number with a check, named for a screen reader. */
function PickedMark({ number }: { number: number }) {
	return (
		<span className="pick-row-picked">
			#{number}
			<Check aria-hidden className="pick-row-check" />
			<span className="sr-only">Chosen</span>
		</span>
	);
}
