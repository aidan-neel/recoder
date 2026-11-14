import type { Provider } from '@recoder/shared';
import { ForgeMark } from '@recoder/ui';

interface RepoLabelProps {
	name: string;
	/** Where the repository lives; no mark while it is unknown. */
	forge: Provider | null;
	className?: string;
}

/** A repository's name behind the small mark of its forge (GitHub, GitLab, or a folder for a local one). */
export function RepoLabel({ name, forge, className }: RepoLabelProps) {
	return (
		<span className={className ? `repo-label ${className}` : 'repo-label'}>
			{forge ? <ForgeMark provider={forge} className="repo-label-mark" /> : null}
			{name}
		</span>
	);
}
