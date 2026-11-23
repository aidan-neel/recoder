'use client';

import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Tooltip } from '../overlay/tooltip';
import { DiffStat } from './diff-stat';
import { FileIcon } from './file-icon';

interface FileChipProps {
	/** The file's path in its repository. Its folder is shown only in the tooltip and to a screen reader. */
	path: string;
	/** What to show instead of the name, such as `core/Ky.ts` when two files in the same list share `Ky.ts`. It must end the path. */
	label?: string;
	/** A line or a range (`15`, `12-20`) after the name, as `:15`. */
	line?: number | string | null;
	/** Lines added and removed, after the name. */
	additions?: number;
	deletions?: number;
	/** A chip's tint behind it, for a file standing alone among words or badges. Bare in a list. */
	framed?: boolean;
	/** Makes the chip a button. */
	onClick?: () => void;
	/**
	 * Gives the chip its path tooltip, as it has by default. A list of hundreds can leave it off for the chips still far
	 * out of view and turn it on as they come near; turning it on mounts the chip again.
	 */
	tooltip?: boolean;
	/** Shown after the name and the line, before the size. */
	children?: ReactNode;
	className?: string;
}

/**
 * A file wherever the app names one: its type's mark and its name, and the line and size when given. The whole path is
 * the tooltip and the accessible name, so a list never has to print it. Bare in a list, framed when it stands alone.
 */
export function FileChip({
	path,
	label,
	line,
	additions,
	deletions,
	framed = false,
	onClick,
	tooltip = true,
	children,
	className
}: FileChipProps) {
	const shown = label && path.endsWith(label) ? label : path.slice(path.lastIndexOf('/') + 1);
	const where = line === null || line === undefined || line === '' ? '' : `:${line}`;
	const Element = onClick ? 'button' : 'span';

	const chip = (
		<Element
			type={onClick ? 'button' : undefined}
			data-ui="file-chip"
			data-framed={framed ? '' : undefined}
			className={cn(className)}
			onClick={onClick}
		>
			<FileIcon path={path} />
			<span data-ui="file-chip-name">
				<span data-ui="file-chip-folder">{path.slice(0, path.length - shown.length)}</span>
				{shown}
				{where ? <span data-ui="file-chip-line">{where}</span> : null}
			</span>
			{children}
			{additions !== undefined || deletions !== undefined ? (
				<DiffStat additions={additions ?? 0} deletions={deletions ?? 0} />
			) : null}
		</Element>
	);

	return tooltip ? <Tooltip content={path + where}>{chip}</Tooltip> : chip;
}
