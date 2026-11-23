import { useApi } from '../api/client';
import { diffFileAt } from '../changes/moves';
import { useChangesNav } from '../changes/use-changes';
import { useSession, useSessionData } from '../pull/pull-session';
import { loaded } from '../pull/session-state';
import { replaceAddress } from '../shell/navigation';
import { pullHref } from '../shell/routes';
import type { BugMove } from './types';

/**
 * Opens the Changes tab at the place a finding's code came from, on the old side. Null when the loaded diff does not
 * show that file, as for a copy from a file the change left alone; before the diff loads, the path is tried as it is.
 */
export function useGoToOrigin(move: BugMove): (() => void) | null {
	const { base } = useApi();
	const session = useSession();
	const nav = useChangesNav();
	const files = useSessionData((data) => loaded(data.diff)?.files ?? null);
	const path = files ? diffFileAt(files, move.from.path, 'old')?.path : move.from.path;

	if (!path) return null;

	return () => {
		nav.goTo(path, move.from.line, null, 'old');
		replaceAddress(pullHref(base, session.repoId, session.number, 'changes'));
	};
}
