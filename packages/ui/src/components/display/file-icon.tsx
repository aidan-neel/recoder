'use client';

import { cn } from '../../lib/cn';
import { Icon } from '../icon';
import { fileMark } from './file-icons';

/**
 * The type of a file at a glance: its language's mark in the language's hue, a glyph for a kind of file no language
 * owns (an image, a lock file, a table), or a plain page. The hue is set inline so no surrounding rule that colours
 * icons can grey it; it is eased toward the ink on each theme so a deep brand colour still reads. 12px unless sized.
 */
export function FileIcon({ path, className }: { path: string; className?: string }) {
	const classes = cn('size-3 shrink-0', className);
	const mark = fileMark(path);

	if (mark.kind === 'glyph') return <Icon name={mark.glyph} data-ui="file-icon" className={classes} />;

	return (
		<svg
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden
			data-ui="file-icon"
			style={
				mark.hue
					? { color: `color-mix(in oklab, ${mark.hue}, var(--file-hue-toward) var(--file-hue-ease))` }
					: undefined
			}
			className={classes}
		>
			<path d={mark.path} />
		</svg>
	);
}
