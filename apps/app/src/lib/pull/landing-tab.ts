import type { PullDescriptionState } from '@recoder/shared';

import type { Load } from './session-state';
import type { PullTab } from './types';

/**
 * The tab an address that names none lands on: Description when there is a description or one is being written, and
 * Changes when there is none, because writing it failed, it is turned off or it did not load. Null until the
 * description has been read; the page shows Description's skeleton meanwhile.
 */
export function landingTab(description: Load<PullDescriptionState>): PullTab | null {
	if (description.phase === 'idle' || description.phase === 'loading') return null;
	if (description.phase === 'failed') return 'changes';

	const { status } = description.value;

	return status === 'ready' || status === 'pending' ? 'description' : 'changes';
}
