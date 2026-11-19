import { ForgeMark } from '@recoder/ui';
import { GitBranchIcon } from '@phosphor-icons/react';
import type { Provider } from '@recoder/shared';

/** The tile of a row about a repository: its forge's mark, or a plain branch while the repositories load. */
export function RepoTile({ forge }: { forge: Provider | null }) {
	return forge ? <ForgeMark provider={forge} /> : <GitBranchIcon />;
}
