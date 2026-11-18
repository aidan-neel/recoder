import { FileText } from 'lucide-react';

import { cn } from '../../lib/cn';
import { fileLanguageIcon } from './file-icons';

/** The mark of the language a file is written in, in the current text color; a page for any other file. 12px unless sized. */
export function FileIcon({ path, className }: { path: string; className?: string }) {
	const classes = cn('size-3 shrink-0', className);
	const icon = fileLanguageIcon(path);

	if (!icon) return <FileText aria-hidden className={classes} />;

	return (
		<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={classes}>
			<path d={icon.path} />
		</svg>
	);
}
