import { FolderGit2 } from 'lucide-react';

import { cn } from '../../lib/cn';
import { FORGE_PATHS } from './forge-paths';

interface ForgeMarkProps {
	/** Where the repository lives: a forge, or `local` for a clone on this machine. */
	provider: 'github' | 'gitlab' | 'local';
	className?: string;
}

/** The forge's mark (or a folder for a local repository), in the current text color. 14px unless sized. */
export function ForgeMark({ provider, className }: ForgeMarkProps) {
	const classes = cn('size-3.5 shrink-0', className);

	if (provider === 'local') return <FolderGit2 aria-label="Local repository" role="img" className={classes} />;

	return (
		<svg
			viewBox="0 0 24 24"
			fill="currentColor"
			role="img"
			aria-label={provider === 'github' ? 'GitHub' : 'GitLab'}
			className={classes}
		>
			<path d={FORGE_PATHS[provider]} />
		</svg>
	);
}
